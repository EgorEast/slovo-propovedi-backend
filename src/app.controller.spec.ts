import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { MinioService } from './minio/minio.service';
import { SermonEntity } from './sermon/entities/sermon.entity';
import { PlaylistEntity } from './playlist/entities/playlist.entity';

const REJECTED_FILE_MESSAGE =
  'Недопустимый тип файла. Разрешены только: JPEG, PNG, WebP, MP3, M4A, PDF, FB2.';

/** Multer file stub — the controller only reads `originalname` before the allow-list check. */
const multerFile = (originalname: string) =>
  ({ originalname }) as Express.Multer.File;

describe('AppController', () => {
  let appController: AppController;
  let uploadFile: jest.Mock;
  let getFileUrl: jest.Mock;

  beforeEach(async () => {
    uploadFile = jest.fn().mockResolvedValue('uuid.m4a');
    getFileUrl = jest
      .fn()
      .mockResolvedValue('http://localhost:9000/files/uuid.m4a');

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        { provide: MinioService, useValue: { uploadFile, getFileUrl } },
        { provide: JwtService, useValue: {} },
        { provide: getRepositoryToken(SermonEntity), useValue: {} },
        { provide: getRepositoryToken(PlaylistEntity), useValue: {} },
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
});
