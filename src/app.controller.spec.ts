import { BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { MinioService, type ReferencedFileNames } from './minio/minio.service';
import { SermonEntity } from './sermon/entities/sermon.entity';
import { PlaylistEntity } from './playlist/entities/playlist.entity';
import { UsersService } from './users/users.service';
import { PicturesService } from './pictures/pictures.service';
import { PictureEntity } from './pictures/entities/picture.entity';
import { computeBlurhash } from './pictures/blurhash';

jest.mock('./pictures/blurhash', () => ({
  computeBlurhash: jest.fn(),
}));

const computeBlurhashMock = computeBlurhash as jest.MockedFunction<
  typeof computeBlurhash
>;

const DELETE_REJECTED_FILE_MESSAGE =
  'Удалять можно только изображения (JPEG, PNG, WebP). Аудио и текстовые файлы удаляются через очистку осиротевших файлов.';

/** Multer file stub — the controller only reads `originalname` and `buffer`. */
const multerFile = (originalname: string, buffer = Buffer.from('media')) =>
  ({ originalname, buffer }) as Express.Multer.File;

describe('AppController', () => {
  let appController: AppController;
  let picturesService: PicturesService;
  let uploadFile: jest.Mock;
  let getFileUrl: jest.Mock;
  let removeObjectByName: jest.Mock;
  let listFilesWithUsage: jest.Mock;
  let sermonFind: jest.Mock;
  let playlistFind: jest.Mock;

  beforeEach(async () => {
    uploadFile = jest.fn().mockResolvedValue('uuid.m4a');
    getFileUrl = jest
      .fn()
      .mockResolvedValue('http://localhost:9000/files/uuid.m4a');
    removeObjectByName = jest.fn().mockResolvedValue(undefined);
    listFilesWithUsage = jest.fn().mockResolvedValue([]);
    sermonFind = jest.fn().mockResolvedValue([]);
    playlistFind = jest.fn().mockResolvedValue([]);
    computeBlurhashMock.mockReset();
    computeBlurhashMock.mockResolvedValue('LKO2');

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: MinioService,
          useValue: {
            uploadFile,
            getFileUrl,
            removeObjectByName,
            listFilesWithUsage,
            isReferencedAudioOrText: (
              fileName: string,
              referenced: ReferencedFileNames,
            ) =>
              referenced.audio.has(fileName) || referenced.text.has(fileName),
          },
        },
        { provide: JwtService, useValue: {} },
        { provide: UsersService, useValue: {} },
        PicturesService,
        {
          provide: getRepositoryToken(PictureEntity),
          useValue: {
            findOne: jest.fn().mockResolvedValue(null),
            insert: jest.fn().mockResolvedValue({}),
            save: jest.fn().mockResolvedValue(undefined),
          },
        },
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
    picturesService = app.get<PicturesService>(PicturesService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
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

    it('records a blurhash for an uploaded image', async () => {
      uploadFile.mockResolvedValue('uuid.jpg');
      getFileUrl.mockResolvedValue('http://localhost:9000/files/uuid.jpg');
      const file = multerFile('cover.jpg', Buffer.from('image-bytes'));
      const recordSpy = jest.spyOn(picturesService, 'record');

      const result = await appController.uploadFile(file);

      expect(computeBlurhashMock).toHaveBeenCalledWith(file.buffer);
      expect(recordSpy).toHaveBeenCalledWith('uuid.jpg', 'LKO2');
      expect(result).toEqual({
        fileName: 'uuid.jpg',
        fileUrl: 'http://localhost:9000/files/uuid.jpg',
      });
    });

    it('does not record a blurhash for a non-image upload', async () => {
      const recordSpy = jest.spyOn(picturesService, 'record');

      await appController.uploadFile(multerFile('sermon.m4a'));

      expect(computeBlurhashMock).not.toHaveBeenCalled();
      expect(recordSpy).not.toHaveBeenCalled();
    });

    it('still resolves when blurhash computation fails', async () => {
      uploadFile.mockResolvedValue('uuid.jpg');
      getFileUrl.mockResolvedValue('http://localhost:9000/files/uuid.jpg');
      computeBlurhashMock.mockRejectedValue(new Error('decode failed'));
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const recordSpy = jest.spyOn(picturesService, 'record');

      const result = await appController.uploadFile(multerFile('cover.jpg'));

      expect(recordSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
      expect(result).toEqual({
        fileName: 'uuid.jpg',
        fileUrl: 'http://localhost:9000/files/uuid.jpg',
      });
    });

    it('still resolves when recording the blurhash fails', async () => {
      uploadFile.mockResolvedValue('uuid.jpg');
      getFileUrl.mockResolvedValue('http://localhost:9000/files/uuid.jpg');
      jest
        .spyOn(picturesService, 'record')
        .mockRejectedValue(new Error('db down'));
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      const result = await appController.uploadFile(multerFile('cover.jpg'));

      expect(result).toEqual({
        fileName: 'uuid.jpg',
        fileUrl: 'http://localhost:9000/files/uuid.jpg',
      });
    });

    it('fails fast when no file was attached', async () => {
      await expect(appController.uploadFile(undefined)).rejects.toThrow(
        new BadRequestException('No file uploaded'),
      );
      expect(uploadFile).not.toHaveBeenCalled();
    });
  });

  describe('POST /files/orphans/cleanup', () => {
    it('bounds stored failure reasons to the first line and 200 chars', async () => {
      listFilesWithUsage.mockResolvedValue([
        { fileName: 'broken.m4a', used: false },
      ]);
      removeObjectByName.mockRejectedValue(
        new Error(`${'x'.repeat(300)}\nSECRET-INTERNALS`),
      );

      const result = await appController.cleanupOrphanedFiles();

      expect(result.deleted).toEqual([]);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].reason).toHaveLength(200);
      expect(result.failed[0].reason).not.toContain('SECRET-INTERNALS');
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
