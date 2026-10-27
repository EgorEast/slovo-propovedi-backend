import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import * as Minio from 'minio';
import { CopyDestinationOptions, CopySourceOptions } from 'minio';
import {
  AUDIO_TEXT_EXTENSIONS,
  getFileExtension,
  getThumbnailName,
  IMAGE_EXTENSIONS,
  MEDIA_EXTENSIONS,
  THUMBNAIL_PREFIX,
} from 'src/shared/media';
import { createThumbnail, THUMBNAIL_CONTENT_TYPE } from './thumbnail';

export interface StoredFile {
  fileName: string;
  fileUrl: string;
  size: number | null;
  lastModified: Date | null;
}

/** Storage scan result enriched with DB reference info. */
export interface StoredFileUsage extends StoredFile {
  used: boolean;
}

/**
 * File names extracted from the stored URL columns (sermon + playlist) so a
 * bucket scan can tell referenced objects from orphans. Sets are used because
 * lookup must be O(1) for every object in the scan.
 */
export interface ReferencedFileNames {
  audio: Set<string>;
  text: Set<string>;
  artwork: Set<string>;
}

/** Backward-compatible alias for `listImages` consumers (cover-reuse). */
export type StoredImage = StoredFile;

@Injectable()
export class MinioService {
  static readonly BUCKET_NAME = 'files';

  /**
   * Stored object names are random UUIDs and a file is never overwritten in
   * place (a replacement is a new object), so every object can be cached by
   * browsers and CDNs forever.
   */
  static readonly CACHE_CONTROL = 'public, max-age=31536000, immutable';

  private readonly logger = new Logger(MinioService.name);

  // Re-exported from `src/shared/media.ts` so existing consumers keep using
  // MinioService while the taxonomy itself has one definition.
  static readonly IMAGE_EXTENSIONS = IMAGE_EXTENSIONS;
  static readonly AUDIO_TEXT_EXTENSIONS = AUDIO_TEXT_EXTENSIONS;
  static readonly MEDIA_EXTENSIONS = MEDIA_EXTENSIONS;

  static getFileExtension(fileName: string): string {
    return getFileExtension(fileName);
  }

  static isImageFile(fileName: string): boolean {
    return MinioService.IMAGE_EXTENSIONS.includes(
      MinioService.getFileExtension(fileName),
    );
  }

  static isAudioOrTextFile(fileName: string): boolean {
    return MinioService.AUDIO_TEXT_EXTENSIONS.includes(
      MinioService.getFileExtension(fileName),
    );
  }

  static isMediaFile(fileName: string): boolean {
    return MinioService.MEDIA_EXTENSIONS.includes(
      MinioService.getFileExtension(fileName),
    );
  }

  /**
   * Data-plane client: talks to MinIO over the internal Docker network.
   * Used for uploads and bucket administration (no browser traffic).
   */
  private readonly minioClient: Minio.Client;

  /**
   * Browser-facing base of static object URLs. Validated on boot: without it
   * every URL returned to clients would be malformed.
   */
  private readonly publicUri: string;

  constructor(private readonly configService: ConfigService) {
    const publicUri = this.configService.get('MINIO_PUBLIC_URI');
    if (!publicUri) {
      throw new Error(
        'MINIO_PUBLIC_URI is not set — static file URLs cannot be built',
      );
    }
    this.publicUri = publicUri;
    this.minioClient = this.buildInternalClient();
  }

  async createBucketIfNotExists(): Promise<void> {
    const bucketExists = await this.minioClient.bucketExists(
      MinioService.BUCKET_NAME,
    );
    if (!bucketExists) {
      await this.minioClient.makeBucket(MinioService.BUCKET_NAME, 'us-east-1');
    }
    await this.applyPublicReadPolicy();
  }

  /**
   * Grants anonymous read access to stored media so the static URLs returned
   * by getFileUrl work for browsers. Applied unconditionally on every startup
   * (setBucketPolicy is idempotent) so an existing bucket that was created
   * private is self-healed. Grants ONLY s3:GetObject — uploads, listing and
   * deletes remain gated by the MinIO credentials.
   */
  private async applyPublicReadPolicy(): Promise<void> {
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'PublicReadGetObject',
          Effect: 'Allow',
          Principal: '*',
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${MinioService.BUCKET_NAME}/*`],
        },
      ],
    };
    await this.minioClient.setBucketPolicy(
      MinioService.BUCKET_NAME,
      JSON.stringify(policy),
    );
  }

  async uploadFile(file: Express.Multer.File): Promise<string> {
    // Normalize the extension once: `.MP3` must not be stored with an
    // application/octet-stream content type.
    const fileType = MinioService.getFileExtension(file.originalname);
    const contentType = this.getContentType(fileType);
    const fileName = randomUUID() + fileType;
    await this.minioClient.putObject(
      MinioService.BUCKET_NAME,
      fileName,
      file.buffer,
      file.size,
      {
        'Content-Type': contentType,
        'Cache-Control': MinioService.CACHE_CONTROL,
        ...this.getContentDisposition(fileType),
      },
    );

    if (MinioService.isImageFile(fileName)) {
      await this.storeThumbnail(fileName, file.buffer);
    }

    return fileName;
  }

  /**
   * Writes the card-size preview of an image (`thumbs/<uuid>.webp`). Best
   * effort: a failure is logged and never fails the upload — clients fall back
   * to the original when the preview is missing.
   * @returns whether the preview was stored.
   */
  async storeThumbnail(fileName: string, image: Buffer): Promise<boolean> {
    try {
      const thumbnail = await createThumbnail(image);
      await this.minioClient.putObject(
        MinioService.BUCKET_NAME,
        getThumbnailName(fileName),
        thumbnail,
        thumbnail.length,
        {
          'Cache-Control': MinioService.CACHE_CONTROL,
          'Content-Type': THUMBNAIL_CONTENT_TYPE,
        },
      );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Thumbnail for ${fileName} failed: ${message}`);
      return false;
    }
  }

  /**
   * One-shot backfill: creates previews for every stored image that has none.
   * Idempotent (existing previews are skipped), sequential to keep memory and
   * CPU flat, never throws — meant to run in the background after boot.
   */
  async backfillThumbnails(): Promise<{ created: number; failed: number }> {
    const result = { created: 0, failed: 0 };
    try {
      const images = await this.scanBucket({
        extensions: MinioService.IMAGE_EXTENSIONS,
      });
      const existing = new Set(await this.listObjectNames(THUMBNAIL_PREFIX));
      const missing = images
        .map((obj) => obj.name ?? '')
        .filter((name) => name && !existing.has(getThumbnailName(name)));

      for (const fileName of missing) {
        const image = await this.readObject(fileName).catch(() => null);
        const stored = image
          ? await this.storeThumbnail(fileName, image)
          : false;
        if (stored) result.created += 1;
        else result.failed += 1;
      }
      if (missing.length > 0) {
        this.logger.log(
          `Thumbnail backfill: ${result.created} created, ${result.failed} failed`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Thumbnail backfill aborted: ${message}`);
    }
    return result;
  }

  /**
   * One-shot backfill of `Cache-Control` on images and previews stored before
   * uploads set it. MinIO cannot change metadata in place, so each object is
   * copied onto itself with the metadata replaced (content type and
   * disposition are carried over). That bumps `lastModified`, so images are
   * processed oldest-first to keep their relative "newest first" order in the
   * cover gallery. Audio/text are left alone: rewriting gigabytes for a header
   * is not worth it. Idempotent, sequential, never throws.
   */
  async backfillCacheControl(): Promise<{ updated: number; failed: number }> {
    const result = { failed: 0, updated: 0 };
    try {
      const images = await this.scanBucket({
        extensions: MinioService.IMAGE_EXTENSIONS,
      });
      const oldestFirst = images
        .sort(
          (a, b) =>
            (a.lastModified?.getTime() ?? 0) - (b.lastModified?.getTime() ?? 0),
        )
        .map((obj) => obj.name ?? '')
        .filter(Boolean);
      const thumbnails = await this.listObjectNames(THUMBNAIL_PREFIX);

      for (const name of [...oldestFirst, ...thumbnails]) {
        try {
          if (await this.applyCacheControl(name)) result.updated += 1;
        } catch {
          result.failed += 1;
        }
      }
      if (result.updated > 0 || result.failed > 0) {
        this.logger.log(
          `Cache-Control backfill: ${result.updated} updated, ${result.failed} failed`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Cache-Control backfill aborted: ${message}`);
    }
    return result;
  }

  /** @returns whether the object had to be rewritten. */
  private async applyCacheControl(name: string): Promise<boolean> {
    const stat = await this.minioClient.statObject(
      MinioService.BUCKET_NAME,
      name,
    );
    const metaData: Record<string, unknown> = stat.metaData ?? {};
    if (metaData['cache-control'] === MinioService.CACHE_CONTROL) {
      return false;
    }

    const headers: Record<string, string> = {
      'Cache-Control': MinioService.CACHE_CONTROL,
    };
    if (typeof metaData['content-type'] === 'string') {
      headers['Content-Type'] = metaData['content-type'];
    }
    if (typeof metaData['content-disposition'] === 'string') {
      headers['Content-Disposition'] = metaData['content-disposition'];
    }

    await this.minioClient.copyObject(
      new CopySourceOptions({ Bucket: MinioService.BUCKET_NAME, Object: name }),
      new CopyDestinationOptions({
        Bucket: MinioService.BUCKET_NAME,
        Headers: headers,
        MetadataDirective: 'REPLACE',
        Object: name,
      }),
    );
    return true;
  }

  private async readObject(fileName: string): Promise<Buffer> {
    const stream = await this.minioClient.getObject(
      MinioService.BUCKET_NAME,
      fileName,
    );
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  private listObjectNames(prefix: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const names: string[] = [];
      const stream = this.minioClient.listObjectsV2(
        MinioService.BUCKET_NAME,
        prefix,
        true,
      );
      stream.on('data', (obj) => {
        if (obj.name) names.push(obj.name);
      });
      stream.on('error', reject);
      stream.on('end', () => resolve(names));
    });
  }

  async getFileUrl(fileName: string): Promise<string> {
    return `${this.publicUri}/${MinioService.BUCKET_NAME}/${fileName}`;
  }

  /**
   * Lists up to 500 image objects in the default bucket, newest first. Used by
   * the cover-reuse feature so the admin UI can offer already-uploaded images.
   * Filters by file extension (not content type) because getContentType has no
   * mapping for every object MinIO may return.
   *
   * The scan is capped at IMAGE_LIMIT so a large bucket cannot load an
   * unbounded number of objects into memory.
   */
  async listImages(): Promise<StoredImage[]> {
    // Generous for a small admin app: enough for the cover-reuse gallery while
    // bounding memory usage.
    const IMAGE_LIMIT = 500;

    const imageObjects = await this.scanBucket({
      extensions: MinioService.IMAGE_EXTENSIONS,
      limit: IMAGE_LIMIT,
    });

    return this.toStoredFiles(imageObjects);
  }

  /**
   * Lists EVERY object in the default bucket, newest first. Unbounded by
   * design — the orphans CLEANUP pass must see the whole bucket to delete
   * every orphan; it streams from MinIO (never materializes the listing in
   * memory at once) and a small admin catalog keeps the collected list cheap.
   * The read-only orphans endpoint uses the bounded `listOrphans` instead.
   */
  async listAllFiles(): Promise<StoredFile[]> {
    const objects = await this.scanBucket();
    return this.toStoredFiles(objects);
  }

  /**
   * Full bucket scan annotated with `used` — whether the object is referenced
   * by any sermon/playlist URL column. Each object is classified by extension
   * and compared against the matching reference set: images against artwork,
   * audio/text against audioUrl/textFileUrl. Objects outside the media
   * taxonomy are never marked used.
   */
  async listFilesWithUsage(
    referenced: ReferencedFileNames,
  ): Promise<StoredFileUsage[]> {
    const files = await this.listAllFiles();
    return files.map((file) => ({
      ...file,
      used: this.isReferenced(file.fileName, referenced),
    }));
  }

  /**
   * Lists at most `limit` orphaned MEDIA objects, newest first. Unlike
   * `listFilesWithUsage` (which materializes the whole bucket for the cleanup
   * pass), this scan classifies each object as it streams — media extension
   * AND unreferenced — and stops as soon as `limit` orphans are collected.
   * Neither referenced objects nor objects beyond the cap are ever
   * accumulated, so memory is bounded by `limit`, not by the bucket size.
   */
  async listOrphans(
    referenced: ReferencedFileNames,
    limit: number,
  ): Promise<StoredFile[]> {
    const objects = await this.scanBucket({
      match: (fileName) =>
        MinioService.isMediaFile(fileName) &&
        !this.isReferenced(fileName, referenced),
      limit,
    });
    return this.toStoredFiles(objects);
  }

  private isReferenced(
    fileName: string,
    referenced: ReferencedFileNames,
  ): boolean {
    if (MinioService.isImageFile(fileName)) {
      return referenced.artwork.has(fileName);
    }
    if (MinioService.isAudioOrTextFile(fileName)) {
      return this.isReferencedAudioOrText(fileName, referenced);
    }
    return false;
  }

  /**
   * Whether an audio/text object is referenced by any sermon — as its
   * `audioUrl` or `textFileUrl`. Shared by the orphans scan (`listOrphans`,
   * `listFilesWithUsage`) and the single-file delete endpoint so both agree on
   * what "unreferenced" means.
   */
  isReferencedAudioOrText(
    fileName: string,
    referenced: ReferencedFileNames,
  ): boolean {
    return referenced.audio.has(fileName) || referenced.text.has(fileName);
  }

  /**
   * Streams bucket objects through listObjectsV2, optionally filtered by
   * extension or an arbitrary `match` predicate, and capped at `limit`
   * (counted over the matched objects). When the cap is hit the stream is
   * destroyed early — the promise is already resolved, so any later end/error
   * event is ignored.
   */
  private scanBucket(
    options: {
      extensions?: readonly string[];
      match?: (fileName: string) => boolean;
      limit?: number;
    } = {},
  ): Promise<Minio.BucketItem[]> {
    const { extensions, match, limit } = options;
    return new Promise<Minio.BucketItem[]>((resolve, reject) => {
      const stream = this.minioClient.listObjectsV2(
        MinioService.BUCKET_NAME,
        '',
        true,
      );
      const matches: Minio.BucketItem[] = [];
      // Once the cap is hit (or the stream ends/errors) the promise settles and
      // any in-flight `data` event must be ignored — `destroy()` stops the
      // stream, but a buffered event can still arrive afterwards.
      let settled = false;
      stream.on('data', (obj) => {
        if (settled) {
          return;
        }
        const fileName = obj.name ?? '';
        // Previews are derived objects, not media: they must never show up in
        // the cover gallery, the orphans scan or the cleanup.
        if (fileName.startsWith(THUMBNAIL_PREFIX)) {
          return;
        }
        if (
          extensions &&
          !extensions.includes(MinioService.getFileExtension(fileName))
        ) {
          return;
        }
        if (match && !match(fileName)) {
          return;
        }
        matches.push(obj);
        if (limit !== undefined && matches.length >= limit) {
          settled = true;
          stream.destroy();
          resolve(matches);
        }
      });
      stream.on('error', (error) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(error);
      });
      stream.on('end', () => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(matches);
      });
    });
  }

  private async toStoredFiles(
    objects: Minio.BucketItem[],
  ): Promise<StoredFile[]> {
    const newestFirst = objects.sort(
      (a, b) =>
        (b.lastModified?.getTime() ?? 0) - (a.lastModified?.getTime() ?? 0),
    );

    return Promise.all(
      newestFirst.map(async (obj) => {
        const fileName = obj.name ?? '';
        return {
          fileName,
          fileUrl: await this.getFileUrl(fileName),
          size: obj.size ?? null,
          lastModified: obj.lastModified ?? null,
        };
      }),
    );
  }

  /**
   * Extracts the object name from a stored file URL (e.g. the `audioUrl` of a
   * sermon). File URLs look like `${MINIO_PUBLIC_URI}/files/<object-name>`.
   * Only the PATH is checked — it must start with the default bucket (`files`);
   * the host is deliberately ignored so stored URLs survive MINIO_PUBLIC_URI
   * domain changes. Throws when the path does not start with the bucket or
   * names no object (a foreign path could otherwise delete an object from OUR
   * bucket by accident).
   */
  static extractFileNameFromUrl(fileUrl: string): string {
    const pathSegments = new URL(fileUrl).pathname.split('/').filter(Boolean);
    if (
      pathSegments[0] !== MinioService.BUCKET_NAME ||
      pathSegments.length < 2
    ) {
      throw new Error(
        `File URL "${fileUrl}" does not point to an object in the "${MinioService.BUCKET_NAME}" bucket`,
      );
    }
    return pathSegments.slice(1).join('/');
  }

  /**
   * Removes an object from the default bucket by its file name. Deleting a
   * non-existent object is a no-op in MinIO (S3 DeleteObject is idempotent).
   */
  async removeObjectByName(fileName: string): Promise<void> {
    await this.minioClient.removeObject(MinioService.BUCKET_NAME, fileName);
    if (MinioService.isImageFile(fileName)) {
      // The preview is derived data: a leftover is harmless, so best effort.
      await this.minioClient
        .removeObject(MinioService.BUCKET_NAME, getThumbnailName(fileName))
        .catch(() => undefined);
    }
  }

  /**
   * `.fb2` objects are served as downloads: even with a non-XML content type,
   * `attachment` guarantees a browser never renders an uploaded book inline on
   * the public bucket origin. Readers that fetch() the file are unaffected.
   */
  getContentDisposition(fileType: string): Record<string, string> {
    return fileType === '.fb2' ? { 'Content-Disposition': 'attachment' } : {};
  }

  getContentType(fileType: string): string {
    switch (fileType) {
      case '.jpeg': {
        return 'image/jpeg';
      }
      case '.jpg': {
        return 'image/jpeg';
      }
      case '.png': {
        return 'image/png';
      }
      case '.webp': {
        return 'image/webp';
      }
      case '.mp3': {
        return 'audio/mp3';
      }
      case '.m4a': {
        return 'audio/mp4';
      }
      case '.pdf': {
        return 'application/pdf';
      }
      case '.fb2': {
        // Deliberately NOT an XML type (application/xml, *+xml): browsers
        // render those as documents, and an XHTML-namespaced <script> inside an
        // uploaded .fb2 would execute on the public MinIO origin.
        return 'application/x-fictionbook';
      }
      default: {
        return 'application/octet-stream';
      }
    }
  }

  private buildInternalClient(): Minio.Client {
    return new Minio.Client({
      endPoint: this.configService.get('MINIO_ENDPOINT'),
      port: +this.configService.get('MINIO_MAIN_PORT_IN'),
      useSSL: false,
      accessKey: this.configService.get('MINIO_ACCESS_KEY'),
      secretKey: this.configService.get('MINIO_SECRET_KEY'),
    });
  }
}
