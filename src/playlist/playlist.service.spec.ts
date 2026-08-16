import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
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
  sermonJoins: { position: 'ASC' },
  sectionJoins: { position: 'ASC' },
};

describe('PlaylistService', () => {
  let service: PlaylistService;
  let playlistRepository: {
    createQueryBuilder: jest.Mock;
    findAndCount: jest.Mock;
  };

  beforeEach(async () => {
    playlistRepository = {
      createQueryBuilder: jest.fn(),
      findAndCount: jest.fn(),
    };

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
          useValue: {},
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
        orderBy: jest.fn(),
        addOrderBy: jest.fn(),
        addSelect: jest.fn(),
        where: jest.fn(),
        setParameter: jest.fn(),
        getManyAndCount: jest.fn(),
      };
      [
        'leftJoinAndSelect',
        'orderBy',
        'addOrderBy',
        'addSelect',
        'where',
        'setParameter',
      ].forEach((method) => queryBuilder[method].mockReturnValue(queryBuilder));
      queryBuilder.getManyAndCount.mockResolvedValue([[], 0]);
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
  });
});
