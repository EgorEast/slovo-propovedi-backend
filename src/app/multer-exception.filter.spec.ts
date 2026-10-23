import {
  BadRequestException,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
} from '@nestjs/common';
import { MulterError } from 'multer';
import {
  INVALID_UPLOAD_MESSAGE,
  MulterExceptionFilter,
  toUploadException,
} from './multer-exception.filter';

const httpHost = (response: Record<string, jest.Mock>): ArgumentsHost =>
  ({
    switchToHttp: () => ({ getResponse: () => response }),
  }) as unknown as ArgumentsHost;

describe('toUploadException', () => {
  it('maps LIMIT_FILE_SIZE to 413 with the limit in MB', () => {
    const exception = toUploadException(new MulterError('LIMIT_FILE_SIZE'));

    expect(exception).toBeInstanceOf(HttpException);
    expect(exception.getStatus()).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(exception.getResponse()).toMatchObject({
      statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
      message: expect.stringContaining('100 MB'),
    });
  });

  it('maps any other multer error to 400', () => {
    const exception = toUploadException(
      new MulterError('LIMIT_UNEXPECTED_FILE'),
    );

    expect(exception).toBeInstanceOf(BadRequestException);
    expect(exception.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(exception.getResponse()).toMatchObject({
      message: INVALID_UPLOAD_MESSAGE,
    });
  });
});

describe('MulterExceptionFilter', () => {
  it('writes the mapped status and body for a size violation', () => {
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const filter = new MulterExceptionFilter();

    filter.catch(
      new MulterError('LIMIT_FILE_SIZE'),
      httpHost(response as unknown as Record<string, jest.Mock>),
    );

    expect(response.status).toHaveBeenCalledWith(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
        message: expect.stringContaining('100 MB'),
      }),
    );
  });

  it('rethrows a non-multer error untouched', () => {
    const filter = new MulterExceptionFilter();
    const error = new Error('boom');

    expect(() =>
      filter.catch(error as unknown as MulterError, httpHost({})),
    ).toThrow(error);
  });
});
