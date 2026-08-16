import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MinioService } from './minio.service';

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
});
