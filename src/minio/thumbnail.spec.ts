import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';
import * as Minio from 'minio';
import sharp from 'sharp';
import { getThumbnailName } from 'src/shared/media';
import { MinioService } from './minio.service';
import { createThumbnail, THUMBNAIL_MAX_SIDE } from './thumbnail';

const config = {
  get: jest.fn(
    (key: string) =>
      ({
        MINIO_ACCESS_KEY: 'key',
        MINIO_ENDPOINT: 'localhost',
        MINIO_MAIN_PORT_IN: '9000',
        MINIO_PUBLIC_URI: 'http://localhost:9000',
        MINIO_SECRET_KEY: 'secret',
      })[key],
  ),
} as unknown as ConfigService;

const makeJpeg = (width: number, height: number) =>
  sharp({
    create: { background: '#f16031', channels: 3, height, width },
  })
    .jpeg()
    .toBuffer();

type MockClient = {
  copyObject: jest.Mock;
  getObject: jest.Mock;
  statObject: jest.Mock;
  listObjectsV2: jest.Mock;
  putObject: jest.Mock;
  removeObject: jest.Mock;
};

const setup = () => {
  const service = new MinioService(config);
  const client: MockClient = {
    copyObject: jest.fn().mockResolvedValue(undefined),
    getObject: jest.fn(),
    statObject: jest.fn(),
    listObjectsV2: jest.fn(),
    putObject: jest.fn().mockResolvedValue(undefined),
    removeObject: jest.fn().mockResolvedValue(undefined),
  };
  (service as unknown as { minioClient: MockClient }).minioClient = client;
  return { client, service };
};

const item = (name: string) =>
  ({ lastModified: new Date(), name, size: 1 }) as Minio.BucketItem;

describe('thumbnails', () => {
  it('names the preview thumbs/<uuid>.webp', () => {
    expect(getThumbnailName('abc.JPG')).toBe('thumbs/abc.webp');
    expect(getThumbnailName('abc.png')).toBe('thumbs/abc.webp');
  });

  it('downsizes to a WebP within the max side and never enlarges', async () => {
    const big = await sharp(
      await createThumbnail(await makeJpeg(1000, 500)),
    ).metadata();
    expect(big).toMatchObject({ format: 'webp', width: THUMBNAIL_MAX_SIDE });
    expect(big.height).toBe(THUMBNAIL_MAX_SIDE / 2);

    const small = await sharp(
      await createThumbnail(await makeJpeg(200, 100)),
    ).metadata();
    expect(small).toMatchObject({ height: 100, width: 200 });
  });

  it('stores a preview next to an uploaded image', async () => {
    const { client, service } = setup();
    const image = await makeJpeg(800, 800);

    const fileName = await service.uploadFile({
      buffer: image,
      originalname: 'cover.jpg',
      size: image.length,
    } as Express.Multer.File);

    expect(client.putObject).toHaveBeenCalledWith(
      'files',
      getThumbnailName(fileName),
      expect.any(Buffer),
      expect.any(Number),
      {
        'Cache-Control': MinioService.CACHE_CONTROL,
        'Content-Type': 'image/webp',
      },
    );
  });

  it('does not fail the upload when the preview cannot be made', async () => {
    const { client, service } = setup();

    await expect(
      service.uploadFile({
        buffer: Buffer.from('not an image'),
        originalname: 'broken.png',
        size: 12,
      } as Express.Multer.File),
    ).resolves.toMatch(/\.png$/);
    expect(client.putObject).toHaveBeenCalledTimes(1);
  });

  it('removes the preview together with the image', async () => {
    const { client, service } = setup();

    await service.removeObjectByName('abc.jpg');

    expect(client.removeObject).toHaveBeenCalledWith('files', 'abc.jpg');
    expect(client.removeObject).toHaveBeenCalledWith(
      'files',
      'thumbs/abc.webp',
    );
  });

  it('keeps previews out of the cover gallery', async () => {
    const { client, service } = setup();
    client.listObjectsV2.mockReturnValue(
      Readable.from([item('a.jpg'), item('thumbs/a.webp')]),
    );

    const images = await service.listImages();

    expect(images.map((file) => file.fileName)).toEqual(['a.jpg']);
  });

  it('backfills only images without a preview', async () => {
    const { client, service } = setup();
    const image = await makeJpeg(900, 900);
    client.listObjectsV2.mockImplementation((_bucket: string, prefix: string) =>
      Readable.from(
        prefix === 'thumbs/'
          ? [item('thumbs/done.webp')]
          : [item('done.jpg'), item('todo.png'), item('song.mp3')],
      ),
    );
    client.getObject.mockImplementation(async () => Readable.from([image]));

    const result = await service.backfillThumbnails();

    expect(result).toEqual({ created: 1, failed: 0 });
    expect(client.getObject).toHaveBeenCalledWith('files', 'todo.png');
    expect(client.putObject).toHaveBeenCalledWith(
      'files',
      'thumbs/todo.webp',
      expect.any(Buffer),
      expect.any(Number),
      {
        'Cache-Control': MinioService.CACHE_CONTROL,
        'Content-Type': 'image/webp',
      },
    );
  });

  describe('backfillCacheControl', () => {
    const stat = (metaData: Record<string, string>) => ({ metaData });

    it('rewrites only objects without the header, keeping their content type', async () => {
      const { client, service } = setup();
      client.listObjectsV2.mockImplementation(
        (_bucket: string, prefix: string) =>
          Readable.from(
            prefix === 'thumbs/'
              ? [item('thumbs/a.webp')]
              : [item('a.jpg'), item('b.png'), item('song.mp3')],
          ),
      );
      client.statObject.mockImplementation(
        async (_bucket: string, name: string) =>
          name === 'b.png'
            ? stat({
                'cache-control': MinioService.CACHE_CONTROL,
                'content-type': 'image/png',
              })
            : stat({
                'content-type': name.endsWith('.webp')
                  ? 'image/webp'
                  : 'image/jpeg',
              }),
      );

      const result = await service.backfillCacheControl();

      expect(result).toEqual({ failed: 0, updated: 2 });
      const rewritten = client.copyObject.mock.calls.map(
        ([, dest]: [unknown, { getHeaders: () => Record<string, string> }]) =>
          dest.getHeaders(),
      );
      expect(rewritten).toEqual([
        expect.objectContaining({
          'Cache-Control': MinioService.CACHE_CONTROL,
          'Content-Type': 'image/jpeg',
          'X-Amz-Metadata-Directive': 'REPLACE',
        }),
        expect.objectContaining({ 'Content-Type': 'image/webp' }),
      ]);
      expect(client.statObject).not.toHaveBeenCalledWith('files', 'song.mp3');
    });

    it('processes images oldest first so the gallery order survives', async () => {
      const { client, service } = setup();
      const at = (name: string, time: number) =>
        ({ lastModified: new Date(time), name, size: 1 }) as Minio.BucketItem;
      client.listObjectsV2.mockImplementation(
        (_bucket: string, prefix: string) =>
          Readable.from(
            prefix === 'thumbs/'
              ? []
              : [at('new.jpg', 2000), at('old.jpg', 1000)],
          ),
      );
      client.statObject.mockResolvedValue(
        stat({ 'content-type': 'image/jpeg' }),
      );

      await service.backfillCacheControl();

      expect(
        client.statObject.mock.calls.map(([, name]: [string, string]) => name),
      ).toEqual(['old.jpg', 'new.jpg']);
    });
  });
});
