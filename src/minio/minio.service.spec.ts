import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';
import * as Minio from 'minio';
import { MinioService, ReferencedFileNames } from './minio.service';

const mockConfig: Record<string, string> = {
  MINIO_ENDPOINT: 'localhost',
  MINIO_MAIN_PORT_IN: '9000',
  MINIO_ACCESS_KEY: 'test-access-key',
  MINIO_SECRET_KEY: 'test-secret-key',
  MINIO_PUBLIC_URI: 'http://localhost:9000',
};

describe('MinioService', () => {
  let service: MinioService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MinioService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => mockConfig[key]),
          },
        },
      ],
    }).compile();

    service = module.get<MinioService>(MinioService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('fails fast when MINIO_PUBLIC_URI is not set', () => {
    const config = {
      get: jest.fn((key: string) =>
        key === 'MINIO_PUBLIC_URI' ? undefined : mockConfig[key],
      ),
    };

    expect(() => new MinioService(config as unknown as ConfigService)).toThrow(
      'MINIO_PUBLIC_URI is not set',
    );
  });

  describe('extractFileNameFromUrl', () => {
    it('extracts the object name from a stored URL', () => {
      expect(
        MinioService.extractFileNameFromUrl(
          'http://localhost:9000/files/abc.mp3',
        ),
      ).toBe('abc.mp3');
    });

    it('preserves nested object names (prefixes with slashes)', () => {
      expect(
        MinioService.extractFileNameFromUrl(
          'http://localhost:9000/files/a/b/abc.mp3',
        ),
      ).toBe('a/b/abc.mp3');
    });

    it.each([
      'http://localhost:9000/other/abc.mp3',
      'http://localhost:9000/other/files/a.mp3',
      'http://localhost:9000/files',
    ])('throws when %p does not point into the default bucket', (url) => {
      expect(() => MinioService.extractFileNameFromUrl(url)).toThrow(
        'does not point to an object',
      );
    });

    it('ignores the host (survives MINIO_PUBLIC_URI domain changes)', () => {
      expect(
        MinioService.extractFileNameFromUrl(
          'https://cdn.example.com/files/podcast/ep1.mp3',
        ),
      ).toBe('podcast/ep1.mp3');
    });
  });

  describe('listOrphans', () => {
    const unreferenced: ReferencedFileNames = {
      audio: new Set<string>(),
      text: new Set<string>(),
      artwork: new Set<string>(),
    };

    function bucketItem(name: string, modified = new Date()): Minio.BucketItem {
      return { name, size: 1, lastModified: modified } as Minio.BucketItem;
    }

    function mockListObjects(items: Minio.BucketItem[]) {
      const stream = Readable.from(items);
      const destroy = jest.spyOn(stream, 'destroy');
      const client = (
        service as unknown as {
          minioClient: { listObjectsV2: jest.Mock };
        }
      ).minioClient;
      client.listObjectsV2 = jest.fn().mockReturnValue(stream);
      return { destroy };
    }

    it('returns only media objects and caps at limit, destroying the stream early', async () => {
      const { destroy } = mockListObjects([
        bucketItem('a.mp3'),
        bucketItem('note.txt'),
        bucketItem('b.jpg'),
        bucketItem('c.pdf'),
        bucketItem('d.webp'),
        bucketItem('e.mp3'),
      ]);

      const orphans = await service.listOrphans(unreferenced, 3);

      expect(orphans.map((file) => file.fileName).sort()).toEqual([
        'a.mp3',
        'b.jpg',
        'c.pdf',
      ]);
      expect(destroy).toHaveBeenCalled();
    });

    it('classifies m4a objects as orphan media and skips other audio formats', async () => {
      mockListObjects([bucketItem('sermon.m4a'), bucketItem('raw.wav')]);

      const orphans = await service.listOrphans(unreferenced, 500);

      expect(orphans.map((file) => file.fileName)).toEqual(['sermon.m4a']);
    });

    it('excludes objects referenced as audio or text', async () => {
      mockListObjects([bucketItem('used.mp3'), bucketItem('free.mp3')]);

      const orphans = await service.listOrphans(
        {
          audio: new Set(['used.mp3']),
          text: new Set(),
          artwork: new Set(),
        },
        500,
      );

      expect(orphans.map((file) => file.fileName)).toEqual(['free.mp3']);
    });

    it('orders the returned orphans newest first', async () => {
      mockListObjects([
        bucketItem('old.mp3', new Date('2020-01-01')),
        bucketItem('new.mp3', new Date('2024-01-01')),
      ]);

      const orphans = await service.listOrphans(unreferenced, 500);

      expect(orphans.map((file) => file.fileName)).toEqual([
        'new.mp3',
        'old.mp3',
      ]);
    });
  });

  describe('isReferencedAudioOrText', () => {
    it('returns true when the file name is referenced as audio or text', () => {
      const referenced: ReferencedFileNames = {
        audio: new Set(['sermon.mp3']),
        text: new Set(['notes.pdf']),
        artwork: new Set<string>(),
      };

      expect(service.isReferencedAudioOrText('sermon.mp3', referenced)).toBe(
        true,
      );
      expect(service.isReferencedAudioOrText('notes.pdf', referenced)).toBe(
        true,
      );
    });

    it('returns false for unreferenced and image file names', () => {
      const referenced: ReferencedFileNames = {
        audio: new Set(['sermon.mp3']),
        text: new Set<string>(),
        artwork: new Set(['cover.png']),
      };

      expect(service.isReferencedAudioOrText('free.mp3', referenced)).toBe(
        false,
      );
      expect(service.isReferencedAudioOrText('cover.png', referenced)).toBe(
        false,
      );
    });
  });

  describe('uploadFile', () => {
    it('normalizes the extension to lowercase before storing', async () => {
      const putObject = jest.fn().mockResolvedValue(undefined);
      (
        service as unknown as {
          minioClient: { putObject: jest.Mock };
        }
      ).minioClient.putObject = putObject;

      const fileName = await service.uploadFile({
        originalname: 'Sermon.MP3',
        buffer: Buffer.from('audio'),
        size: 5,
      } as Express.Multer.File);

      expect(fileName).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mp3$/,
      );
      expect(putObject).toHaveBeenCalledWith(
        'files',
        fileName,
        expect.any(Buffer),
        5,
        { 'Content-Type': 'audio/mp3' },
      );
    });
  });

  describe('uploadFile (fb2)', () => {
    it('stores .fb2 as a non-XML download so browsers never render it inline', async () => {
      const putObject = jest.fn().mockResolvedValue(undefined);
      (
        service as unknown as {
          minioClient: { putObject: jest.Mock };
        }
      ).minioClient.putObject = putObject;

      const fileName = await service.uploadFile({
        originalname: 'book.fb2',
        buffer: Buffer.from('<FictionBook/>'),
        size: 14,
      } as Express.Multer.File);

      expect(putObject).toHaveBeenCalledWith(
        'files',
        fileName,
        expect.any(Buffer),
        14,
        {
          'Content-Type': 'application/x-fictionbook',
          'Content-Disposition': 'attachment',
        },
      );
    });
  });

  describe('getContentType', () => {
    it('maps image, audio and document extensions to correct MIME types', () => {
      expect(service.getContentType('.jpeg')).toBe('image/jpeg');
      expect(service.getContentType('.jpg')).toBe('image/jpeg');
      expect(service.getContentType('.png')).toBe('image/png');
      expect(service.getContentType('.webp')).toBe('image/webp');
      expect(service.getContentType('.mp3')).toBe('audio/mp3');
      expect(service.getContentType('.m4a')).toBe('audio/mp4');
      expect(service.getContentType('.pdf')).toBe('application/pdf');
      expect(service.getContentType('.fb2')).toBe('application/x-fictionbook');
    });

    it('falls back to application/octet-stream for unknown extensions', () => {
      expect(service.getContentType('.wav')).toBe('application/octet-stream');
      expect(service.getContentType('')).toBe('application/octet-stream');
    });
  });
});
