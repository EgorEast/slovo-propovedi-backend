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
import { DataSource, ILike, In, Repository } from 'typeorm';
import {
  AllSermonsResponse,
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

// ILIKE treats % _ and \ as metacharacters — escape them so user input such as
// "100%" or "foo_bar" matches literally (Postgres's default LIKE escape is \).
const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&');

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
        description: createSermonDto.description,
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

  // Fields the `search` query matches against, shared by the full-fetch
  // (TypeORM ILike array) and keyset (QueryBuilder ILIKE) code paths so the
  // list of searchable fields lives in exactly one place.
  private static readonly SEARCH_FIELDS = [
    'title',
    'artist',
    'book',
    'description',
  ] as const;

  async findAll(
    take?: number,
    cursor?: string,
    search?: string,
  ): Promise<AllSermonsResponse> {
    try {
      // Parse the search term at the boundary: escape ILIKE metacharacters and
      // wrap once, so the full-fetch and keyset paths share one identical value.
      const q = search ? `%${escapeLike(search)}%` : undefined;

      if (!take) {
        // Backward-compatible full fetch — used by the admin UI when no
        // pagination params are supplied.
        const where = q
          ? SermonService.SEARCH_FIELDS.map((field) => ({
              [field]: ILike(q),
            }))
          : undefined;
        const [sermons, count] = await this.sermonRepository.findAndCount({
          relations: SERMON_RELATIONS,
          order: { id: 'DESC', ...SERMON_RELATION_ORDER },
          where,
        });
        return {
          sermons: sermons.map((s) => this.normalizeSermonRelations(s)),
          count,
          nextCursor: null,
        };
      }

      // Keyset (cursor) pagination: instead of OFFSET — which rescans and skips
      // every row before the offset on each page — fetch take+1 rows after the
      // cursor and use the extra row to decide whether another page exists.
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
        )
        .orderBy('sermon.id', 'DESC')
        .addOrderBy('playlistJoins.position', 'ASC')
        .addOrderBy('playlistSectionJoins.position', 'ASC')
        .addOrderBy('playlistSermonJoins.position', 'ASC')
        .take(take + 1);

      if (cursor) {
        queryBuilder.andWhere('sermon.id < :cursor', { cursor });
      }

      if (q) {
        const searchCondition = SermonService.SEARCH_FIELDS.map(
          (field) => `sermon.${field} ILIKE :q`,
        ).join(' OR ');
        queryBuilder.andWhere(searchCondition, { q });
      }

      const rows = await queryBuilder.getMany();
      const hasMore = rows.length > take;
      const sermons = hasMore ? rows.slice(0, take) : rows;

      return {
        sermons: sermons.map((s) => this.normalizeSermonRelations(s)),
        count: null,
        nextCursor: hasMore ? sermons[sermons.length - 1].id : null,
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
        updateFields.description = updateSermonDto.description;
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
