import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import {
  MAX_UPLOAD_BYTES,
  mediaFileFilter,
  REJECTED_FILE_MESSAGE,
} from './upload-file-filter';

const request = {} as Request;

const multerFile = (originalname: string) =>
  ({ originalname }) as Express.Multer.File;

describe('mediaFileFilter', () => {
  it('accepts every extension from the media allow-list', () => {
    for (const name of [
      'cover.jpeg',
      'cover.jpg',
      'cover.png',
      'cover.webp',
      'sermon.mp3',
      'sermon.m4a',
      'notes.pdf',
      'book.fb2',
    ]) {
      const callback = jest.fn();

      mediaFileFilter(request, multerFile(name), callback);

      expect(callback).toHaveBeenCalledWith(null, true);
    }
  });

  it('accepts an uppercase extension — the allow-list is case-insensitive', () => {
    const callback = jest.fn();

    mediaFileFilter(request, multerFile('SERMON.MP3'), callback);

    expect(callback).toHaveBeenCalledWith(null, true);
  });

  it('rejects an extension outside the allow-list before buffering', () => {
    const callback = jest.fn();

    mediaFileFilter(request, multerFile('sermon.wav'), callback);

    expect(callback).toHaveBeenCalledWith(
      new BadRequestException(REJECTED_FILE_MESSAGE),
      false,
    );
  });

  it('rejects a file without an extension', () => {
    const callback = jest.fn();

    mediaFileFilter(request, multerFile('sermon'), callback);

    expect(callback).toHaveBeenCalledWith(
      expect.any(BadRequestException),
      false,
    );
  });

  it('caps a single upload at 100 MB', () => {
    expect(MAX_UPLOAD_BYTES).toBe(100 * 1024 * 1024);
  });
});
