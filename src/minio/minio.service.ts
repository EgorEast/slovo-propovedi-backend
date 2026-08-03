import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import * as Minio from 'minio';
import * as path from 'path';

@Injectable()
export class MinioService {
  static readonly BUCKET_NAME = 'files';

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
   * Throws when the URL does not point at an object in the default bucket.
   */
  static extractFileNameFromUrl(fileUrl: string): string {
    const pathSegments = new URL(fileUrl).pathname.split('/').filter(Boolean);
    const bucketIndex = pathSegments.findIndex(
      (segment) => segment === MinioService.BUCKET_NAME,
    );
    if (bucketIndex === -1 || bucketIndex === pathSegments.length - 1) {
      throw new Error(
        `File URL "${fileUrl}" does not point to an object in the "${MinioService.BUCKET_NAME}" bucket`,
      );
    }
    return pathSegments.slice(bucketIndex + 1).join('/');
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
