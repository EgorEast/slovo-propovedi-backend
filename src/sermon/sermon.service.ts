import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateSermonDto } from './dto/create-sermon.dto';
import { UpdateSermonDto } from './dto/update-sermon.dto';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { SermonEntity } from './entities/sermon.entity';
import { PlaylistEntity } from 'src/playlist/entities/playlist.entity';
import { PlaylistSermonJoinEntity } from 'src/playlist/entities/playlist-sermon-join.entity';
import { DataSource, In, Repository, SelectQueryBuilder } from 'typeorm';
import {
  AllSermonsResponse,
  DistinctValuesResponse,
  NormalizedSermonResponse,
  StatusSermonResponse,
  StreamUrlResponse,
  UpdateSermon,
} from './interfaces/interface';
import { MinioService } from 'src/minio/minio.service';

const SERMON_RELATIONS = [
  'playlistJoins',
  'playlistJoins.playlist',
  'playlistJoins.playlist.sectionJoins',
  'playlistJoins.playlist.sectionJoins.section',
  'playlistJoins.playlist.sermonJoins',
  'playlistJoins.playlist.sermonJoins.sermon',
  'playlistJoins.playlist.sermonJoins.sermon.playlistJoins',
  'playlistJoins.playlist.sermonJoins.sermon.playlistJoins.playlist',
];

// DB-level ordering for the relation paths normalizePlaylistRelations exposes
// — each playlist's section and sermon joins ordered by position, so no
// in-memory re-sorting is needed.
const SERMON_RELATION_ORDER = {
  playlistJoins: {
    position: 'ASC',
    playlist: {
      sectionJoins: { position: 'ASC' },
      sermonJoins: { position: 'ASC' },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Full-text search: boundary parsing + single source of truth for the weights
// ---------------------------------------------------------------------------
//
// Search is word-order-independent AND relevance-ranked via PostgreSQL FTS on
// the generated column sermon.search_vector (sql/migrations/005_sermon_search
// _tsvector.sql): the fields below are folded into the vector once, weighted,
// and both findAll code paths match a tsquery against it and rank with the
// same ts_rank expression.

const TS_CONFIG = 'russian';

// Weighted searchable fields — the single source of truth for what the FTS
// vector indexes and how it ranks. The generated column expression and the
// ts_rank weights are derived from this exact definition.
const SEARCH_WEIGHTS = {
  A: ['title'],
  B: ['artist', 'book'],
  D: ['description'],
} as const;

// Canonical tsvector expression backing sermon.search_vector — must match
// sql/migrations/005_sermon_search_tsvector.sql and sql/bootstrap.sql.
export const buildSearchVectorExpression = (): string =>
  (Object.entries(SEARCH_WEIGHTS) as Array<[string, readonly string[]]>)
    .flatMap(([weight, fields]) =>
      fields.map(
        (field) =>
          `setweight(to_tsvector('${TS_CONFIG}', coalesce(${field}, '')), '${weight}')`,
      ),
    )
    .join(' || ');

// Postgres ts_rank weight array — elements are D, C, B, A in that order, so
// description (D) ranks lowest and title (A) highest; the unused C keeps the
// default 0.2.
const TS_RANK_WEIGHTS = '{0.1,0.2,0.4,1.0}';

// The sanitized token string is bound as :tsquery and parsed by to_tsquery
// (which applies the russian stemmer — a raw text param bound to @@ would NOT
// stem and would miss matches).
const toTsQuerySql = () => `to_tsquery('${TS_CONFIG}', :tsquery)`;

// FTS match condition shared by both code paths.
const TS_SEARCH_CONDITION = `sermon.search_vector @@ ${toTsQuerySql()}`;

// ts_rank expression shared by ORDER BY and the composite cursor comparison —
// the SAME :tsquery parameter is bound in the WHERE clause and here, so a
// row's rank is identical in both places.
const buildRankExpression = (): string =>
  `ts_rank('${TS_RANK_WEIGHTS}'::float4[], sermon.search_vector, ${toTsQuerySql()})`;

// Parse the raw search string at the boundary into a tsquery: keep only word
// characters (letters/digits, incl. Cyrillic), AND every token together so
// word order is irrelevant, and append :* to each token so partial words match
// (благода → благодать). The result is safe to hand to to_tsquery — it
// contains no tsquery syntax characters by construction. Input with no word
// characters at all (e.g. "&&&") fails fast.
const buildSearchTsQuery = (search: string): string => {
  const tokens = search.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!tokens.length) {
    throw new BadRequestException(
      'search must contain at least one word character',
    );
  }
  return tokens.map((token) => `${token}:*`).join(' & ');
};
export { buildSearchTsQuery };

// Composite keyset cursor for relevance-ordered pages: the order is
// (rank DESC, id DESC), so a bare id cursor would skip/duplicate rows when
// ranks tie. The cursor is opaque to the client (base64 JSON); old plain-uuid
// cursors are invalidated and fail fast with a clear error.
const encodeCompositeCursor = (rank: number, id: string): string =>
  Buffer.from(JSON.stringify({ rank, id })).toString('base64');

const decodeCompositeCursor = (
  cursor: string,
): { rank: number; id: string } => {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
  } catch {
    throw new BadRequestException('invalid or stale cursor');
  }
  if (typeof decoded !== 'object' || decoded === null) {
    throw new BadRequestException('invalid or stale cursor');
  }
  const { rank, id } = decoded as { rank?: unknown; id?: unknown };
  if (typeof rank !== 'number' || typeof id !== 'string') {
    throw new BadRequestException('invalid or stale cursor');
  }
  return { rank, id };
};
export { encodeCompositeCursor, decodeCompositeCursor };

@Injectable()
export class SermonService {
  constructor(
    @InjectRepository(SermonEntity)
    private sermonRepository: Repository<SermonEntity>,
    @InjectRepository(PlaylistEntity)
    private playlistRepository: Repository<PlaylistEntity>,
    @InjectRepository(PlaylistSermonJoinEntity)
    private playlistSermonJoinRepository: Repository<PlaylistSermonJoinEntity>,
    private readonly minioService: MinioService,
    @InjectDataSource()
    private dataSource: DataSource,
  ) {}

  async create(
    createSermonDto: CreateSermonDto,
  ): Promise<NormalizedSermonResponse> {
    try {
      const sermon = this.sermonRepository.create({
        title: createSermonDto.title,
        // The schema allows `description: null`, but the DB column is NOT NULL —
        // coerce null to '' at the boundary so an INSERT can never violate it.
        description: createSermonDto.description ?? '',
        audioUrl: createSermonDto.audioUrl,
        youtubeUrl: createSermonDto.youtubeUrl,
        textFileUrl: createSermonDto.textFileUrl,
        artist: createSermonDto.artist,
        artwork: createSermonDto.artwork,
        book: createSermonDto.book,
        chapter: createSermonDto.chapter,
        verse: createSermonDto.verse,
      });
      const savedSermon = await this.sermonRepository.save(sermon);
      await this.attachSermonToPlaylists(
        savedSermon,
        createSermonDto.playlistsIds,
      );
      return await this.findOne(savedSermon.id);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'from:createSermon ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async findAll(
    take?: number,
    cursor?: string,
    search?: string,
  ): Promise<AllSermonsResponse> {
    try {
      // Parse the search term at the boundary ONCE: the sanitized tsquery
      // drives the WHERE condition and the ORDER BY ranking in both paths.
      const tsquery = search ? buildSearchTsQuery(search) : undefined;

      // Relevance-ranked search orders by (rank DESC, id DESC); without search
      // the plain id-DESC order is preserved exactly (non-search pagination
      // must not regress).
      const primaryOrders: Array<[string, 'ASC' | 'DESC']> = tsquery
        ? [
            ['rank', 'DESC'],
            ['sermon.id', 'DESC'],
          ]
        : [['sermon.id', 'DESC']];

      if (!take) {
        // Backward-compatible full fetch — used by the admin UI when no
        // pagination params are supplied. When search is present it is ranked
        // by relevance like the keyset path; the response shape is unchanged.
        const queryBuilder = this.buildSermonQueryBuilder(primaryOrders);
        if (tsquery) {
          queryBuilder
            .addSelect(buildRankExpression(), 'rank')
            .where(TS_SEARCH_CONDITION)
            .setParameter('tsquery', tsquery);
        }
        const [sermons, count] = await queryBuilder.getManyAndCount();
        return {
          sermons: sermons.map((s) => this.normalizeSermonRelations(s)),
          count,
          nextCursor: null,
        };
      }

      // Keyset (cursor) pagination: instead of OFFSET — which rescans and skips
      // every row before the offset on each page — fetch take+1 rows after the
      // cursor and use the extra row to decide whether another page exists.
      const queryBuilder = this.buildSermonQueryBuilder(primaryOrders);

      if (tsquery) {
        queryBuilder
          .addSelect(buildRankExpression(), 'rank')
          .where(TS_SEARCH_CONDITION)
          .setParameter('tsquery', tsquery);
        if (cursor) {
          // Relevance pages are ordered by (rank DESC, id DESC), so a bare id
          // cursor is wrong — the composite cursor carries both values and
          // paginates with a row-value comparison. The rank is float4 in the
          // DB; the bound JS number is float8, so cast it back to float4 for
          // an exact (not approximate) comparison.
          const { rank, id } = decodeCompositeCursor(cursor);
          queryBuilder.andWhere(
            `(${buildRankExpression()}, sermon.id) < (:rank::float4, :id)`,
            { rank, id },
          );
        }
      } else if (cursor) {
        queryBuilder.andWhere('sermon.id < :cursor', { cursor });
      }

      queryBuilder.take(take + 1);

      // The search path selects the rank expression (for the composite cursor)
      // and reads it back from the raw rows; the no-search path needs no extra
      // select and can stay on the plain getMany.
      const rawAndEntities = tsquery
        ? await queryBuilder.getRawAndEntities()
        : undefined;
      const rows = rawAndEntities
        ? rawAndEntities.entities
        : await queryBuilder.getMany();
      const hasMore = rows.length > take;
      const sermons = hasMore ? rows.slice(0, take) : rows;

      let nextCursor: string | null = null;
      if (hasMore) {
        const lastSermon = sermons[sermons.length - 1];
        if (tsquery) {
          const lastRaw = rawAndEntities.raw.find(
            (row) => row.sermon_id === lastSermon.id,
          );
          if (!lastRaw) {
            throw new Error(
              `rank row for sermon "${lastSermon.id}" missing from search results`,
            );
          }
          nextCursor = encodeCompositeCursor(
            Number(lastRaw.rank),
            lastSermon.id,
          );
        } else {
          nextCursor = lastSermon.id;
        }
      }

      return {
        sermons: sermons.map((s) => this.normalizeSermonRelations(s)),
        count: null,
        nextCursor,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'from:findAllSermonItems ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // Shared QueryBuilder for both findAll code paths: the deep relation graph
  // plus the primary ordering (id DESC, or rank DESC + id DESC under search)
  // followed by the join-position orders normalizePlaylistRelations expects.
  private buildSermonQueryBuilder(
    primaryOrders: Array<[order: string, direction: 'ASC' | 'DESC']>,
  ): SelectQueryBuilder<SermonEntity> {
    const queryBuilder = this.sermonRepository
      .createQueryBuilder('sermon')
      .leftJoinAndSelect('sermon.playlistJoins', 'playlistJoins')
      .leftJoinAndSelect('playlistJoins.playlist', 'playlists')
      .leftJoinAndSelect('playlists.sectionJoins', 'playlistSectionJoins')
      .leftJoinAndSelect('playlistSectionJoins.section', 'playlistSections')
      .leftJoinAndSelect('playlists.sermonJoins', 'playlistSermonJoins')
      .leftJoinAndSelect('playlistSermonJoins.sermon', 'playlistSermons')
      .leftJoinAndSelect(
        'playlistSermons.playlistJoins',
        'playlistSermonPlaylistJoins',
      )
      .leftJoinAndSelect(
        'playlistSermonPlaylistJoins.playlist',
        'playlistSermonPlaylists',
      );

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
      .addOrderBy('playlistJoins.position', 'ASC')
      .addOrderBy('playlistSectionJoins.position', 'ASC')
      .addOrderBy('playlistSermonJoins.position', 'ASC');
  }

  async getStreamUrl(id: string): Promise<StreamUrlResponse> {
    const sermon = await this.sermonRepository.findOne({ where: { id } });
    if (!sermon) {
      throw new NotFoundException(`Sermon with id "${id}" not found`);
    }
    if (!sermon.audioUrl) {
      throw new NotFoundException(`Sermon with id "${id}" has no audio file`);
    }

    const fileName = MinioService.extractFileNameFromUrl(sermon.audioUrl);
    const url = await this.minioService.getPresignedFileUrl(fileName);
    return { url };
  }

  // Distinct previously-used artists/books for autocomplete. DISTINCT on two
  // columns together would return value PAIRS, so each column is queried
  // separately; NULL and whitespace-only values are excluded in SQL, and
  // ORDER BY keeps the lists deterministic (alphabetical).
  async getDistinctValues(): Promise<DistinctValuesResponse> {
    try {
      const artistRows = await this.sermonRepository
        .createQueryBuilder('sermon')
        .select('DISTINCT sermon.artist', 'artist')
        .where('sermon.artist IS NOT NULL')
        .andWhere("btrim(sermon.artist, E' \\t\\n\\r') <> ''")
        .orderBy('artist', 'ASC')
        .getRawMany<{ artist: string }>();

      const bookRows = await this.sermonRepository
        .createQueryBuilder('sermon')
        .select('DISTINCT sermon.book', 'book')
        .where('sermon.book IS NOT NULL')
        .andWhere("btrim(sermon.book, E' \\t\\n\\r') <> ''")
        .orderBy('book', 'ASC')
        .getRawMany<{ book: string }>();

      return {
        artists: artistRows.map((row) => row.artist),
        books: bookRows.map((row) => row.book),
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'from:getDistinctValues ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async findOne(id: string): Promise<NormalizedSermonResponse | null> {
    try {
      const sermon = await this.sermonRepository.findOne({
        where: { id },
        relations: SERMON_RELATIONS,
        order: SERMON_RELATION_ORDER,
      });
      return sermon ? this.normalizeSermonRelations(sermon) : null;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'from:findOneSermonItem ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async findByIds(ids: string[]): Promise<SermonEntity[]> {
    try {
      if (!ids.length) {
        throw new BadRequestException('ids in empty');
      }
      return await this.sermonRepository.find({ where: { id: In(ids) } });
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'from:findByIds sermon ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async update(
    id: string,
    updateSermonDto: UpdateSermonDto,
  ): Promise<StatusSermonResponse> {
    try {
      const existingSermon = await this.sermonRepository.findOne({
        where: { id },
      });
      if (!existingSermon) {
        throw new NotFoundException(`Sermon with id "${id}" not found`);
      }

      const updateFields: UpdateSermon = {};

      if (updateSermonDto.title !== undefined) {
        updateFields.title = updateSermonDto.title;
      }
      if (updateSermonDto.description !== undefined) {
        // Coerce null → '' the same way create does: the DB column is NOT NULL,
        // so an UPDATE with null would violate the constraint.
        updateFields.description = updateSermonDto.description ?? '';
      }
      if (updateSermonDto.audioUrl !== undefined) {
        updateFields.audioUrl = updateSermonDto.audioUrl;
      }
      if (updateSermonDto.textFileUrl !== undefined) {
        updateFields.textFileUrl = updateSermonDto.textFileUrl;
      }
      if (updateSermonDto.youtubeUrl !== undefined) {
        updateFields.youtubeUrl = updateSermonDto.youtubeUrl;
      }
      if (updateSermonDto.artist !== undefined) {
        updateFields.artist = updateSermonDto.artist;
      }
      if (updateSermonDto.artwork !== undefined) {
        updateFields.artwork = updateSermonDto.artwork;
      }
      if (updateSermonDto.book !== undefined) {
        updateFields.book = updateSermonDto.book;
      }
      if (updateSermonDto.chapter !== undefined) {
        updateFields.chapter = updateSermonDto.chapter;
      }
      if (updateSermonDto.verse !== undefined) {
        updateFields.verse = updateSermonDto.verse;
      }

      await this.sermonRepository.update(id, updateFields);
      await this.syncSermonPlaylistMembership(
        existingSermon,
        updateSermonDto.playlistsIds,
      );
      return { status: 'success' };
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

  async remove(id: string): Promise<StatusSermonResponse> {
    try {
      await this.sermonRepository.delete(id);
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

  private normalizeSermonRelations(
    sermon: SermonEntity,
  ): NormalizedSermonResponse {
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
      playlists: (sermon.playlistJoins ?? []).map((join) =>
        this.normalizePlaylistRelations(join.playlist),
      ),
    };
  }

  private normalizePlaylistRelations(
    playlist: PlaylistEntity,
  ): NormalizedSermonResponse['playlists'][number] {
    const sectionJoins = playlist.sectionJoins ?? [];
    const sermonJoins = playlist.sermonJoins ?? [];
    return {
      id: playlist.id,
      title: playlist.title,
      description: playlist.description,
      artwork: playlist.artwork,
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
        playlists: (sermonJoin.sermon.playlistJoins ?? []).map(
          (playlistJoin) => ({
            id: playlistJoin.playlist.id,
            title: playlistJoin.playlist.title,
          }),
        ),
      })),
    };
  }

  private async attachSermonToPlaylists(
    sermon: SermonEntity,
    playlistIds: string[] | undefined,
  ): Promise<void> {
    if (!playlistIds?.length) {
      return;
    }

    // SERIALIZABLE isolation prevents two concurrent attachments from both
    // reading the same max position and inserting duplicate positions.
    await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
      const joinRepository = manager.getRepository(PlaylistSermonJoinEntity);
      for (const playlistId of playlistIds) {
        const maxPosition = await joinRepository.maximum('position', {
          playlistId,
        });
        await joinRepository.save(
          joinRepository.create({
            playlistId,
            sermonId: sermon.id,
            position: (maxPosition ?? -1) + 1,
          }),
        );
      }
    });
  }

  private async syncSermonPlaylistMembership(
    sermon: SermonEntity,
    desiredPlaylistIds: string[] | undefined,
  ): Promise<void> {
    if (desiredPlaylistIds === undefined) {
      return;
    }

    const currentJoins = await this.playlistSermonJoinRepository.find({
      where: { sermonId: sermon.id },
    });
    const currentPlaylistIds = currentJoins.map((join) => join.playlistId);

    const playlistIdsToRemove = currentPlaylistIds.filter(
      (playlistId) => !desiredPlaylistIds.includes(playlistId),
    );
    if (playlistIdsToRemove.length) {
      await this.playlistSermonJoinRepository.delete({
        sermonId: sermon.id,
        playlistId: In(playlistIdsToRemove),
      });
    }

    const playlistIdsToAdd = desiredPlaylistIds.filter(
      (playlistId) => !currentPlaylistIds.includes(playlistId),
    );
    await this.attachSermonToPlaylists(sermon, playlistIdsToAdd);
  }
}
