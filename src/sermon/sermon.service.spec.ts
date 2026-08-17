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
import { SectionEntity } from 'src/section/entities/section.entity';
import { SectionPlaylistJoinEntity } from 'src/section/entities/section-playlist-join.entity';
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

// ---------------------------------------------------------------------------
// findAll normalized-shape characterization fixture. A small closed world that
// exercises every shape rule the deep-join hydration produced: sermons with
// 0 / 1 / many playlists, playlists with multiple sections and sermons,
// cross-referenced sermons, empty descriptions, null section fields, and
// sermons that only appear nested inside a page's playlists (off-page).
// ---------------------------------------------------------------------------

const SEED_SERMONS: Array<{
  id: string;
  title: string;
  description: string;
  textFileUrl: string | null;
  audioUrl: string | null;
  youtubeUrl: string | null;
  artist: string;
  artwork: string;
  book: string | null;
  chapter: number | null;
  verse: number | number[] | null;
}> = [
  {
    id: 'sermon-1',
    title: 'Проповедь 1',
    description: '',
    textFileUrl: null,
    audioUrl: null,
    youtubeUrl: null,
    artist: 'Автор 1',
    artwork: 'artwork-1',
    book: null,
    chapter: null,
    verse: null,
  },
  {
    id: 'sermon-2',
    title: 'Проповедь 2',
    description: 'Описание 2',
    textFileUrl: 'text-2',
    audioUrl: 'audio-2',
    youtubeUrl: 'youtube-2',
    artist: 'Автор 2',
    artwork: 'artwork-2',
    book: 'Бытие',
    chapter: 1,
    verse: [1, 2],
  },
  {
    id: 'sermon-3',
    title: 'Проповедь 3',
    description: 'Описание 3',
    textFileUrl: null,
    audioUrl: null,
    youtubeUrl: null,
    artist: 'Автор 3',
    artwork: 'artwork-3',
    book: 'Исход',
    chapter: 2,
    verse: 3,
  },
  {
    id: 'sermon-4',
    title: 'Проповедь 4',
    description: 'Описание 4',
    textFileUrl: null,
    audioUrl: 'audio-4',
    youtubeUrl: null,
    artist: 'Автор 4',
    artwork: 'artwork-4',
    book: null,
    chapter: null,
    verse: null,
  },
  {
    id: 'sermon-5',
    title: 'Проповедь 5',
    description: 'Описание 5',
    textFileUrl: null,
    audioUrl: null,
    youtubeUrl: null,
    artist: 'Автор 5',
    artwork: 'artwork-5',
    book: null,
    chapter: null,
    verse: null,
  },
];

const SEED_PLAYLISTS: Array<{
  id: string;
  title: string;
  description: string;
  artwork: string;
}> = [
  {
    id: 'playlist-1',
    title: 'Плейлист 1',
    description: 'Описание 1',
    artwork: 'art-1',
  },
  { id: 'playlist-2', title: 'Плейлист 2', description: '', artwork: 'art-2' },
  {
    id: 'playlist-3',
    title: 'Плейлист 3',
    description: 'Описание 3',
    artwork: 'art-3',
  },
];

const SEED_SECTIONS: Array<{
  id: string;
  title: string;
  description: string | null;
  position: number;
  itemsSize: 'small' | 'middle' | 'large' | 'xLarge';
  itemsRows: number | null;
  transform: 'middle' | 'high' | 'short';
  isDescriptionTitleOnSlideLarge: boolean;
  whereIsSlideTitleLocated: 'on' | 'under' | 'bothOnAndUnder';
  borderRadius: boolean;
}> = [
  {
    id: 'section-a',
    title: 'Секция А',
    description: null,
    position: 10,
    itemsSize: 'small',
    itemsRows: null,
    transform: 'middle',
    isDescriptionTitleOnSlideLarge: false,
    whereIsSlideTitleLocated: 'under',
    borderRadius: false,
  },
  {
    id: 'section-b',
    title: 'Секция Б',
    description: 'Описание Б',
    position: 20,
    itemsSize: 'large',
    itemsRows: 3,
    transform: 'high',
    isDescriptionTitleOnSlideLarge: true,
    whereIsSlideTitleLocated: 'on',
    borderRadius: true,
  },
];

// Every playlist→sermon membership, with the position of the sermon inside the
// playlist. sermon-1 is deliberately absent (0-playlist case); sermon-2 has a
// position tie (0 in both playlist-1 and playlist-2), matching real data where
// positions are per-playlist.
const SEED_PLAYLIST_SERMON_JOINS: Array<{
  playlistId: string;
  sermonId: string;
  position: number;
}> = [
  { playlistId: 'playlist-1', sermonId: 'sermon-2', position: 0 },
  { playlistId: 'playlist-1', sermonId: 'sermon-3', position: 1 },
  { playlistId: 'playlist-1', sermonId: 'sermon-4', position: 2 },
  { playlistId: 'playlist-2', sermonId: 'sermon-2', position: 0 },
  { playlistId: 'playlist-2', sermonId: 'sermon-5', position: 1 },
  { playlistId: 'playlist-3', sermonId: 'sermon-3', position: 0 },
];

// Every playlist→section membership, with the position of the playlist inside
// the section.
const SEED_SECTION_PLAYLIST_JOINS: Array<{
  playlistId: string;
  sectionId: string;
  position: number;
}> = [
  { playlistId: 'playlist-1', sectionId: 'section-a', position: 0 },
  { playlistId: 'playlist-1', sectionId: 'section-b', position: 1 },
  { playlistId: 'playlist-3', sectionId: 'section-b', position: 0 },
];

describe('SermonService', () => {
  let service: SermonService;
  let sermonRepository: {
    createQueryBuilder: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  let playlistRepository: { find: jest.Mock };
  let playlistSermonJoinRepository: { createQueryBuilder: jest.Mock };
  let sectionPlaylistJoinRepository: { createQueryBuilder: jest.Mock };
  let sectionRepository: { find: jest.Mock };
  let minioService: { removeObjectByUrl: jest.Mock };

  beforeEach(async () => {
    sermonRepository = {
      createQueryBuilder: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    playlistRepository = { find: jest.fn() };
    playlistSermonJoinRepository = { createQueryBuilder: jest.fn() };
    sectionPlaylistJoinRepository = { createQueryBuilder: jest.fn() };
    sectionRepository = { find: jest.fn() };
    minioService = { removeObjectByUrl: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SermonService,
        {
          provide: getRepositoryToken(SermonEntity),
          useValue: sermonRepository,
        },
        {
          provide: getRepositoryToken(PlaylistEntity),
          useValue: playlistRepository,
        },
        {
          provide: getRepositoryToken(PlaylistSermonJoinEntity),
          useValue: playlistSermonJoinRepository,
        },
        {
          provide: getRepositoryToken(SectionEntity),
          useValue: sectionRepository,
        },
        {
          provide: getRepositoryToken(SectionPlaylistJoinEntity),
          useValue: sectionPlaylistJoinRepository,
        },
        {
          provide: MinioService,
          useValue: minioService,
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

  // Generic query-builder mock: chainable config methods plus the terminal
  // methods (getMany / getCount / getRawAndEntities) resolved per test. The
  // page query and the count query share the same builder instance in the
  // full-fetch path, so getMany and getCount live on one object.
  function mockBuilder(
    overrides: {
      getMany?: unknown[];
      getCount?: number;
      getRawAndEntities?: { entities: unknown[]; raw: unknown[] };
    } = {},
  ) {
    const queryBuilder = {
      leftJoinAndSelect: jest.fn(),
      select: jest.fn(),
      orderBy: jest.fn(),
      addOrderBy: jest.fn(),
      addSelect: jest.fn(),
      where: jest.fn(),
      andWhere: jest.fn(),
      setParameter: jest.fn(),
      skip: jest.fn(),
      take: jest.fn(),
      getMany: jest.fn(),
      getManyAndCount: jest.fn(),
      getRawAndEntities: jest.fn(),
      getCount: jest.fn(),
    };
    [
      'leftJoinAndSelect',
      'select',
      'orderBy',
      'addOrderBy',
      'addSelect',
      'where',
      'andWhere',
      'setParameter',
      'skip',
      'take',
    ].forEach((method) => queryBuilder[method].mockReturnValue(queryBuilder));
    queryBuilder.getMany.mockResolvedValue(overrides.getMany ?? []);
    queryBuilder.getCount.mockResolvedValue(overrides.getCount ?? 0);
    queryBuilder.getRawAndEntities.mockResolvedValue(
      overrides.getRawAndEntities ?? { entities: [], raw: [] },
    );
    queryBuilder.getManyAndCount.mockResolvedValue([[], 0]);
    return queryBuilder;
  }

  describe('findAll', () => {
    // Wires the graph queries so a non-empty page comes back with no playlists
    // (assembleSermonGraph resolves every array to empty).
    function mockEmptyGraphQueries() {
      playlistSermonJoinRepository.createQueryBuilder.mockReturnValue(
        mockBuilder(),
      );
      sectionPlaylistJoinRepository.createQueryBuilder.mockReturnValue(
        mockBuilder(),
      );
      playlistRepository.find.mockResolvedValue([]);
      sectionRepository.find.mockResolvedValue([]);
    }

    describe('full-fetch path (no take)', () => {
      it('keeps id-DESC ordering and returns the count when search is absent', async () => {
        const pageBuilder = mockBuilder();
        pageBuilder.getMany.mockResolvedValue([]);
        pageBuilder.getCount.mockResolvedValue(5);
        sermonRepository.createQueryBuilder.mockReturnValue(pageBuilder);

        const result = await service.findAll();

        expect(pageBuilder.orderBy).toHaveBeenCalledWith('sermon.id', 'DESC');
        expect(pageBuilder.where).not.toHaveBeenCalled();
        expect(pageBuilder.addSelect).not.toHaveBeenCalled();
        expect(pageBuilder.getCount).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ sermons: [], count: 5, nextCursor: null });
      });

      it('ranks by relevance (rank DESC, id DESC), filters by FTS and returns the pinned count when search is present', async () => {
        // The page query and the count query each get their own builder, so
        // the FTS filter can be asserted on the count builder specifically.
        const pageBuilder = mockBuilder();
        pageBuilder.getMany.mockResolvedValue([]);
        const countBuilder = mockBuilder();
        countBuilder.getCount.mockResolvedValue(3);
        sermonRepository.createQueryBuilder
          .mockReturnValueOnce(pageBuilder)
          .mockReturnValueOnce(countBuilder);

        const result = await service.findAll(
          undefined,
          undefined,
          'благодать иван',
        );

        expect(result).toEqual({ sermons: [], count: 3, nextCursor: null });
        expect(pageBuilder.addSelect).toHaveBeenCalledWith(
          RANK_EXPRESSION,
          'rank',
        );
        expect(pageBuilder.where).toHaveBeenCalledWith(SEARCH_CONDITION);
        expect(pageBuilder.setParameter).toHaveBeenCalledWith(
          'tsquery',
          'благодать:* & иван:*',
        );
        expect(pageBuilder.orderBy).toHaveBeenCalledWith('rank', 'DESC');
        expect(pageBuilder.addOrderBy).toHaveBeenCalledWith(
          'sermon.id',
          'DESC',
        );
        // The count query applies the same FTS filter on its own builder.
        expect(countBuilder.where).toHaveBeenCalledWith(SEARCH_CONDITION);
        expect(countBuilder.setParameter).toHaveBeenCalledWith(
          'tsquery',
          'благодать:* & иван:*',
        );
        expect(countBuilder.getCount).toHaveBeenCalledTimes(1);
      });

      it('passes the sanitized tsquery to the parameter binding', async () => {
        const pageBuilder = mockBuilder();
        pageBuilder.getMany.mockResolvedValue([]);
        pageBuilder.getCount.mockResolvedValue(0);
        sermonRepository.createQueryBuilder.mockReturnValue(pageBuilder);

        await service.findAll(undefined, undefined, 'Благодать');

        expect(pageBuilder.setParameter).toHaveBeenCalledWith(
          'tsquery',
          'Благодать:*',
        );
      });
    });

    describe('keyset path (take supplied)', () => {
      it('keeps id-DESC order, the id cursor and getMany when search is absent', async () => {
        const pageBuilder = mockBuilder();
        pageBuilder.getMany.mockResolvedValue([]);
        sermonRepository.createQueryBuilder.mockReturnValue(pageBuilder);
        mockEmptyGraphQueries();
        const cursor = '123e4567-e89b-12d3-a456-426614174000';

        await service.findAll(2, cursor);

        expect(pageBuilder.orderBy).toHaveBeenCalledWith('sermon.id', 'DESC');
        expect(pageBuilder.andWhere).toHaveBeenCalledWith(
          'sermon.id < :cursor',
          {
            cursor,
          },
        );
        expect(pageBuilder.addSelect).not.toHaveBeenCalled();
        expect(pageBuilder.take).toHaveBeenCalledWith(3);
        expect(pageBuilder.getMany).toHaveBeenCalled();
        expect(pageBuilder.getRawAndEntities).not.toHaveBeenCalled();
        expect(pageBuilder.getCount).not.toHaveBeenCalled();
      });

      it('filters by FTS, orders by relevance and builds a composite next cursor when search is present', async () => {
        const pageBuilder = mockBuilder();
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
        pageBuilder.getRawAndEntities.mockResolvedValue({
          entities: [sermonA, sermonB, sermonC],
          raw: [
            { sermon_id: sermonA.id, rank: 0.6229741 },
            { sermon_id: sermonB.id, rank: 0.6229741 },
            { sermon_id: sermonC.id, rank: 0.18297999 },
          ],
        });
        sermonRepository.createQueryBuilder.mockReturnValue(pageBuilder);
        mockEmptyGraphQueries();

        const result = await service.findAll(2, undefined, 'благодать иван');

        expect(pageBuilder.addSelect).toHaveBeenCalledWith(
          RANK_EXPRESSION,
          'rank',
        );
        expect(pageBuilder.where).toHaveBeenCalledWith(SEARCH_CONDITION);
        expect(pageBuilder.setParameter).toHaveBeenCalledWith(
          'tsquery',
          'благодать:* & иван:*',
        );
        expect(pageBuilder.orderBy).toHaveBeenCalledWith('rank', 'DESC');
        expect(pageBuilder.addOrderBy).toHaveBeenCalledWith(
          'sermon.id',
          'DESC',
        );
        expect(pageBuilder.take).toHaveBeenCalledWith(3);
        expect(pageBuilder.getRawAndEntities).toHaveBeenCalled();
        expect(pageBuilder.getMany).not.toHaveBeenCalled();
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
        const pageBuilder = mockBuilder();
        pageBuilder.getRawAndEntities.mockResolvedValue({
          entities: [],
          raw: [],
        });
        sermonRepository.createQueryBuilder.mockReturnValue(pageBuilder);
        mockEmptyGraphQueries();
        const cursor = encodeCompositeCursor(
          0.6229741,
          'bbbbbbbb-0000-0000-0000-000000000002',
        );

        await service.findAll(2, cursor, 'благодать');

        expect(pageBuilder.andWhere).toHaveBeenCalledTimes(1);
        expect(pageBuilder.andWhere).toHaveBeenCalledWith(
          `(${RANK_EXPRESSION}, sermon.id) < (:rank::float4, :id)`,
          {
            rank: 0.6229741,
            id: 'bbbbbbbb-0000-0000-0000-000000000002',
          },
        );
      });

      it('returns a null next cursor when no further page exists', async () => {
        const pageBuilder = mockBuilder();
        const sermonA = {
          id: 'aaaaaaaa-0000-0000-0000-000000000001',
          playlistJoins: [],
        };
        const sermonB = {
          id: 'bbbbbbbb-0000-0000-0000-000000000002',
          playlistJoins: [],
        };
        pageBuilder.getRawAndEntities.mockResolvedValue({
          entities: [sermonA, sermonB],
          raw: [
            { sermon_id: sermonA.id, rank: 0.6229741 },
            { sermon_id: sermonB.id, rank: 0.18297999 },
          ],
        });
        sermonRepository.createQueryBuilder.mockReturnValue(pageBuilder);
        mockEmptyGraphQueries();

        const result = await service.findAll(2, undefined, 'благодать');

        expect(result.sermons.map((s) => s.id)).toEqual([
          sermonA.id,
          sermonB.id,
        ]);
        expect(result.nextCursor).toBeNull();
      });
    });

    describe('offset path (page/limit supplied)', () => {
      it('uses page 1 when only limit is supplied and skips the cursor logic entirely', async () => {
        const pageBuilder = mockBuilder();
        pageBuilder.getMany.mockResolvedValue([]);
        pageBuilder.getCount.mockResolvedValue(42);
        sermonRepository.createQueryBuilder.mockReturnValue(pageBuilder);
        mockEmptyGraphQueries();

        const result = await service.findAll(
          undefined,
          undefined,
          undefined,
          undefined,
          20,
        );

        expect(pageBuilder.skip).toHaveBeenCalledWith(0);
        expect(pageBuilder.take).toHaveBeenCalledWith(20);
        expect(pageBuilder.andWhere).not.toHaveBeenCalled();
        expect(pageBuilder.getRawAndEntities).not.toHaveBeenCalled();
        expect(pageBuilder.getCount).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ sermons: [], count: 42, nextCursor: null });
      });

      it('skips (page-1)*limit rows and takes limit', async () => {
        const pageBuilder = mockBuilder();
        pageBuilder.getMany.mockResolvedValue([]);
        pageBuilder.getCount.mockResolvedValue(42);
        sermonRepository.createQueryBuilder.mockReturnValue(pageBuilder);
        mockEmptyGraphQueries();

        await service.findAll(undefined, undefined, undefined, 3, 20);

        expect(pageBuilder.skip).toHaveBeenCalledWith(40);
        expect(pageBuilder.take).toHaveBeenCalledWith(20);
      });

      it('applies the FTS filter and relevance order in offset mode', async () => {
        const pageBuilder = mockBuilder();
        pageBuilder.getMany.mockResolvedValue([]);
        const countBuilder = mockBuilder();
        countBuilder.getCount.mockResolvedValue(3);
        sermonRepository.createQueryBuilder
          .mockReturnValueOnce(pageBuilder)
          .mockReturnValueOnce(countBuilder);
        mockEmptyGraphQueries();

        const result = await service.findAll(
          undefined,
          undefined,
          'благодать',
          1,
          10,
        );

        expect(pageBuilder.addSelect).toHaveBeenCalledWith(
          RANK_EXPRESSION,
          'rank',
        );
        expect(pageBuilder.where).toHaveBeenCalledWith(SEARCH_CONDITION);
        expect(pageBuilder.orderBy).toHaveBeenCalledWith('rank', 'DESC');
        expect(pageBuilder.addOrderBy).toHaveBeenCalledWith(
          'sermon.id',
          'DESC',
        );
        // The count query applies the same FTS filter on its own builder.
        expect(countBuilder.where).toHaveBeenCalledWith(SEARCH_CONDITION);
        expect(result).toEqual({ sermons: [], count: 3, nextCursor: null });
      });

      it('returns the total count and a null nextCursor in offset mode', async () => {
        const sermonA = { id: 'sermon-a', playlistJoins: [] };
        const sermonB = { id: 'sermon-b', playlistJoins: [] };
        const pageBuilder = mockBuilder();
        pageBuilder.getMany.mockResolvedValue([sermonA, sermonB]);
        pageBuilder.getCount.mockResolvedValue(5);
        sermonRepository.createQueryBuilder.mockReturnValue(pageBuilder);
        mockEmptyGraphQueries();

        const result = await service.findAll(
          undefined,
          undefined,
          undefined,
          1,
          2,
        );

        expect(result.sermons.map((s) => s.id)).toEqual([
          'sermon-a',
          'sermon-b',
        ]);
        expect(result.count).toBe(5);
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
        "btrim(sermon.artist, E' \\t\\n\\r') <> ''",
      );
      expect(bookBuilder.where).toHaveBeenCalledWith('sermon.book IS NOT NULL');
      expect(bookBuilder.andWhere).toHaveBeenCalledWith(
        "btrim(sermon.book, E' \\t\\n\\r') <> ''",
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

  describe('create (null description coercion)', () => {
    it('coerces a null description to an empty string before persisting', async () => {
      const created = { id: 's-1', title: 'Тест', description: null };
      sermonRepository.create = jest.fn().mockReturnValue(created);
      sermonRepository.save = jest
        .fn()
        .mockResolvedValue({ ...created, description: '' });
      sermonRepository.findOne = jest.fn().mockResolvedValue({
        id: 's-1',
        title: 'Тест',
        description: '',
        artist: '',
        artwork: '',
        playlists: [],
      });

      await service.create({ title: 'Тест', description: null } as never);

      expect(sermonRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Тест', description: '' }),
      );
      expect(sermonRepository.save).toHaveBeenCalledTimes(1);
    });

    it('keeps a non-null description as-is', async () => {
      const created = { id: 's-1', title: 'Тест', description: 'Описание' };
      sermonRepository.create = jest.fn().mockReturnValue(created);
      sermonRepository.save = jest.fn().mockResolvedValue(created);
      sermonRepository.findOne = jest.fn().mockResolvedValue({
        id: 's-1',
        title: 'Тест',
        description: 'Описание',
        artist: '',
        artwork: '',
        playlists: [],
      });

      await service.create({ title: 'Тест', description: 'Описание' } as never);

      expect(sermonRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'Описание' }),
      );
    });
  });

  describe('update (null description coercion)', () => {
    it('coerces a null description to an empty string in the update fields', async () => {
      sermonRepository.findOne = jest.fn().mockResolvedValue({
        id: 's-1',
        title: 'Тест',
        description: 'Старое',
      });
      sermonRepository.update = jest.fn().mockResolvedValue({ affected: 1 });

      await service.update('s-1', { description: null } as never);

      expect(sermonRepository.update).toHaveBeenCalledWith('s-1', {
        description: '',
      });
    });

    it('keeps a non-null description as-is on update', async () => {
      sermonRepository.findOne = jest.fn().mockResolvedValue({
        id: 's-1',
        title: 'Тест',
        description: 'Старое',
      });
      sermonRepository.update = jest.fn().mockResolvedValue({ affected: 1 });

      await service.update('s-1', { description: 'Новое' } as never);

      expect(sermonRepository.update).toHaveBeenCalledWith('s-1', {
        description: 'Новое',
      });
    });
  });

  describe('update (cross-request chapter-range verse consistency)', () => {
    // The DTO superRefine rule is request-scoped, so a PATCH that changes
    // verse while leaving chapter absent must be checked against the STORED
    // chapter — otherwise a stored chapter range could end up paired with a
    // segments verse, a state the DTOs declare impossible.
    it('rejects a segments verse when the stored chapter is a range and the PATCH leaves chapter absent', async () => {
      sermonRepository.findOne = jest.fn().mockResolvedValue({
        id: 's-1',
        title: 'Тест',
        description: 'Старое',
        chapter: [1, 2],
        verse: null,
      });
      sermonRepository.update = jest.fn().mockResolvedValue({ affected: 1 });

      await expect(
        service.update('s-1', { verse: [[9, 18], 20] } as never),
      ).rejects.toThrow(BadRequestException);

      expect(sermonRepository.update).not.toHaveBeenCalled();
    });

    it('accepts a verse range when the stored chapter is a range', async () => {
      sermonRepository.findOne = jest.fn().mockResolvedValue({
        id: 's-1',
        title: 'Тест',
        description: 'Старое',
        chapter: [1, 2],
        verse: null,
      });
      sermonRepository.update = jest.fn().mockResolvedValue({ affected: 1 });

      await service.update('s-1', { verse: [9, 18] } as never);

      expect(sermonRepository.update).toHaveBeenCalledWith('s-1', {
        verse: [9, 18],
      });
    });

    it('accepts a segments verse when the stored chapter is a single chapter', async () => {
      sermonRepository.findOne = jest.fn().mockResolvedValue({
        id: 's-1',
        title: 'Тест',
        description: 'Старое',
        chapter: 1,
        verse: null,
      });
      sermonRepository.update = jest.fn().mockResolvedValue({ affected: 1 });

      await service.update('s-1', { verse: [[9, 18], 20] } as never);

      expect(sermonRepository.update).toHaveBeenCalledWith('s-1', {
        verse: [[9, 18], 20],
      });
    });

    it('accepts a null verse clearing a stored chapter range (repair path)', async () => {
      // The subtlest edge: an explicit null must flow through as a "clear",
      // not fall back to the stored verse (a `??`-style refactor or a dropped
      // `!== null` check would turn this legal clear into a 400).
      sermonRepository.findOne = jest.fn().mockResolvedValue({
        id: 's-1',
        title: 'Тест',
        description: 'Старое',
        chapter: [1, 2],
        verse: [[9, 18], 20],
      });
      sermonRepository.update = jest.fn().mockResolvedValue({ affected: 1 });

      await service.update('s-1', { verse: null } as never);

      expect(sermonRepository.update).toHaveBeenCalledWith('s-1', {
        verse: null,
      });
    });

    it('rejects a chapter range when the stored verse is segments and the PATCH leaves verse absent', async () => {
      sermonRepository.findOne = jest.fn().mockResolvedValue({
        id: 's-1',
        title: 'Тест',
        description: 'Старое',
        chapter: 1,
        verse: [[9, 18], 20],
      });
      sermonRepository.update = jest.fn().mockResolvedValue({ affected: 1 });

      await expect(
        service.update('s-1', { chapter: [10, 11] } as never),
      ).rejects.toThrow(BadRequestException);

      expect(sermonRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('findAll normalized shape (characterization)', () => {
    const SERMONS_BY_ID = new Map(SEED_SERMONS.map((s) => [s.id, s]));
    const PLAYLISTS_BY_ID = new Map(SEED_PLAYLISTS.map((p) => [p.id, p]));
    const SECTIONS_BY_ID = new Map(SEED_SECTIONS.map((s) => [s.id, s]));

    // The expected shape is transcribed from the seed data by hand (NOT by
    // calling the service), so a change in HOW the graph is loaded must keep
    // the response byte-for-byte identical.

    const playlistBrief = (playlistId: string) => {
      const playlist = PLAYLISTS_BY_ID.get(playlistId);
      return { id: playlist.id, title: playlist.title };
    };

    const expectedSection = (sectionId: string) => {
      const section = SECTIONS_BY_ID.get(sectionId);
      return {
        id: section.id,
        title: section.title,
        description: section.description,
        position: section.position,
        itemsSize: section.itemsSize,
        itemsRows: section.itemsRows,
        transform: section.transform,
        isDescriptionTitleOnSlideLarge: section.isDescriptionTitleOnSlideLarge,
        whereIsSlideTitleLocated: section.whereIsSlideTitleLocated,
        borderRadius: section.borderRadius,
        playlists: [],
      };
    };

    const expectedNestedSermon = (sermonId: string, position: number) => {
      const sermon = SERMONS_BY_ID.get(sermonId);
      return {
        id: sermon.id,
        title: sermon.title,
        description: sermon.description,
        textFileUrl: sermon.textFileUrl,
        audioUrl: sermon.audioUrl,
        youtubeUrl: sermon.youtubeUrl,
        artist: sermon.artist,
        artwork: sermon.artwork,
        book: sermon.book,
        chapter: sermon.chapter,
        verse: sermon.verse,
        position,
        playlists: SEED_PLAYLIST_SERMON_JOINS.filter(
          (join) => join.sermonId === sermonId,
        )
          .sort((a, b) => a.position - b.position)
          .map((join) => playlistBrief(join.playlistId)),
      };
    };

    const expectedPlaylist = (playlistId: string) => {
      const playlist = PLAYLISTS_BY_ID.get(playlistId);
      return {
        id: playlist.id,
        title: playlist.title,
        description: playlist.description,
        artwork: playlist.artwork,
        sections: SEED_SECTION_PLAYLIST_JOINS.filter(
          (join) => join.playlistId === playlistId,
        )
          .sort((a, b) => a.position - b.position)
          .map((join) => expectedSection(join.sectionId)),
        sermons: SEED_PLAYLIST_SERMON_JOINS.filter(
          (join) => join.playlistId === playlistId,
        )
          .sort((a, b) => a.position - b.position)
          .map((join) => expectedNestedSermon(join.sermonId, join.position)),
      };
    };

    const expectedSermon = (sermonId: string) => {
      const sermon = SERMONS_BY_ID.get(sermonId);
      return {
        id: sermon.id,
        title: sermon.title,
        description: sermon.description,
        textFileUrl: sermon.textFileUrl,
        audioUrl: sermon.audioUrl,
        youtubeUrl: sermon.youtubeUrl,
        artist: sermon.artist,
        artwork: sermon.artwork,
        book: sermon.book,
        chapter: sermon.chapter,
        verse: sermon.verse,
        playlists: SEED_PLAYLIST_SERMON_JOINS.filter(
          (join) => join.sermonId === sermonId,
        )
          .sort((a, b) => a.position - b.position)
          .map((join) => expectedPlaylist(join.playlistId)),
      };
    };

    const seedSermonEntity = (sermonId: string): SermonEntity => {
      const seed = SERMONS_BY_ID.get(sermonId);
      return { ...seed, playlistJoins: [] };
    };
    const seedPlaylistEntity = (playlistId: string): PlaylistEntity => {
      const seed = PLAYLISTS_BY_ID.get(playlistId);
      return { ...seed, sectionJoins: [], sermonJoins: [] };
    };
    const seedSectionEntity = (sectionId: string): SectionEntity => {
      const seed = SECTIONS_BY_ID.get(sectionId);
      return { ...seed, playlistJoins: [] };
    };

    const seedPlaylistSermonJoin = (
      join: (typeof SEED_PLAYLIST_SERMON_JOINS)[number],
    ): PlaylistSermonJoinEntity => ({
      id: `psj-${join.playlistId}-${join.sermonId}`,
      playlistId: join.playlistId,
      sermonId: join.sermonId,
      position: join.position,
      playlist: undefined,
      sermon: undefined,
    });
    const seedSectionPlaylistJoin = (
      join: (typeof SEED_SECTION_PLAYLIST_JOINS)[number],
    ): SectionPlaylistJoinEntity => ({
      id: `spj-${join.playlistId}-${join.sectionId}`,
      playlistId: join.playlistId,
      sectionId: join.sectionId,
      position: join.position,
      playlist: undefined,
      section: undefined,
    });

    const allPlaylistSermonJoins = () =>
      [...SEED_PLAYLIST_SERMON_JOINS]
        .sort((a, b) => a.position - b.position)
        .map(seedPlaylistSermonJoin);
    const allSectionPlaylistJoins = () =>
      [...SEED_SECTION_PLAYLIST_JOINS]
        .sort((a, b) => a.position - b.position)
        .map(seedSectionPlaylistJoin);

    // Wires the repository mocks for the linear query set of assembleSermonGraph
    // (see the service for the query list). The returned page builder serves
    // both the page getMany and the count getCount.
    function mockLinearQueries(options: {
      pageSermons: SermonEntity[];
      count: number;
      pageSermonJoins: PlaylistSermonJoinEntity[];
      playlists: PlaylistEntity[];
      playlistSermonJoins: PlaylistSermonJoinEntity[];
      deepSermons: SermonEntity[];
      nestedPlaylistJoins: PlaylistSermonJoinEntity[];
      nestedPlaylists: PlaylistEntity[];
      sectionJoins: SectionPlaylistJoinEntity[];
      sections: SectionEntity[];
    }) {
      const pageBuilder = mockBuilder();
      pageBuilder.getMany.mockResolvedValue(options.pageSermons);
      pageBuilder.getCount.mockResolvedValue(options.count);
      sermonRepository.createQueryBuilder.mockReturnValue(pageBuilder);
      sermonRepository.find.mockResolvedValue(options.deepSermons);

      // Captured in creation order so tests can assert the SQL ORDER BY of each
      // join query — the mocked rows are pre-sorted in JS, so the response
      // shape alone cannot prove the ORDER BY exists.
      const joinBuilders: ReturnType<typeof mockBuilder>[] = [];
      const joinBuilder = (rows: unknown[]) => {
        const builder = mockBuilder();
        builder.getMany.mockResolvedValue(rows);
        joinBuilders.push(builder);
        return builder;
      };
      playlistSermonJoinRepository.createQueryBuilder
        .mockReturnValueOnce(joinBuilder(options.pageSermonJoins))
        .mockReturnValueOnce(joinBuilder(options.playlistSermonJoins))
        .mockReturnValue(joinBuilder(options.nestedPlaylistJoins));
      playlistRepository.find
        .mockResolvedValueOnce(options.playlists)
        .mockResolvedValueOnce(options.nestedPlaylists);
      sectionPlaylistJoinRepository.createQueryBuilder.mockReturnValue(
        joinBuilder(options.sectionJoins),
      );
      sectionRepository.find.mockResolvedValue(options.sections);
      return { pageBuilder, joinBuilders };
    }

    it('full fetch reproduces the complete normalized graph byte-for-byte', async () => {
      // Every sermon is on the page, so every playlist→sermon link appears in
      // both the page-join query and the playlist-join query; no off-page deep
      // sermon exists and no extra nested-join query runs.
      // The page query orders by id DESC, so the mocked rows mirror that.
      mockLinearQueries({
        pageSermons: [
          'sermon-5',
          'sermon-4',
          'sermon-3',
          'sermon-2',
          'sermon-1',
        ].map(seedSermonEntity),
        count: 5,
        pageSermonJoins: allPlaylistSermonJoins(),
        playlists: SEED_PLAYLISTS.map((seed) => seedPlaylistEntity(seed.id)),
        playlistSermonJoins: allPlaylistSermonJoins(),
        deepSermons: [],
        nestedPlaylistJoins: [],
        nestedPlaylists: SEED_PLAYLISTS.map((seed) =>
          seedPlaylistEntity(seed.id),
        ),
        sectionJoins: allSectionPlaylistJoins(),
        sections: SEED_SECTIONS.map((seed) => seedSectionEntity(seed.id)),
      });

      const result = await service.findAll();

      expect(result).toEqual({
        sermons: [
          'sermon-5',
          'sermon-4',
          'sermon-3',
          'sermon-2',
          'sermon-1',
        ].map(expectedSermon),
        count: 5,
        nextCursor: null,
      });
    });

    it('keyset page keeps off-page nested sermons inside the graph', async () => {
      // sermon-2 and sermon-1 form the page; sermon-3/4/5 only appear nested
      // inside their playlists, so the deep-sermon and nested-join queries are
      // exercised.
      mockLinearQueries({
        pageSermons: [
          seedSermonEntity('sermon-2'),
          seedSermonEntity('sermon-1'),
        ],
        count: 0,
        pageSermonJoins: [
          ...SEED_PLAYLIST_SERMON_JOINS.filter(
            (join) => join.sermonId === 'sermon-2',
          ),
        ]
          .sort((a, b) => a.position - b.position)
          .map(seedPlaylistSermonJoin),
        playlists: ['playlist-1', 'playlist-2'].map(seedPlaylistEntity),
        playlistSermonJoins: [
          ...SEED_PLAYLIST_SERMON_JOINS.filter((join) =>
            ['playlist-1', 'playlist-2'].includes(join.playlistId),
          ),
        ]
          .sort((a, b) => a.position - b.position)
          .map(seedPlaylistSermonJoin),
        deepSermons: ['sermon-3', 'sermon-4', 'sermon-5'].map(seedSermonEntity),
        nestedPlaylistJoins: allPlaylistSermonJoins(),
        nestedPlaylists: SEED_PLAYLISTS.map((seed) =>
          seedPlaylistEntity(seed.id),
        ),
        sectionJoins: [
          ...SEED_SECTION_PLAYLIST_JOINS.filter((join) =>
            ['playlist-1', 'playlist-2'].includes(join.playlistId),
          ),
        ]
          .sort((a, b) => a.position - b.position)
          .map(seedSectionPlaylistJoin),
        sections: SEED_SECTIONS.map((seed) => seedSectionEntity(seed.id)),
      });

      const result = await service.findAll(2);

      expect(result).toEqual({
        sermons: ['sermon-2', 'sermon-1'].map(expectedSermon),
        count: null,
        nextCursor: null,
      });
    });

    it('fails fast when a playlist row is missing for an existing join (dangling FK)', async () => {
      mockLinearQueries({
        pageSermons: [seedSermonEntity('sermon-2')],
        count: 1,
        pageSermonJoins: [
          seedPlaylistSermonJoin({
            playlistId: 'playlist-missing',
            sermonId: 'sermon-2',
            position: 0,
          }),
        ],
        playlists: [],
        playlistSermonJoins: [],
        deepSermons: [],
        nestedPlaylistJoins: [],
        nestedPlaylists: [],
        sectionJoins: [],
        sections: [],
      });

      await expect(service.findAll()).rejects.toThrow(
        'Playlist "playlist-missing" of sermon "sermon-2" not found',
      );
    });

    it('orders every join query by position ASC with an id ASC tiebreaker', async () => {
      // The mocked rows are pre-sorted in JS, so the response shape cannot
      // reveal whether the SQL ORDER BY exists — assert it directly on the
      // captured builders. All four join queries must order by position ASC
      // and break ties by id ASC so equal positions stay deterministic.
      const { joinBuilders } = mockLinearQueries({
        pageSermons: [seedSermonEntity('sermon-2')],
        count: 1,
        pageSermonJoins: [
          seedPlaylistSermonJoin({
            playlistId: 'playlist-1',
            sermonId: 'sermon-2',
            position: 0,
          }),
        ],
        playlists: [seedPlaylistEntity('playlist-1')],
        playlistSermonJoins: [
          seedPlaylistSermonJoin({
            playlistId: 'playlist-1',
            sermonId: 'sermon-2',
            position: 0,
          }),
          seedPlaylistSermonJoin({
            playlistId: 'playlist-1',
            sermonId: 'sermon-3',
            position: 1,
          }),
        ],
        deepSermons: [seedSermonEntity('sermon-3')],
        nestedPlaylistJoins: [
          seedPlaylistSermonJoin({
            playlistId: 'playlist-1',
            sermonId: 'sermon-3',
            position: 0,
          }),
        ],
        nestedPlaylists: [seedPlaylistEntity('playlist-1')],
        sectionJoins: [
          seedSectionPlaylistJoin({
            playlistId: 'playlist-1',
            sectionId: 'section-a',
            position: 0,
          }),
        ],
        sections: [seedSectionEntity('section-a')],
      });

      await service.findAll(2);

      // Creation order: pageSermonJoins, playlistSermonJoins,
      // nestedPlaylistJoins (all on the playlistSermonJoin alias), then
      // sectionJoins (sectionPlaylistJoin alias).
      const expectedOrders = [
        {
          orderBy: 'playlistSermonJoin.position',
          addOrderBy: 'playlistSermonJoin.id',
        },
        {
          orderBy: 'playlistSermonJoin.position',
          addOrderBy: 'playlistSermonJoin.id',
        },
        {
          orderBy: 'playlistSermonJoin.position',
          addOrderBy: 'playlistSermonJoin.id',
        },
        {
          orderBy: 'sectionPlaylistJoin.position',
          addOrderBy: 'sectionPlaylistJoin.id',
        },
      ];
      expect(joinBuilders).toHaveLength(expectedOrders.length);
      joinBuilders.forEach((builder, index) => {
        expect(builder.orderBy).toHaveBeenCalledWith(
          expectedOrders[index].orderBy,
          'ASC',
        );
        expect(builder.addOrderBy).toHaveBeenCalledWith(
          expectedOrders[index].addOrderBy,
          'ASC',
        );
      });
    });
  });

  describe('remove (best-effort audio cleanup)', () => {
    it('deletes the DB row and removes the audio file only after a successful deletion', async () => {
      sermonRepository.findOne = jest.fn().mockResolvedValue({
        id: 's-1',
        audioUrl: 'https://minio.example.com/files/audio-1.mp3',
      });
      sermonRepository.delete = jest.fn().mockResolvedValue({ affected: 1 });
      minioService.removeObjectByUrl.mockResolvedValue(undefined);

      const result = await service.remove('s-1');

      expect(sermonRepository.delete).toHaveBeenCalledWith('s-1');
      expect(minioService.removeObjectByUrl).toHaveBeenCalledWith(
        'https://minio.example.com/files/audio-1.mp3',
      );
      // The DB row must be deleted before the file cleanup runs.
      expect(sermonRepository.delete.mock.invocationCallOrder[0]).toBeLessThan(
        minioService.removeObjectByUrl.mock.invocationCallOrder[0],
      );
      expect(result).toEqual({ status: 'success' });
    });

    it('skips file cleanup when the sermon has no audio file', async () => {
      sermonRepository.findOne = jest.fn().mockResolvedValue({
        id: 's-1',
        audioUrl: null,
      });
      sermonRepository.delete = jest.fn().mockResolvedValue({ affected: 1 });

      await service.remove('s-1');

      expect(minioService.removeObjectByUrl).not.toHaveBeenCalled();
    });

    it('never fails the request when file cleanup throws', async () => {
      sermonRepository.findOne = jest.fn().mockResolvedValue({
        id: 's-1',
        audioUrl: 'https://minio.example.com/files/audio-1.mp3',
      });
      sermonRepository.delete = jest.fn().mockResolvedValue({ affected: 1 });
      minioService.removeObjectByUrl.mockRejectedValue(new Error('MinIO down'));

      const result = await service.remove('s-1');

      expect(sermonRepository.delete).toHaveBeenCalledWith('s-1');
      expect(result).toEqual({ status: 'success' });
    });

    it('does not touch storage when the sermon row does not exist', async () => {
      sermonRepository.findOne = jest.fn().mockResolvedValue(null);
      sermonRepository.delete = jest.fn().mockResolvedValue({ affected: 0 });

      const result = await service.remove('s-1');

      expect(minioService.removeObjectByUrl).not.toHaveBeenCalled();
      expect(result).toEqual({ status: 'success' });
    });
  });
});
