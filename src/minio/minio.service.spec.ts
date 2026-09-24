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

  describe('removeObjectByUrl', () => {
    function mockClientRemoveObject() {
      const client = (
        service as unknown as {
          minioClient: { removeObject: jest.Mock };
        }
      ).minioClient;
      client.removeObject = jest.fn().mockResolvedValue(undefined);
      return client.removeObject;
    }

    it('removes the object named by the stored URL from the default bucket', async () => {
      const removeObject = mockClientRemoveObject();

      await service.removeObjectByUrl('http://localhost:9000/files/abc.mp3');

      expect(removeObject).toHaveBeenCalledWith('files', 'abc.mp3');
    });

    it('preserves nested object names (prefixes with slashes)', async () => {
      const removeObject = mockClientRemoveObject();

      await service.removeObjectByUrl(
        'http://localhost:9000/files/a/b/abc.mp3',
      );

      expect(removeObject).toHaveBeenCalledWith('files', 'a/b/abc.mp3');
    });

    it('fails fast on URLs that do not point into the default bucket', async () => {
      mockClientRemoveObject();

      await expect(
        service.removeObjectByUrl('http://localhost:9000/other/abc.mp3'),
      ).rejects.toThrow('does not point to an object');
    });

    it('fails fast when the bucket is not the first path segment (a foreign path must not delete from our bucket)', async () => {
      mockClientRemoveObject();

      await expect(
        service.removeObjectByUrl('http://localhost:9000/other/files/a.mp3'),
      ).rejects.toThrow('does not point to an object');
    });

    it('fails fast when the URL names no object (bare bucket path)', async () => {
      mockClientRemoveObject();

      await expect(
        service.removeObjectByUrl('http://localhost:9000/files'),
      ).rejects.toThrow('does not point to an object');
    });

    it('accepts a foreign host when the path starts with the default bucket (survives MINIO_PUBLIC_URI domain changes)', async () => {
      const removeObject = mockClientRemoveObject();

      await service.removeObjectByUrl(
        'https://cdn.example.com/files/podcast/ep1.mp3',
      );

      expect(removeObject).toHaveBeenCalledWith('files', 'podcast/ep1.mp3');
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
});
