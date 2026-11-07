import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PictureEntity } from './entities/picture.entity';
import { PicturesService } from './pictures.service';

type StoredPicture = Pick<PictureEntity, 'id' | 'picturePath' | 'blurhash'>;

const createRepositoryMock = () => {
  const rows: StoredPicture[] = [];
  let nextId = 1;

  return {
    rows,
    findOne: jest.fn(
      ({ where }: { where: { picturePath: string } }) =>
        rows.find((row) => row.picturePath === where.picturePath) ?? null,
    ),
    insert: jest.fn((input: Omit<StoredPicture, 'id'>) => {
      rows.push({ id: String(nextId++), ...input });
      return Promise.resolve({});
    }),
    save: jest.fn((entity: StoredPicture) => Promise.resolve(entity)),
  };
};

const setup = async () => {
  const repository = createRepositoryMock();
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      PicturesService,
      { provide: getRepositoryToken(PictureEntity), useValue: repository },
    ],
  }).compile();

  return { repository, service: module.get(PicturesService) };
};

describe('PicturesService', () => {
  describe('record', () => {
    it('inserts a picture that is not stored yet', async () => {
      const { repository, service } = await setup();

      await service.record('uuid.jpg', 'LKO2');

      expect(repository.rows).toEqual([
        expect.objectContaining({
          picturePath: 'uuid.jpg',
          blurhash: 'LKO2',
        }),
      ]);
    });

    it('updates the existing picture instead of inserting a duplicate', async () => {
      const { repository, service } = await setup();

      await service.record('uuid.jpg', 'first');
      await service.record('uuid.jpg', 'second');

      expect(repository.rows).toHaveLength(1);
      expect(repository.rows[0]).toMatchObject({
        picturePath: 'uuid.jpg',
        blurhash: 'second',
      });
      expect(repository.insert).toHaveBeenCalledTimes(1);
    });
  });
});
