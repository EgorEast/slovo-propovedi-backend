import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { MinioService, type ReferencedFileNames } from './minio/minio.service';
import { SermonEntity } from './sermon/entities/sermon.entity';
import { PlaylistEntity } from './playlist/entities/playlist.entity';

const REJECTED_FILE_MESSAGE =
  'Недопустимый тип файла. Разрешены только: JPEG, PNG, WebP, MP3, M4A, PDF, FB2.';

const DELETE_REJECTED_FILE_MESSAGE =
  'Удалять можно только изображения (JPEG, PNG, WebP). Аудио и текстовые файлы удаляются через очистку осиротевших файлов.';

/** Multer file stub — the controller only reads `originalname` before the allow-list check. */
const multerFile = (originalname: string) =>
  ({ originalname }) as Express.Multer.File;

describe('AppController', () => {
  let appController: AppController;
  let uploadFile: jest.Mock;
  let getFileUrl: jest.Mock;
  let removeObjectByName: jest.Mock;
  let sermonFind: jest.Mock;
  let playlistFind: jest.Mock;

  beforeEach(async () => {
    uploadFile = jest.fn().mockResolvedValue('uuid.m4a');
    getFileUrl = jest
      .fn()
      .mockResolvedValue('http://localhost:9000/files/uuid.m4a');
    removeObjectByName = jest.fn().mockResolvedValue(undefined);
    sermonFind = jest.fn().mockResolvedValue([]);
    playlistFind = jest.fn().mockResolvedValue([]);

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: MinioService,
          useValue: {
            uploadFile,
            getFileUrl,
            removeObjectByName,
            isReferencedAudioOrText: (
              fileName: string,
              referenced: ReferencedFileNames,
            ) =>
              referenced.audio.has(fileName) || referenced.text.has(fileName),
          },
        },
        { provide: JwtService, useValue: {} },
        {
          provide: getRepositoryToken(SermonEntity),
          useValue: { find: sermonFind },
        },
        {
          provide: getRepositoryToken(PlaylistEntity),
          useValue: { find: playlistFind },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should be defined', () => {
      expect(appController).toBeDefined();
    });
  });

  describe('POST /files', () => {
    it('stores an m4a upload and returns its name and URL', async () => {
      const file = multerFile('sermon.m4a');

      const result = await appController.uploadFile(file);

      expect(uploadFile).toHaveBeenCalledWith(file);
      expect(result).toEqual({
        fileName: 'uuid.m4a',
        fileUrl: 'http://localhost:9000/files/uuid.m4a',
      });
    });

    it('rejects an extension outside the allow-list before touching storage', async () => {
      await expect(
        appController.uploadFile(multerFile('sermon.wav')),
      ).rejects.toThrow(new BadRequestException(REJECTED_FILE_MESSAGE));
      expect(uploadFile).not.toHaveBeenCalled();
    });

    it('fails fast when no file was attached', async () => {
      await expect(appController.uploadFile(undefined)).rejects.toThrow(
        new BadRequestException('No file uploaded'),
      );
      expect(uploadFile).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /files/:fileName', () => {
    it('deletes an unreferenced m4a file', async () => {
      const result = await appController.removeFile({
        fileName: 'orphan.m4a',
      });

      expect(result).toEqual({ status: 'success' });
      expect(removeObjectByName).toHaveBeenCalledWith('orphan.m4a');
    });

    it('returns 409 when an m4a file is still referenced by a sermon', async () => {
      sermonFind.mockResolvedValue([
        {
          audioUrl: 'http://localhost:9000/files/used.m4a',
          textFileUrl: null,
          artwork: null,
        },
      ]);

      await expect(
        appController.removeFile({ fileName: 'used.m4a' }),
      ).rejects.toThrow(ConflictException);
      expect(removeObjectByName).not.toHaveBeenCalled();
    });

    it('rejects an extension outside the media taxonomy with 400', async () => {
      await expect(
        appController.removeFile({ fileName: 'raw.wav' }),
      ).rejects.toThrow(new BadRequestException(DELETE_REJECTED_FILE_MESSAGE));
      expect(removeObjectByName).not.toHaveBeenCalled();
    });
  });
});
