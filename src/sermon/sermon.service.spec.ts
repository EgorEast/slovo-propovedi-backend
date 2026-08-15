import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import {
  buildSearchTsQuery,
  buildSearchVectorExpression,
  decodeCompositeCursor,
  encodeCompositeCursor,
  SermonService,
} from './sermon.service';
import { SermonEntity } from './entities/sermon.entity';
import { PlaylistEntity } from 'src/playlist/entities/playlist.entity';
import { PlaylistSermonJoinEntity } from 'src/playlist/entities/playlist-sermon-join.entity';
import { MinioService } from 'src/minio/minio.service';

// Mirror of the service's canonical tsvector expression — asserting the exact
// string guards the runtime behavior against accidental edits to SEARCH_WEIGHTS
// (and keeps the migration sql/migrations/005_sermon_search_tsvector.sql honest).
const SEARCH_VECTOR_EXPRESSION =
  "setweight(to_tsvector('russian', coalesce(title, '')), 'A') || " +
  "setweight(to_tsvector('russian', coalesce(artist, '')), 'B') || " +
  "setweight(to_tsvector('russian', coalesce(book, '')), 'B') || " +
  "setweight(to_tsvector('russian', coalesce(description, '')), 'D')";

const RANK_EXPRESSION =
  "ts_rank('{0.1,0.2,0.4,1.0}'::float4[], sermon.search_vector, to_tsquery('russian', :tsquery))";

const SEARCH_CONDITION =
  "sermon.search_vector @@ to_tsquery('russian', :tsquery)";

describe('SermonService', () => {
  let service: SermonService;
  let sermonRepository: {
    createQueryBuilder: jest.Mock;
  };

  beforeEach(async () => {
    sermonRepository = {
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

  describe('buildSearchTsQuery (boundary parsing of the raw search string)', () => {
    it('ANDs every word token and appends the :* prefix for partial words', () => {
      expect(buildSearchTsQuery('благодать иван')).toBe('благодать:* & иван:*');
    });

    it('is word-order independent — the same tokens in any order produce the same query', () => {
      expect(buildSearchTsQuery('иван благодать')).toBe('иван:* & благодать:*');
    });

    it('keeps Cyrillic letters and digits', () => {
      expect(buildSearchTsQuery('глава 3')).toBe('глава:* & 3:*');
    });

    it('strips punctuation and whitespace around tokens', () => {
      expect(buildSearchTsQuery('благодать, иван!')).toBe(
        'благодать:* & иван:*',
      );
    });

    it('neutralizes tsquery injection attempts (& | ! ( ) : * < >)', () => {
      expect(buildSearchTsQuery('благодать & | ! ( ) : * < > иван')).toBe(
        'благодать:* & иван:*',
      );
    });

    it('fails fast when nothing but syntax characters remains', () => {
      expect(() => buildSearchTsQuery('&&& !!! ( )')).toThrow(
        BadRequestException,
      );
    });
  });

  describe('buildSearchVectorExpression (single source of truth for weights)', () => {
    it('weights title A, artist/book B, description D in the migration order', () => {
      expect(buildSearchVectorExpression()).toBe(SEARCH_VECTOR_EXPRESSION);
    });
  });

  describe('composite cursor (rank + id for relevance-ordered pages)', () => {
    it('round-trips rank and id through the opaque encoding', () => {
      const cursor = encodeCompositeCursor(
        0.6229741,
        '123e4567-e89b-12d3-a456-426614174000',
      );
      expect(decodeCompositeCursor(cursor)).toEqual({
        rank: 0.6229741,
        id: '123e4567-e89b-12d3-a456-426614174000',
      });
    });

    it('fails fast on a stale plain-uuid cursor (old format is invalidated)', () => {
      expect(() =>
        decodeCompositeCursor('123e4567-e89b-12d3-a456-426614174000'),
      ).toThrow(BadRequestException);
    });

    it('fails fast on garbage input', () => {
      expect(() => decodeCompositeCursor('!!!not-a-cursor!!!')).toThrow(
        BadRequestException,
      );
    });
  });

  describe('findAll', () => {
    function mockQueryBuilder() {
      const queryBuilder = {
        leftJoinAndSelect: jest.fn(),
        orderBy: jest.fn(),
        addOrderBy: jest.fn(),
        addSelect: jest.fn(),
        where: jest.fn(),
        andWhere: jest.fn(),
        setParameter: jest.fn(),
        take: jest.fn(),
        getManyAndCount: jest.fn(),
        getRawAndEntities: jest.fn(),
        getMany: jest.fn(),
      };
      [
        'leftJoinAndSelect',
        'orderBy',
        'addOrderBy',
        'addSelect',
        'where',
        'andWhere',
        'setParameter',
        'take',
      ].forEach((method) => queryBuilder[method].mockReturnValue(queryBuilder));
      queryBuilder.getManyAndCount.mockResolvedValue([[], 0]);
      queryBuilder.getRawAndEntities.mockResolvedValue({
        entities: [],
        raw: [],
      });
      queryBuilder.getMany.mockResolvedValue([]);
      sermonRepository.createQueryBuilder.mockReturnValue(queryBuilder);
      return queryBuilder;
    }

    describe('full-fetch path (no take)', () => {
      it('keeps id-DESC ordering and returns the count when search is absent', async () => {
        const queryBuilder = mockQueryBuilder();
        queryBuilder.getManyAndCount.mockResolvedValue([[], 5]);

        const result = await service.findAll();

        expect(queryBuilder.orderBy).toHaveBeenCalledWith('sermon.id', 'DESC');
        expect(queryBuilder.where).not.toHaveBeenCalled();
        expect(queryBuilder.addSelect).not.toHaveBeenCalled();
        expect(queryBuilder.getManyAndCount).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ sermons: [], count: 5, nextCursor: null });
      });

      it('ranks by relevance (rank DESC, id DESC) and filters by FTS when search is present', async () => {
        const queryBuilder = mockQueryBuilder();

        await service.findAll(undefined, undefined, 'благодать иван');

        expect(queryBuilder.addSelect).toHaveBeenCalledWith(
          RANK_EXPRESSION,
          'rank',
        );
        expect(queryBuilder.where).toHaveBeenCalledWith(SEARCH_CONDITION);
        expect(queryBuilder.setParameter).toHaveBeenCalledWith(
          'tsquery',
          'благодать:* & иван:*',
        );
        expect(queryBuilder.orderBy).toHaveBeenCalledWith('rank', 'DESC');
        expect(queryBuilder.addOrderBy).toHaveBeenCalledWith(
          'sermon.id',
          'DESC',
        );
      });

      it('passes the sanitized tsquery to the parameter binding', async () => {
        const queryBuilder = mockQueryBuilder();

        await service.findAll(undefined, undefined, 'Благодать');

        expect(queryBuilder.setParameter).toHaveBeenCalledWith(
          'tsquery',
          'Благодать:*',
        );
      });
    });

    describe('keyset path (take supplied)', () => {
      it('keeps id-DESC order, the id cursor and getMany when search is absent', async () => {
        const queryBuilder = mockQueryBuilder();
        const cursor = '123e4567-e89b-12d3-a456-426614174000';

        await service.findAll(2, cursor);

        expect(queryBuilder.orderBy).toHaveBeenCalledWith('sermon.id', 'DESC');
        expect(queryBuilder.andWhere).toHaveBeenCalledWith(
          'sermon.id < :cursor',
          {
            cursor,
          },
        );
        expect(queryBuilder.addSelect).not.toHaveBeenCalled();
        expect(queryBuilder.take).toHaveBeenCalledWith(3);
        expect(queryBuilder.getMany).toHaveBeenCalled();
        expect(queryBuilder.getRawAndEntities).not.toHaveBeenCalled();
      });

      it('filters by FTS, orders by relevance and builds a composite next cursor when search is present', async () => {
        const queryBuilder = mockQueryBuilder();
        const sermonA = {
          id: 'aaaaaaaa-0000-0000-0000-000000000001',
          playlistJoins: [],
        };
        const sermonB = {
          id: 'bbbbbbbb-0000-0000-0000-000000000002',
          playlistJoins: [],
        };
        const sermonC = {
          id: 'cccccccc-0000-0000-0000-000000000003',
          playlistJoins: [],
        };
        queryBuilder.getRawAndEntities.mockResolvedValue({
          entities: [sermonA, sermonB, sermonC],
          raw: [
            { sermon_id: sermonA.id, rank: 0.6229741 },
            { sermon_id: sermonB.id, rank: 0.6229741 },
            { sermon_id: sermonC.id, rank: 0.18297999 },
          ],
        });

        const result = await service.findAll(2, undefined, 'благодать иван');

        expect(queryBuilder.addSelect).toHaveBeenCalledWith(
          RANK_EXPRESSION,
          'rank',
        );
        expect(queryBuilder.where).toHaveBeenCalledWith(SEARCH_CONDITION);
        expect(queryBuilder.setParameter).toHaveBeenCalledWith(
          'tsquery',
          'благодать:* & иван:*',
        );
        expect(queryBuilder.orderBy).toHaveBeenCalledWith('rank', 'DESC');
        expect(queryBuilder.addOrderBy).toHaveBeenCalledWith(
          'sermon.id',
          'DESC',
        );
        expect(queryBuilder.take).toHaveBeenCalledWith(3);
        expect(queryBuilder.getRawAndEntities).toHaveBeenCalled();
        expect(queryBuilder.getMany).not.toHaveBeenCalled();
        expect(result.sermons.map((s) => s.id)).toEqual([
          sermonA.id,
          sermonB.id,
        ]);
        expect(result.count).toBeNull();
        expect(result.nextCursor).toBe(
          encodeCompositeCursor(0.6229741, sermonB.id),
        );
      });

      it('paginates with the composite row-value comparison when cursor and search are combined', async () => {
        const queryBuilder = mockQueryBuilder();
        const cursor = encodeCompositeCursor(
          0.6229741,
          'bbbbbbbb-0000-0000-0000-000000000002',
        );

        await service.findAll(2, cursor, 'благодать');

        expect(queryBuilder.andWhere).toHaveBeenCalledTimes(1);
        expect(queryBuilder.andWhere).toHaveBeenCalledWith(
          `(${RANK_EXPRESSION}, sermon.id) < (:rank::float4, :id)`,
          {
            rank: 0.6229741,
            id: 'bbbbbbbb-0000-0000-0000-000000000002',
          },
        );
      });

      it('returns a null next cursor when no further page exists', async () => {
        const queryBuilder = mockQueryBuilder();
        const sermonA = {
          id: 'aaaaaaaa-0000-0000-0000-000000000001',
          playlistJoins: [],
        };
        const sermonB = {
          id: 'bbbbbbbb-0000-0000-0000-000000000002',
          playlistJoins: [],
        };
        queryBuilder.getRawAndEntities.mockResolvedValue({
          entities: [sermonA, sermonB],
          raw: [
            { sermon_id: sermonA.id, rank: 0.6229741 },
            { sermon_id: sermonB.id, rank: 0.18297999 },
          ],
        });

        const result = await service.findAll(2, undefined, 'благодать');

        expect(result.sermons.map((s) => s.id)).toEqual([
          sermonA.id,
          sermonB.id,
        ]);
        expect(result.nextCursor).toBeNull();
      });
    });
  });

  describe('getDistinctValues', () => {
    function mockQueryBuilder(rawRows: Record<string, string>[]) {
      const queryBuilder = {
        select: jest.fn(),
        where: jest.fn(),
        andWhere: jest.fn(),
        orderBy: jest.fn(),
        getRawMany: jest.fn(),
      };
      ['select', 'where', 'andWhere', 'orderBy'].forEach((method) =>
        queryBuilder[method].mockReturnValue(queryBuilder),
      );
      queryBuilder.getRawMany.mockResolvedValue(rawRows);
      return queryBuilder;
    }

    it('returns the distinct artists and books from two independent queries', async () => {
      const artistBuilder = mockQueryBuilder([
        { artist: 'Антоний' },
        { artist: 'Иоанн' },
      ]);
      const bookBuilder = mockQueryBuilder([{ book: 'Бытие' }]);
      sermonRepository.createQueryBuilder
        .mockReturnValueOnce(artistBuilder)
        .mockReturnValueOnce(bookBuilder);

      const result = await service.getDistinctValues();

      expect(sermonRepository.createQueryBuilder).toHaveBeenCalledTimes(2);
      expect(artistBuilder.select).toHaveBeenCalledWith(
        'DISTINCT sermon.artist',
        'artist',
      );
      expect(bookBuilder.select).toHaveBeenCalledWith(
        'DISTINCT sermon.book',
        'book',
      );
      expect(result).toEqual({
        artists: ['Антоний', 'Иоанн'],
        books: ['Бытие'],
      });
    });

    it('excludes NULL and empty/whitespace-only values in SQL for both columns', async () => {
      const artistBuilder = mockQueryBuilder([{ artist: 'Иоанн' }]);
      const bookBuilder = mockQueryBuilder([{ book: 'Бытие' }]);
      sermonRepository.createQueryBuilder
        .mockReturnValueOnce(artistBuilder)
        .mockReturnValueOnce(bookBuilder);

      await service.getDistinctValues();

      expect(artistBuilder.where).toHaveBeenCalledWith(
        'sermon.artist IS NOT NULL',
      );
      expect(artistBuilder.andWhere).toHaveBeenCalledWith(
        "trim(sermon.artist) <> ''",
      );
      expect(bookBuilder.where).toHaveBeenCalledWith('sermon.book IS NOT NULL');
      expect(bookBuilder.andWhere).toHaveBeenCalledWith(
        "trim(sermon.book) <> ''",
      );
    });

    it('sorts both lists alphabetically in SQL', async () => {
      const artistBuilder = mockQueryBuilder([{ artist: 'Антоний' }]);
      const bookBuilder = mockQueryBuilder([{ book: 'Бытие' }]);
      sermonRepository.createQueryBuilder
        .mockReturnValueOnce(artistBuilder)
        .mockReturnValueOnce(bookBuilder);

      await service.getDistinctValues();

      expect(artistBuilder.orderBy).toHaveBeenCalledWith('artist', 'ASC');
      expect(bookBuilder.orderBy).toHaveBeenCalledWith('book', 'ASC');
    });

    it('returns empty lists when no values exist', async () => {
      sermonRepository.createQueryBuilder
        .mockReturnValueOnce(mockQueryBuilder([]))
        .mockReturnValueOnce(mockQueryBuilder([]));

      const result = await service.getDistinctValues();

      expect(result).toEqual({ artists: [], books: [] });
    });
  });
});
