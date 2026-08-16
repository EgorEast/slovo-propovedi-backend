import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { UpdatePlaylistDto } from './dto/update-playlist.dto';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { PlaylistEntity } from './entities/playlist.entity';
import { PlaylistSermonJoinEntity } from './entities/playlist-sermon-join.entity';
import { SectionEntity } from 'src/section/entities/section.entity';
import { SectionPlaylistJoinEntity } from 'src/section/entities/section-playlist-join.entity';
import { DataSource, In, Repository, SelectQueryBuilder } from 'typeorm';
import {
  AllPlaylistsResponse,
  NormalizedPlaylistResponse,
  StatusPlaylistResponse,
} from './interfaces/interface';
import { buildSearchTsQuery, SermonService } from 'src/sermon/sermon.service';

const PLAYLIST_RELATIONS = [
  'sermonJoins',
  'sermonJoins.sermon',
  'sermonJoins.sermon.playlistJoins',
  'sermonJoins.sermon.playlistJoins.playlist',
  'sectionJoins',
  'sectionJoins.section',
];

// DB-level ordering for every relation path the normalize function exposes —
// sermon and section joins are both ordered by position, so no in-memory
// re-sorting is needed.
const PLAYLIST_ORDER = {
  sermonJoins: { position: 'ASC' },
  sectionJoins: { position: 'ASC' },
} as const;

// ---------------------------------------------------------------------------
// Full-text search: boundary parsing + single source of truth for the weights
// ---------------------------------------------------------------------------
//
// Search is word-order-independent AND relevance-ranked via PostgreSQL FTS on
// the generated column playlist.search_vector (sql/migrations/006_playlist
// _search_tsvector.sql): the fields below are folded into the vector once,
// weighted, and the findAll search path matches a tsquery against it and ranks
// with the same ts_rank expression. The raw search string is parsed into a
// tsquery at the boundary by buildSearchTsQuery — shared with the sermon module
// (it throws a BadRequestException for punctuation-only input, which is the
// desired fail-loud behavior).

const TS_CONFIG = 'russian';

// Weighted searchable fields — the single source of truth for what the FTS
// vector indexes and how it ranks. The generated column expression (migration
// 006 + bootstrap) is derived from this exact definition.
const PLAYLIST_SEARCH_WEIGHTS = {
  A: ['title'],
  D: ['description'],
} as const;

// Canonical tsvector expression backing playlist.search_vector — must match
// sql/migrations/006_playlist_search_tsvector.sql and sql/bootstrap.sql.
export const buildPlaylistSearchVectorExpression = (): string =>
  (
    Object.entries(PLAYLIST_SEARCH_WEIGHTS) as Array<
      [string, readonly string[]]
    >
  )
    .flatMap(([weight, fields]) =>
      fields.map(
        (field) =>
          `setweight(to_tsvector('${TS_CONFIG}', coalesce(${field}, '')), '${weight}')`,
      ),
    )
    .join(' || ');

// Postgres ts_rank weight array — elements are D, C, B, A in that order, so
// description (D) ranks lowest and title (A) highest; B and C are unused by
// playlist search (B is the sermon-only artist/book weight, C keeps the
// default 0.2). Same array as the sermon search.
const TS_RANK_WEIGHTS = '{0.1,0.2,0.4,1.0}';

// The sanitized token string is bound as :tsquery and parsed by to_tsquery
// (which applies the russian stemmer — a raw text param bound to @@ would NOT
// stem and would miss matches).
const toTsQuerySql = () => `to_tsquery('${TS_CONFIG}', :tsquery)`;

// FTS match condition for the playlist search path.
const PLAYLIST_TS_SEARCH_CONDITION = `playlist.search_vector @@ ${toTsQuerySql()}`;

// ts_rank expression used by ORDER BY — the SAME :tsquery parameter is bound
// in the WHERE clause and here, so a row's rank matches its filter.
const buildPlaylistRankExpression = (): string =>
  `ts_rank('${TS_RANK_WEIGHTS}'::float4[], playlist.search_vector, ${toTsQuerySql()})`;

@Injectable()
export class PlaylistService {
  constructor(
    private sermonService: SermonService,
    @InjectRepository(PlaylistEntity)
    private playlistRepository: Repository<PlaylistEntity>,
    @InjectRepository(SectionEntity)
    private sectionRepository: Repository<SectionEntity>,
    @InjectRepository(SectionPlaylistJoinEntity)
    private sectionPlaylistJoinRepository: Repository<SectionPlaylistJoinEntity>,
    @InjectDataSource()
    private dataSource: DataSource,
  ) {}

  async create(
    createPlaylistDto: CreatePlaylistDto,
  ): Promise<NormalizedPlaylistResponse> {
    try {
      const saved = await this.dataSource.transaction(
        'SERIALIZABLE',
        async (manager) => {
          const playlistRepository = manager.getRepository(PlaylistEntity);
          const playlistSermonJoinRepository = manager.getRepository(
            PlaylistSermonJoinEntity,
          );

          const playlist = playlistRepository.create({
            title: createPlaylistDto.title,
            description: createPlaylistDto.description,
            artwork: createPlaylistDto.artwork,
            sectionJoins: [],
            sermonJoins: [],
          });
          const saved = await playlistRepository.save(playlist);

          if (createPlaylistDto.sermonsIds?.length) {
            const sermons = await this.sermonService.findByIds(
              createPlaylistDto.sermonsIds,
            );
            if (sermons.length !== createPlaylistDto.sermonsIds.length) {
              throw new NotFoundException('Some sermons not found');
            }
            const joinRows = createPlaylistDto.sermonsIds.map(
              (sermonId, index) =>
                playlistSermonJoinRepository.create({
                  playlistId: saved.id,
                  sermonId,
                  position: index,
                }),
            );
            await playlistSermonJoinRepository.save(joinRows);
          }

          // Mirror of the sermonsIds flow: validation lives inside the
          // transaction, so a throw aborts it and no playlist is persisted.
          if (createPlaylistDto.sectionsIds?.length) {
            if (
              new Set(createPlaylistDto.sectionsIds).size !==
              createPlaylistDto.sectionsIds.length
            ) {
              throw new BadRequestException('Duplicate section IDs detected');
            }
            const sections = await this.sectionRepository.find({
              where: { id: In(createPlaylistDto.sectionsIds) },
            });
            if (sections.length !== createPlaylistDto.sectionsIds.length) {
              throw new NotFoundException('Some sections not found');
            }
          }

          return saved;
        },
      );

      // Attach after the create transaction commits, mirroring the sermon
      // precedent (SermonService.create → attachSermonToPlaylists): the helper
      // opens its own SERIALIZABLE transaction, so it must not run inside this
      // one. Validation above already guaranteed every section exists.
      await this.attachPlaylistToSections(saved, createPlaylistDto.sectionsIds);

      // Re-read after the transactions so the response reflects the fully
      // persisted playlist.
      return await this.findOne(saved.id);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'from:createPlaylist ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async findAll(search?: string): Promise<AllPlaylistsResponse> {
    try {
      // Parse the search term at the boundary ONCE: the sanitized tsquery
      // drives the WHERE condition and the ORDER BY ranking. Punctuation-only
      // input fails fast inside buildSearchTsQuery.
      const tsquery = search ? buildSearchTsQuery(search) : undefined;

      if (!tsquery) {
        // Backward-compatible full fetch — byte-for-byte the pre-search
        // implementation (findAndCount with the deep relation graph and the
        // DB-level join ordering).
        const [playlists, count] = await this.playlistRepository.findAndCount({
          relations: PLAYLIST_RELATIONS,
          order: PLAYLIST_ORDER,
        });
        return {
          playlists: playlists.map((p) => this.normalizePlaylist(p)),
          count,
        };
      }

      // Relevance-ranked search: (rank DESC, id DESC) followed by the
      // join-position orders, loading the same relation graph findAndCount
      // would.
      const queryBuilder = this.buildPlaylistSearchQueryBuilder([
        ['rank', 'DESC'],
        ['playlist.id', 'DESC'],
      ]);
      queryBuilder
        .addSelect(buildPlaylistRankExpression(), 'rank')
        .where(PLAYLIST_TS_SEARCH_CONDITION)
        .setParameter('tsquery', tsquery);
      const [playlists, count] = await queryBuilder.getManyAndCount();
      return {
        playlists: playlists.map((p) => this.normalizePlaylist(p)),
        count,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'from:findAllPlaylistItems ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // QueryBuilder for the search path: the deep relation graph (the six
  // PLAYLIST_RELATIONS paths) plus the primary ordering (rank DESC, id DESC
  // under search) followed by the join-position orders normalizePlaylist
  // expects.
  private buildPlaylistSearchQueryBuilder(
    primaryOrders: Array<[order: string, direction: 'ASC' | 'DESC']>,
  ): SelectQueryBuilder<PlaylistEntity> {
    const queryBuilder = this.playlistRepository
      .createQueryBuilder('playlist')
      .leftJoinAndSelect('playlist.sermonJoins', 'sermonJoins')
      .leftJoinAndSelect('sermonJoins.sermon', 'sermons')
      .leftJoinAndSelect('sermons.playlistJoins', 'sermonPlaylistJoins')
      .leftJoinAndSelect('sermonPlaylistJoins.playlist', 'sermonPlaylists')
      .leftJoinAndSelect('playlist.sectionJoins', 'sectionJoins')
      .leftJoinAndSelect('sectionJoins.section', 'sections');

    // orderBy replaces any previous order, addOrderBy appends — apply the
    // primary orders first, then the relation orders.
    primaryOrders.forEach(([order, direction], index) => {
      if (index === 0) {
        queryBuilder.orderBy(order, direction);
      } else {
        queryBuilder.addOrderBy(order, direction);
      }
    });

    return queryBuilder
      .addOrderBy('sermonJoins.position', 'ASC')
      .addOrderBy('sectionJoins.position', 'ASC');
  }

  async findByIds(ids: string[]): Promise<PlaylistEntity[]> {
    try {
      if (!ids.length) {
        throw new BadRequestException('ids in empty');
      }
      return await this.playlistRepository.find({ where: { id: In(ids) } });
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'from:findByIds playlist ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async findOne(id: string): Promise<NormalizedPlaylistResponse | null> {
    try {
      const playlist = await this.playlistRepository.findOne({
        where: { id },
        relations: PLAYLIST_RELATIONS,
        order: PLAYLIST_ORDER,
      });
      return playlist ? this.normalizePlaylist(playlist) : null;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'from:findOnePlaylistItem ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async update(
    id: string,
    updatePlaylistDto: UpdatePlaylistDto,
  ): Promise<NormalizedPlaylistResponse> {
    try {
      const playlist = await this.playlistRepository.findOne({
        where: { id },
        relations: PLAYLIST_RELATIONS,
        order: PLAYLIST_ORDER,
      });

      if (!playlist) {
        throw new NotFoundException('Playlist not found');
      }

      if (updatePlaylistDto.title !== undefined) {
        playlist.title = updatePlaylistDto.title;
      }
      if (updatePlaylistDto.description !== undefined) {
        playlist.description = updatePlaylistDto.description;
      }
      if (updatePlaylistDto.artwork !== undefined) {
        playlist.artwork = updatePlaylistDto.artwork;
      }

      await this.playlistRepository.save(playlist);

      if (updatePlaylistDto.sermonsIds !== undefined) {
        await this.replacePlaylistSermons(id, updatePlaylistDto.sermonsIds);
      }

      if (updatePlaylistDto.sectionsIds !== undefined) {
        await this.syncPlaylistSectionMembership(
          playlist,
          updatePlaylistDto.sectionsIds,
        );
      }

      const saved = await this.playlistRepository.findOne({
        where: { id },
        relations: PLAYLIST_RELATIONS,
        order: PLAYLIST_ORDER,
      });
      return this.normalizePlaylist(saved ?? playlist);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'from:update ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async remove(id: string): Promise<StatusPlaylistResponse> {
    try {
      await this.playlistRepository.delete(id);
      return { status: 'success' };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'from:remove ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async reorderSermonsInPlaylist(
    playlistId: string,
    sermonIds: string[],
  ): Promise<{ status: string }> {
    if (!sermonIds.length) {
      throw new BadRequestException('Sermon IDs array cannot be empty');
    }
    if (new Set(sermonIds).size !== sermonIds.length) {
      throw new BadRequestException('Duplicate sermon IDs detected');
    }

    return this.dataSource.transaction(async (manager) => {
      const playlistRepository = manager.getRepository(PlaylistEntity);
      const playlist = await playlistRepository.findOne({
        where: { id: playlistId },
        select: { id: true },
      });
      if (!playlist) {
        throw new NotFoundException(
          `Playlist with id "${playlistId}" not found`,
        );
      }

      const joinRepository = manager.getRepository(PlaylistSermonJoinEntity);

      // The client must send the complete in-scope set; a partial list would
      // silently collide positions for the omitted sermons.
      const total = await joinRepository.count({ where: { playlistId } });
      if (sermonIds.length !== total) {
        throw new BadRequestException(
          `Reorder list must contain all ${total} items in scope, received ${sermonIds.length}`,
        );
      }

      const joins = await joinRepository.find({
        where: { playlistId, sermonId: In(sermonIds) },
      });
      if (joins.length !== sermonIds.length) {
        throw new NotFoundException('Some sermons are not in the playlist');
      }

      const joinBySermonId = new Map(
        joins.map((join) => [join.sermonId, join]),
      );
      // A single CASE UPDATE replaces the previous per-id loop (N queries).
      // Join ids are UUIDs generated by the DB, so interpolation is safe.
      const positionCase = sermonIds
        .map((sermonId, index) => {
          const join = joinBySermonId.get(sermonId);
          if (!join) {
            throw new NotFoundException(
              `Sermon with id "${sermonId}" is not in the playlist`,
            );
          }
          return `WHEN '${join.id}' THEN ${index}`;
        })
        .join(' ');
      await joinRepository
        .createQueryBuilder()
        .update(PlaylistSermonJoinEntity)
        .set({ position: () => `CASE id ${positionCase} END` })
        .where('id IN (:...ids)', { ids: joins.map((join) => join.id) })
        .execute();

      return { status: 'success' };
    });
  }

  private async replacePlaylistSermons(
    playlistId: string,
    sermonIds: string[],
  ): Promise<void> {
    if (sermonIds.length > 0) {
      const sermons = await this.sermonService.findByIds(sermonIds);
      if (sermons.length !== sermonIds.length) {
        throw new NotFoundException('Some sermons not found');
      }
    }

    // Delete + insert run in one transaction so a failed insert cannot leave
    // the playlist with zero sermons.
    await this.dataSource.transaction(async (manager) => {
      const joinRepository = manager.getRepository(PlaylistSermonJoinEntity);
      await joinRepository.delete({ playlistId });

      if (sermonIds.length === 0) {
        return;
      }

      const joinRows = sermonIds.map((sermonId, index) =>
        joinRepository.create({
          playlistId,
          sermonId,
          position: index,
        }),
      );
      await joinRepository.save(joinRows);
    });
  }

  private async attachPlaylistToSections(
    playlist: PlaylistEntity,
    sectionIds: string[] | undefined,
  ): Promise<void> {
    if (!sectionIds?.length) {
      return;
    }

    // SERIALIZABLE isolation prevents two concurrent attachments from both
    // reading the same max position and inserting duplicate positions.
    await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
      const joinRepository = manager.getRepository(SectionPlaylistJoinEntity);
      for (const sectionId of sectionIds) {
        const maxPosition = await joinRepository.maximum('position', {
          sectionId,
        });
        await joinRepository.save(
          joinRepository.create({
            sectionId,
            playlistId: playlist.id,
            position: (maxPosition ?? -1) + 1,
          }),
        );
      }
    });
  }

  private async syncPlaylistSectionMembership(
    playlist: PlaylistEntity,
    desiredSectionIds: string[] | undefined,
  ): Promise<void> {
    if (desiredSectionIds === undefined) {
      return;
    }

    const currentJoins = await this.sectionPlaylistJoinRepository.find({
      where: { playlistId: playlist.id },
    });
    const currentSectionIds = currentJoins.map((join) => join.sectionId);

    const sectionIdsToRemove = currentSectionIds.filter(
      (sectionId) => !desiredSectionIds.includes(sectionId),
    );
    if (sectionIdsToRemove.length) {
      await this.sectionPlaylistJoinRepository.delete({
        playlistId: playlist.id,
        sectionId: In(sectionIdsToRemove),
      });
    }

    const sectionIdsToAdd = desiredSectionIds.filter(
      (sectionId) => !currentSectionIds.includes(sectionId),
    );
    await this.attachPlaylistToSections(playlist, sectionIdsToAdd);
  }

  private normalizePlaylist(p: PlaylistEntity): NormalizedPlaylistResponse {
    const sermonJoins = p.sermonJoins ?? [];
    const sectionJoins = p.sectionJoins ?? [];
    return {
      id: p.id,
      title: p.title,
      description: p.description,
      artwork: p.artwork,
      sections: sectionJoins.map((sectionJoin) => ({
        id: sectionJoin.section.id,
        title: sectionJoin.section.title,
        description: sectionJoin.section.description,
        position: sectionJoin.section.position,
        itemsSize: sectionJoin.section.itemsSize,
        itemsRows: sectionJoin.section.itemsRows,
        transform: sectionJoin.section.transform,
        isDescriptionTitleOnSlideLarge:
          sectionJoin.section.isDescriptionTitleOnSlideLarge,
        whereIsSlideTitleLocated: sectionJoin.section.whereIsSlideTitleLocated,
        borderRadius: sectionJoin.section.borderRadius,
        playlists: [],
      })),
      sermons: sermonJoins.map((sermonJoin) => ({
        id: sermonJoin.sermon.id,
        title: sermonJoin.sermon.title,
        description: sermonJoin.sermon.description,
        textFileUrl: sermonJoin.sermon.textFileUrl,
        audioUrl: sermonJoin.sermon.audioUrl,
        youtubeUrl: sermonJoin.sermon.youtubeUrl,
        artist: sermonJoin.sermon.artist,
        artwork: sermonJoin.sermon.artwork,
        book: sermonJoin.sermon.book,
        chapter: sermonJoin.sermon.chapter,
        verse: sermonJoin.sermon.verse,
        position: sermonJoin.position,
        playlists: (sermonJoin.sermon.playlistJoins ?? []).map((pj) => ({
          id: pj.playlist.id,
          title: pj.playlist.title,
        })),
      })),
    };
  }
}
