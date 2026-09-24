import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import * as Minio from 'minio';
import * as path from 'path';

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

  // Upload allow-list / media classification taxonomy. Single source of truth —
  // uploads reject anything outside it and the orphans scan classifies by it.
  static readonly IMAGE_EXTENSIONS: readonly string[] = [
    '.jpeg',
    '.jpg',
    '.png',
    '.webp',
  ];
  static readonly AUDIO_TEXT_EXTENSIONS: readonly string[] = [
    '.mp3',
    '.pdf',
    '.fb2',
  ];
  static readonly MEDIA_EXTENSIONS: readonly string[] = [
    ...MinioService.IMAGE_EXTENSIONS,
    ...MinioService.AUDIO_TEXT_EXTENSIONS,
  ];

  /**
   * Lowercased extension (with the leading dot) of a file name; names without
   * a dot have no extension and yield an empty string.
   */
  static getFileExtension(fileName: string): string {
    const dotIndex = fileName.lastIndexOf('.');
    return dotIndex === -1 ? '' : fileName.slice(dotIndex).toLowerCase();
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
   * Presigning client: points at the browser-accessible MinIO endpoint
   * (MINIO_PUBLIC_URI, e.g. https://minio.example.com routed via Traefik).
   * The host header is part of the SigV4 signature, so a presigned URL must
   * be generated with the same host the browser will use — replacing the
   * host afterwards would invalidate the signature.
   */
  private readonly presignClient: Minio.Client;

  constructor(private readonly configService: ConfigService) {
    this.minioClient = this.buildInternalClient();
    this.presignClient = this.buildPresignClient();
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
    const fileType = path.extname(file.originalname);
    const contentType = this.getContentType(fileType);
    const fileName = randomUUID() + fileType;
    await this.minioClient.putObject(
      MinioService.BUCKET_NAME,
      fileName,
      file.buffer,
      file.size,
      {
        'Content-Type': contentType,
      },
    );

    return fileName;
  }

  async getFileUrl(fileName: string): Promise<string> {
    return `${this.configService.get('MINIO_PUBLIC_URI')}/${
      MinioService.BUCKET_NAME
    }/${fileName}`;
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
      return referenced.audio.has(fileName) || referenced.text.has(fileName);
    }
    return false;
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

  async getPresignedUrl(
    bucket: string,
    fileName: string,
    expirySeconds = 3600,
  ): Promise<string> {
    if (!bucket || !fileName) {
      throw new Error(
        'Bucket and file name are required to generate a presigned URL',
      );
    }
    return await this.presignClient.presignedGetObject(
      bucket,
      fileName,
      expirySeconds,
    );
  }

  /**
   * Generates a browser-accessible presigned URL for a file in the default
   * bucket. Streaming endpoints use it so audio/video is served directly from
   * MinIO instead of being proxied through the backend — a proxied stream would
   * hold buffers in the Node.js heap and exhaust it under 200 concurrent users.
   */
  async getPresignedFileUrl(
    fileName: string,
    expirySeconds = 3600,
  ): Promise<string> {
    return await this.getPresignedUrl(
      MinioService.BUCKET_NAME,
      fileName,
      expirySeconds,
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
   * Removes an object from the default bucket by its stored file URL (e.g. a
   * sermon's `audioUrl`). URLs whose path does not start with the default
   * bucket throw; the host is not checked (survives public-URI domain
   * changes). Callers decide whether to swallow the error for best-effort
   * cleanup.
   */
  async removeObjectByUrl(fileUrl: string): Promise<void> {
    const fileName = MinioService.extractFileNameFromUrl(fileUrl);
    await this.minioClient.removeObject(MinioService.BUCKET_NAME, fileName);
  }

  /**
   * Removes an object from the default bucket by its file name. Deleting a
   * non-existent object is a no-op in MinIO (S3 DeleteObject is idempotent).
   */
  async removeObjectByName(fileName: string): Promise<void> {
    await this.minioClient.removeObject(MinioService.BUCKET_NAME, fileName);
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

  private buildPresignClient(): Minio.Client {
    const publicUri = this.configService.get('MINIO_PUBLIC_URI');
    if (!publicUri) {
      throw new Error(
        'MINIO_PUBLIC_URI is not set — presigned URLs cannot be generated',
      );
    }
    let url: URL;
    try {
      url = new URL(publicUri);
    } catch {
      throw new Error(`MINIO_PUBLIC_URI is not a valid URL: "${publicUri}"`);
    }
    const clientOptions: Minio.ClientOptions = {
      endPoint: url.hostname,
      useSSL: url.protocol === 'https:',
      accessKey: this.configService.get('MINIO_ACCESS_KEY'),
      secretKey: this.configService.get('MINIO_SECRET_KEY'),
      // Buckets are created in us-east-1; pinning the region skips the
      // GetBucketLocation network round-trip and keeps presigning purely local.
      region: 'us-east-1',
    };
    if (url.port) {
      clientOptions.port = parseInt(url.port, 10);
    }
    return new Minio.Client(clientOptions);
  }
}
