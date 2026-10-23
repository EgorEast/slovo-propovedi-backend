import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { MulterError } from 'multer';
import { MAX_UPLOAD_BYTES } from './upload-file-filter';

export const INVALID_UPLOAD_MESSAGE = 'Invalid file upload';

const MAX_UPLOAD_MB = MAX_UPLOAD_BYTES / (1024 * 1024);

/**
 * Multer violations (`limits: { fileSize }`) surface as `MulterError`, which
 * Nest's default filter would answer with 500. This filter is scoped to the
 * upload route, so only Multer's own errors reach it — `fileFilter` rejections
 * are already `HttpException`s and every other failure keeps default handling.
 */
@Catch(MulterError)
export class MulterExceptionFilter implements ExceptionFilter<MulterError> {
  catch(error: MulterError, host: ArgumentsHost): void {
    // Defensive guard: the decorator already narrows the filter, but a direct
    // call must never turn a non-multer failure into a client error.
    if (!(error instanceof MulterError)) {
      throw error;
    }

    const exception = toUploadException(error);
    const response = host.switchToHttp().getResponse<Response>();
    response.status(exception.getStatus()).json(exception.getResponse());
  }
}

export function toUploadException(error: MulterError): HttpException {
  if (error.code === 'LIMIT_FILE_SIZE') {
    return new HttpException(
      {
        statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
        message: `File too large (max ${MAX_UPLOAD_MB} MB)`,
      },
      HttpStatus.PAYLOAD_TOO_LARGE,
    );
  }
  return new BadRequestException(INVALID_UPLOAD_MESSAGE);
}
