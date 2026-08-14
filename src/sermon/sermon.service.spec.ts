import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { SermonService } from './sermon.service';
import { SermonEntity } from './entities/sermon.entity';
import { PlaylistEntity } from 'src/playlist/entities/playlist.entity';
import { PlaylistSermonJoinEntity } from 'src/playlist/entities/playlist-sermon-join.entity';
import { MinioService } from 'src/minio/minio.service';

// Mirror of the service's searchable fields — asserting the concrete list here
// guards the runtime behavior against accidental edits to the constant.
const SEARCH_FIELDS = ['title', 'artist', 'book', 'description'];

describe('SermonService', () => {
  let service: SermonService;
  let sermonRepository: {
    findAndCount: jest.Mock;
    createQueryBuilder: jest.Mock;
  };

  beforeEach(async () => {
    sermonRepository = {
      findAndCount: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SermonService,
        {
          provide: getRepositoryToken(SermonEntity),
          useValue: sermonRepository,
        },
        {
          provide: getRepositoryToken(PlaylistEntity),
          useValue: {},
        },
        {
          provide: getRepositoryToken(PlaylistSermonJoinEntity),
          useValue: {},
        },
        {
          provide: MinioService,
          useValue: {},
        },
        {
          provide: getDataSourceToken(),
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<SermonService>(SermonService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    describe('full-fetch path (no take)', () => {
      it('applies no search filter when search is absent', async () => {
        sermonRepository.findAndCount.mockResolvedValue([[], 0]);

        await service.findAll();

        expect(sermonRepository.findAndCount).toHaveBeenCalledTimes(1);
        const options = sermonRepository.findAndCount.mock.calls[0][0];
        expect(options.where).toBeUndefined();
      });

      it('applies a parameterized LOWER(...) LIKE OR-array over every searchable field when search is present', async () => {
        sermonRepository.findAndCount.mockResolvedValue([[], 0]);

        await service.findAll(undefined, undefined, 'благодать');

        const options = sermonRepository.findAndCount.mock.calls[0][0];
        expect(options.where).toHaveLength(SEARCH_FIELDS.length);
        options.where.forEach((condition, index) => {
          const field = SEARCH_FIELDS[index];
          const raw = condition[field];
          // Raw injects the SQL with the full "alias.column" path that
          // TypeORM passes in, and binds the pattern as the :q parameter.
          const alias = `sermon.${field}`;
          expect(raw.type).toBe('raw');
          expect(raw.getSql(alias)).toBe(`LOWER(${alias}) LIKE :q`);
          expect(raw.objectLiteralParameters).toEqual({ q: '%благодать%' });
        });
      });

      it('lowercases the search term at the boundary so Cyrillic case folding does not depend on the DB locale', async () => {
        sermonRepository.findAndCount.mockResolvedValue([[], 0]);

        await service.findAll(undefined, undefined, 'Благодать');

        const options = sermonRepository.findAndCount.mock.calls[0][0];
        const raw = options.where[0].title;
        expect(raw.objectLiteralParameters).toEqual({ q: '%благодать%' });
      });
    });

    describe('keyset path (take supplied)', () => {
      function mockQueryBuilder() {
        const queryBuilder = {
          leftJoinAndSelect: jest.fn(),
          orderBy: jest.fn(),
          addOrderBy: jest.fn(),
          take: jest.fn(),
          andWhere: jest.fn(),
          getMany: jest.fn(),
        };
        queryBuilder.leftJoinAndSelect.mockReturnValue(queryBuilder);
        queryBuilder.orderBy.mockReturnValue(queryBuilder);
        queryBuilder.addOrderBy.mockReturnValue(queryBuilder);
        queryBuilder.take.mockReturnValue(queryBuilder);
        queryBuilder.andWhere.mockReturnValue(queryBuilder);
        queryBuilder.getMany.mockResolvedValue([]);
        sermonRepository.createQueryBuilder.mockReturnValue(queryBuilder);
        return queryBuilder;
      }

      it('applies no search condition when search is absent', async () => {
        const queryBuilder = mockQueryBuilder();

        await service.findAll(2);

        expect(sermonRepository.createQueryBuilder).toHaveBeenCalledWith(
          'sermon',
        );
        expect(queryBuilder.andWhere).not.toHaveBeenCalled();
      });

      it('applies a parameterized LOWER(...) LIKE OR-condition over every searchable field when search is present', async () => {
        const queryBuilder = mockQueryBuilder();

        await service.findAll(2, undefined, 'благодать');

        const expectedCondition = SEARCH_FIELDS.map(
          (field) => `LOWER(sermon.${field}) LIKE :q`,
        ).join(' OR ');
        expect(queryBuilder.andWhere).toHaveBeenCalledWith(expectedCondition, {
          q: '%благодать%',
        });
      });

      it('lowercases the search term at the boundary on the keyset path too', async () => {
        const queryBuilder = mockQueryBuilder();

        await service.findAll(2, undefined, 'Благодать');

        const expectedCondition = SEARCH_FIELDS.map(
          (field) => `LOWER(sermon.${field}) LIKE :q`,
        ).join(' OR ');
        expect(queryBuilder.andWhere).toHaveBeenCalledWith(expectedCondition, {
          q: '%благодать%',
        });
      });

      it('applies both the cursor clause and the escaped LOWER(...) LIKE OR-condition when cursor and search are combined', async () => {
        const queryBuilder = mockQueryBuilder();
        const cursor = '123e4567-e89b-12d3-a456-426614174000';

        await service.findAll(2, cursor, 'благодать');

        const expectedCondition = SEARCH_FIELDS.map(
          (field) => `LOWER(sermon.${field}) LIKE :q`,
        ).join(' OR ');
        expect(queryBuilder.andWhere).toHaveBeenCalledTimes(2);
        expect(queryBuilder.andWhere).toHaveBeenCalledWith(
          'sermon.id < :cursor',
          { cursor },
        );
        expect(queryBuilder.andWhere).toHaveBeenCalledWith(expectedCondition, {
          q: '%благодать%',
        });
      });
    });
  });
});
