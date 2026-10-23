import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { getFileExtension, MEDIA_EXTENSIONS } from '../shared/media';

/**
 * Hard cap for a single multipart upload. Multer's default memory storage keeps
 * the whole body in the Node heap, so an unbounded file could exhaust the
 * container (100 MB covers ~2 hours of 128 kbps audio; images and documents are
 * far smaller). The reverse proxy body limit must stay at or above this value.
 */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export const REJECTED_FILE_MESSAGE =
  'Недопустимый тип файла. Разрешены только: JPEG, PNG, WebP, MP3, M4A, PDF, FB2.';

/**
 * Multer `fileFilter`: rejects a part as soon as its headers are parsed, before
 * the body is buffered into memory or reaches storage. The allow-list is the
 * shared media taxonomy — the same one bucket scans and file-name validation
 * use, so the formats cannot drift apart.
 */
export function mediaFileFilter(
  _request: Request,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
): void {
  const extension = getFileExtension(file.originalname);
  if (!MEDIA_EXTENSIONS.includes(extension)) {
    callback(new BadRequestException(REJECTED_FILE_MESSAGE), false);
    return;
  }
  callback(null, true);
}
