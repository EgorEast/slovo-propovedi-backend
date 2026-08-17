import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { In } from 'typeorm';
import {
  PlaylistService,
  buildPlaylistSearchVectorExpression,
} from './playlist.service';
import { PlaylistEntity } from './entities/playlist.entity';
import { PlaylistSermonJoinEntity } from './entities/playlist-sermon-join.entity';
import { SectionEntity } from 'src/section/entities/section.entity';
import { SectionPlaylistJoinEntity } from 'src/section/entities/section-playlist-join.entity';
import { SermonService } from 'src/sermon/sermon.service';

// Mirror of the service's canonical tsvector expression — asserting the exact
// string guards the runtime behavior against accidental edits to
// PLAYLIST_SEARCH_WEIGHTS (and keeps the migration
// sql/migrations/006_playlist_search_tsvector.sql honest).
const PLAYLIST_SEARCH_VECTOR_EXPRESSION =
  "setweight(to_tsvector('russian', coalesce(title, '')), 'A') || " +
  "setweight(to_tsvector('russian', coalesce(description, '')), 'D')";

const PLAYLIST_RANK_EXPRESSION =
  "ts_rank('{0.1,0.2,0.4,1.0}'::float4[], playlist.search_vector, to_tsquery('russian', :tsquery))";

const PLAYLIST_SEARCH_CONDITION =
  "playlist.search_vector @@ to_tsquery('russian', :tsquery)";

// Mirrors of the service's relation graph constants — asserting the exact
// findAndCount arguments guards the no-search path against regressions.
const PLAYLIST_RELATIONS = [
  'sermonJoins',
  'sermonJoins.sermon',
  'sermonJoins.sermon.playlistJoins',
  'sermonJoins.sermon.playlistJoins.playlist',
  'sectionJoins',
  'sectionJoins.section',
];

const PLAYLIST_ORDER = {
  id: 'DESC',
  sermonJoins: { position: 'ASC' },
  sectionJoins: { position: 'ASC' },
};

describe('PlaylistService', () => {
  let service: PlaylistService;
  let playlistRepository: {
    createQueryBuilder: jest.Mock;
    findAndCount: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock };

  beforeEach(async () => {
    playlistRepository = {
      createQueryBuilder: jest.fn(),
      findAndCount: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
    };
    dataSource = { transaction: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaylistService,
        {
          provide: SermonService,
          useValue: {},
        },
        {
          provide: getRepositoryToken(PlaylistEntity),
          useValue: playlistRepository,
        },
        {
          provide: getRepositoryToken(SectionEntity),
          useValue: {},
        },
        {
          provide: getRepositoryToken(SectionPlaylistJoinEntity),
          useValue: {},
        },
        {
          provide: getRepositoryToken(PlaylistSermonJoinEntity),
          useValue: {},
        },
        {
          provide: getDataSourceToken(),
          useValue: dataSource,
        },
      ],
    }).compile();

    service = module.get<PlaylistService>(PlaylistService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('buildPlaylistSearchVectorExpression (single source of truth for weights)', () => {
    it('weights title A and description D in the migration order', () => {
      expect(buildPlaylistSearchVectorExpression()).toBe(
        PLAYLIST_SEARCH_VECTOR_EXPRESSION,
      );
    });
  });

  describe('findAll', () => {
    function mockQueryBuilder() {
      const queryBuilder = {
        leftJoinAndSelect: jest.fn(),
        select: jest.fn(),
        orderBy: jest.fn(),
        addOrderBy: jest.fn(),
        addSelect: jest.fn(),
        where: jest.fn(),
        setParameter: jest.fn(),
        skip: jest.fn(),
        take: jest.fn(),
        getManyAndCount: jest.fn(),
        getRawMany: jest.fn(),
        getCount: jest.fn(),
      };
      [
        'leftJoinAndSelect',
        'select',
        'orderBy',
        'addOrderBy',
        'addSelect',
        'where',
        'setParameter',
        'skip',
        'take',
      ].forEach((method) => queryBuilder[method].mockReturnValue(queryBuilder));
      queryBuilder.getManyAndCount.mockResolvedValue([[], 0]);
      queryBuilder.getRawMany.mockResolvedValue([]);
      queryBuilder.getCount.mockResolvedValue(0);
      playlistRepository.createQueryBuilder.mockReturnValue(queryBuilder);
      return queryBuilder;
    }

    it('keeps the findAndCount path with DB-level relation ordering when search is absent', async () => {
      playlistRepository.findAndCount.mockResolvedValue([[], 5]);

      const result = await service.findAll();

      expect(playlistRepository.findAndCount).toHaveBeenCalledWith({
        relations: PLAYLIST_RELATIONS,
        order: PLAYLIST_ORDER,
      });
      expect(playlistRepository.createQueryBuilder).not.toHaveBeenCalled();
      expect(result).toEqual({ playlists: [], count: 5 });
    });

    it('ranks by relevance (rank DESC, id DESC) and filters by FTS when search is present', async () => {
      const queryBuilder = mockQueryBuilder();
      queryBuilder.getManyAndCount.mockResolvedValue([[], 2]);

      const result = await service.findAll('благодать');

      // The deep relation graph must match the findAndCount path exactly:
      // normalizePlaylist treats absent relations as [], so a dropped join
      // would be silent data loss invisible to the suite.
      expect(queryBuilder.leftJoinAndSelect).toHaveBeenCalledWith(
        'playlist.sermonJoins',
        'sermonJoins',
      );
      expect(queryBuilder.leftJoinAndSelect).toHaveBeenCalledWith(
        'sermonJoins.sermon',
        'sermons',
      );
      expect(queryBuilder.leftJoinAndSelect).toHaveBeenCalledWith(
        'sermons.playlistJoins',
        'sermonPlaylistJoins',
      );
      expect(queryBuilder.leftJoinAndSelect).toHaveBeenCalledWith(
        'sermonPlaylistJoins.playlist',
        'sermonPlaylists',
      );
      expect(queryBuilder.leftJoinAndSelect).toHaveBeenCalledWith(
        'playlist.sectionJoins',
        'sectionJoins',
      );
      expect(queryBuilder.leftJoinAndSelect).toHaveBeenCalledWith(
        'sectionJoins.section',
        'sections',
      );
      expect(queryBuilder.addSelect).toHaveBeenCalledWith(
        PLAYLIST_RANK_EXPRESSION,
        'rank',
      );
      expect(queryBuilder.where).toHaveBeenCalledWith(
        PLAYLIST_SEARCH_CONDITION,
      );
      expect(queryBuilder.setParameter).toHaveBeenCalledWith(
        'tsquery',
        'благодать:*',
      );
      expect(queryBuilder.orderBy).toHaveBeenCalledWith('rank', 'DESC');
      expect(queryBuilder.addOrderBy).toHaveBeenCalledWith(
        'playlist.id',
        'DESC',
      );
      expect(queryBuilder.addOrderBy).toHaveBeenCalledWith(
        'sermonJoins.position',
        'ASC',
      );
      expect(queryBuilder.addOrderBy).toHaveBeenCalledWith(
        'sectionJoins.position',
        'ASC',
      );
      expect(queryBuilder.getManyAndCount).toHaveBeenCalledTimes(1);
      expect(playlistRepository.findAndCount).not.toHaveBeenCalled();
      expect(result).toEqual({ playlists: [], count: 2 });
    });

    it('passes the sanitized tsquery to the parameter binding', async () => {
      const queryBuilder = mockQueryBuilder();

      await service.findAll('Благодать');

      expect(queryBuilder.setParameter).toHaveBeenCalledWith(
        'tsquery',
        'Благодать:*',
      );
    });

    it('fails fast on punctuation-only search without touching the repository', async () => {
      await expect(service.findAll('!!!')).rejects.toThrow(BadRequestException);

      expect(playlistRepository.createQueryBuilder).not.toHaveBeenCalled();
      expect(playlistRepository.findAndCount).not.toHaveBeenCalled();
    });

    it('never touches the QueryBuilder for undefined or empty search', async () => {
      playlistRepository.findAndCount.mockResolvedValue([[], 0]);

      await service.findAll();
      await service.findAll(undefined);
      await service.findAll('');

      expect(playlistRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    describe('offset path (page/limit supplied)', () => {
      const playlistEntity = (id: string): PlaylistEntity => ({
        id,
        title: `Плейлист ${id}`,
        description: '',
        artwork: '',
        sectionJoins: [],
        sermonJoins: [],
      });

      it('pages parent ids by id DESC, counts separately and hydrates via IN', async () => {
        const idBuilder = mockQueryBuilder();
        idBuilder.getRawMany.mockResolvedValue([
          { id: 'pl-3' },
          { id: 'pl-2' },
        ]);
        const countBuilder = mockQueryBuilder();
        countBuilder.getCount.mockResolvedValue(5);
        playlistRepository.createQueryBuilder
          .mockReturnValueOnce(idBuilder)
          .mockReturnValueOnce(countBuilder);
        playlistRepository.find.mockResolvedValue([
          playlistEntity('pl-2'),
          playlistEntity('pl-3'),
        ]);

        const result = await service.findAll(undefined, 1, 2);

        expect(idBuilder.select).toHaveBeenCalledWith('playlist.id', 'id');
        expect(idBuilder.orderBy).toHaveBeenCalledWith('playlist.id', 'DESC');
        expect(idBuilder.skip).toHaveBeenCalledWith(0);
        expect(idBuilder.take).toHaveBeenCalledWith(2);
        expect(idBuilder.getRawMany).toHaveBeenCalledTimes(1);
        expect(countBuilder.getCount).toHaveBeenCalledTimes(1);
        expect(playlistRepository.find).toHaveBeenCalledWith({
          where: { id: In(['pl-3', 'pl-2']) },
          relations: PLAYLIST_RELATIONS,
          order: PLAYLIST_ORDER,
        });
        // The hydrated rows came back shuffled — the response must follow the
        // id-page order (pl-3 before pl-2).
        expect(result.playlists.map((p) => p.id)).toEqual(['pl-3', 'pl-2']);
        expect(result.count).toBe(5);
      });

      it('orders the id page by rank DESC then id DESC under search', async () => {
        const idBuilder = mockQueryBuilder();
        idBuilder.getRawMany.mockResolvedValue([{ id: 'pl-1' }]);
        const countBuilder = mockQueryBuilder();
        countBuilder.getCount.mockResolvedValue(1);
        playlistRepository.createQueryBuilder
          .mockReturnValueOnce(idBuilder)
          .mockReturnValueOnce(countBuilder);
        playlistRepository.find.mockResolvedValue([playlistEntity('pl-1')]);

        await service.findAll('благодать', 1, 10);

        expect(idBuilder.addSelect).toHaveBeenCalledWith(
          PLAYLIST_RANK_EXPRESSION,
          'rank',
        );
        expect(idBuilder.where).toHaveBeenCalledWith(PLAYLIST_SEARCH_CONDITION);
        expect(idBuilder.setParameter).toHaveBeenCalledWith(
          'tsquery',
          'благодать:*',
        );
        expect(idBuilder.orderBy).toHaveBeenCalledWith('rank', 'DESC');
        expect(idBuilder.addOrderBy).toHaveBeenCalledWith(
          'playlist.id',
          'DESC',
        );
        // The count query applies the same FTS filter on its own builder.
        expect(countBuilder.where).toHaveBeenCalledWith(
          PLAYLIST_SEARCH_CONDITION,
        );
      });

      it('uses page 1 when only limit is supplied', async () => {
        const idBuilder = mockQueryBuilder();
        idBuilder.getRawMany.mockResolvedValue([]);
        const countBuilder = mockQueryBuilder();
        countBuilder.getCount.mockResolvedValue(0);
        playlistRepository.createQueryBuilder
          .mockReturnValueOnce(idBuilder)
          .mockReturnValueOnce(countBuilder);
        playlistRepository.find.mockResolvedValue([]);

        const result = await service.findAll(undefined, undefined, 20);

        expect(idBuilder.skip).toHaveBeenCalledWith(0);
        expect(idBuilder.take).toHaveBeenCalledWith(20);
        expect(result).toEqual({ playlists: [], count: 0 });
      });

      it('fails fast when a page id is missing from the hydration query (dangling FK)', async () => {
        const idBuilder = mockQueryBuilder();
        idBuilder.getRawMany.mockResolvedValue([
          { id: 'pl-1' },
          { id: 'pl-missing' },
        ]);
        const countBuilder = mockQueryBuilder();
        countBuilder.getCount.mockResolvedValue(2);
        playlistRepository.createQueryBuilder
          .mockReturnValueOnce(idBuilder)
          .mockReturnValueOnce(countBuilder);
        playlistRepository.find.mockResolvedValue([playlistEntity('pl-1')]);

        await expect(service.findAll(undefined, 1, 10)).rejects.toThrow(
          'Playlist "pl-missing" missing from hydration query',
        );
      });
    });
  });

  describe('create (null description coercion)', () => {
    it('coerces a null description to an empty string before persisting', async () => {
      const createMock = jest
        .fn()
        .mockImplementation((dto) => ({ id: 'pl-1', ...dto }));
      const saveMock = jest.fn().mockResolvedValue({
        id: 'pl-1',
        title: 'Тест',
        description: '',
        artwork: '',
      });
      const manager = {
        getRepository: jest.fn().mockImplementation((entity) => {
          if (entity === PlaylistEntity) {
            return { create: createMock, save: saveMock };
          }
          if (entity === PlaylistSermonJoinEntity) {
            return { create: jest.fn(), save: jest.fn() };
          }
          throw new Error(`unexpected entity ${entity}`);
        }),
      };
      dataSource.transaction = jest
        .fn()
        .mockImplementation(async (_isolation, callback) => callback(manager));
      playlistRepository.findOne = jest.fn().mockResolvedValue({
        id: 'pl-1',
        title: 'Тест',
        description: '',
        artwork: '',
        sermonJoins: [],
        sectionJoins: [],
      });

      await service.create({
        title: 'Тест',
        description: null,
        artwork: '',
      } as never);

      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Тест',
          description: '',
          artwork: '',
        }),
      );
      expect(saveMock).toHaveBeenCalledTimes(1);
    });

    it('keeps a non-null description as-is', async () => {
      const createMock = jest
        .fn()
        .mockImplementation((dto) => ({ id: 'pl-1', ...dto }));
      const manager = {
        getRepository: jest.fn().mockImplementation((entity) => {
          if (entity === PlaylistEntity) {
            return {
              create: createMock,
              save: jest.fn().mockResolvedValue({ id: 'pl-1' }),
            };
          }
          if (entity === PlaylistSermonJoinEntity) {
            return { create: jest.fn(), save: jest.fn() };
          }
          throw new Error(`unexpected entity ${entity}`);
        }),
      };
      dataSource.transaction = jest
        .fn()
        .mockImplementation(async (_isolation, callback) => callback(manager));
      playlistRepository.findOne = jest.fn().mockResolvedValue({
        id: 'pl-1',
        title: 'Тест',
        description: 'Описание',
        artwork: '',
        sermonJoins: [],
        sectionJoins: [],
      });

      await service.create({
        title: 'Тест',
        description: 'Описание',
        artwork: '',
      } as never);

      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'Описание' }),
      );
    });
  });

  describe('update (null description coercion)', () => {
    it('coerces a null description to an empty string on update', async () => {
      playlistRepository.findOne = jest
        .fn()
        .mockResolvedValueOnce({
          id: 'pl-1',
          title: 'Тест',
          description: 'Старое',
          artwork: '',
          sermonJoins: [],
          sectionJoins: [],
        })
        .mockResolvedValueOnce({
          id: 'pl-1',
          title: 'Тест',
          description: '',
          artwork: '',
          sermonJoins: [],
          sectionJoins: [],
        });
      playlistRepository.save = jest
        .fn()
        .mockImplementation(async (playlist) => playlist);

      await service.update('pl-1', { description: null } as never);

      expect(playlistRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ description: '' }),
      );
    });

    it('keeps a non-null description as-is on update', async () => {
      playlistRepository.findOne = jest
        .fn()
        .mockResolvedValueOnce({
          id: 'pl-1',
          title: 'Тест',
          description: 'Старое',
          artwork: '',
          sermonJoins: [],
          sectionJoins: [],
        })
        .mockResolvedValueOnce({
          id: 'pl-1',
          title: 'Тест',
          description: 'Новое',
          artwork: '',
          sermonJoins: [],
          sectionJoins: [],
        });
      playlistRepository.save = jest
        .fn()
        .mockImplementation(async (playlist) => playlist);

      await service.update('pl-1', { description: 'Новое' } as never);

      expect(playlistRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'Новое' }),
      );
    });
  });
});
