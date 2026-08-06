import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateSermonDto } from './dto/create-sermon.dto';
import { UpdateSermonDto } from './dto/update-sermon.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { SermonEntity } from './entities/sermon.entity';
import { PlaylistEntity } from 'src/playlist/entities/playlist.entity';
import { In, Repository } from 'typeorm';
import {
  AllSermonsResponse,
  StatusSermonResponse,
  StreamUrlResponse,
  UpdateSermon,
} from './interfaces/interface';
import { MinioService } from 'src/minio/minio.service';

@Injectable()
export class SermonService {
  constructor(
    @InjectRepository(SermonEntity)
    private sermonRepository: Repository<SermonEntity>,
    @InjectRepository(PlaylistEntity)
    private playlistRepository: Repository<PlaylistEntity>,
    private readonly minioService: MinioService,
  ) {}

  async create(createSermonDto: CreateSermonDto): Promise<SermonEntity> {
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
      throw new HttpException(
        'from:createSermon ' + error.message,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async findAll(take?: number, cursor?: string): Promise<AllSermonsResponse> {
    try {
      if (!take) {
        // Backward-compatible full fetch — used by the admin UI when no
        // pagination params are supplied.
        const [sermons, count] = await this.sermonRepository.findAndCount({
          relations: ['playlists'],
          order: { id: 'DESC' },
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
        .leftJoinAndSelect('sermon.playlists', 'playlists')
        .orderBy('sermon.id', 'DESC')
        .take(take + 1);

      if (cursor) {
        queryBuilder.andWhere('sermon.id < :cursor', { cursor });
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
      throw new HttpException(
        'from:findAllSermonItems ' + error.message,
        HttpStatus.BAD_REQUEST,
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

  async findOne(id: string): Promise<SermonEntity> {
    try {
      const sermon = await this.sermonRepository.findOne({
        where: { id },
        relations: ['playlists'],
      });
      return sermon ? this.normalizeSermonRelations(sermon) : sermon;
    } catch (error) {
      throw new HttpException(
        'from:findOneSermonItem ' + error.message,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async findByIds(ids: string[]): Promise<SermonEntity[]> {
    try {
      if (!ids.length) {
        throw new Error('ids in empty');
      }
      return await this.sermonRepository.find({ where: { id: In(ids) } });
    } catch (error) {
      throw new HttpException(
        'from:findByIds sermon ' + error.message,
        HttpStatus.BAD_REQUEST,
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
      throw new HttpException(
        'from:update ' + error.message,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async remove(id: string): Promise<StatusSermonResponse> {
    try {
      await this.sermonRepository.delete(id);
      return { status: 'success' };
    } catch (error) {
      throw new HttpException(
        'from:remove ' + error.message,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private normalizeSermonRelations(sermon: SermonEntity) {
    return {
      ...sermon,
      playlists: (sermon.playlists ?? []).map((pl) => ({
        ...pl,
        sections: pl.sections ?? [],
        sermons: pl.sermons ?? [],
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

    const playlists = await this.playlistRepository.find({
      where: { id: In(playlistIds) },
      relations: ['sermons'],
    });

    playlists.forEach((playlist) => {
      const isSermonAlreadyAttached = playlist.sermons.some(
        (attachedSermon) => attachedSermon.id === sermon.id,
      );
      if (!isSermonAlreadyAttached) {
        playlist.sermons.push(sermon);
      }
    });

    await this.playlistRepository.save(playlists);
  }

  private async syncSermonPlaylistMembership(
    sermon: SermonEntity,
    desiredPlaylistIds: string[] | undefined,
  ): Promise<void> {
    if (desiredPlaylistIds === undefined) {
      return;
    }

    const allPlaylists = await this.playlistRepository.find({
      relations: ['sermons'],
    });
    const currentPlaylists = allPlaylists.filter((playlist) =>
      playlist.sermons.some(
        (attachedSermon) => attachedSermon.id === sermon.id,
      ),
    );

    const playlistsToRemove = currentPlaylists.filter(
      (playlist) => !desiredPlaylistIds.includes(playlist.id),
    );
    playlistsToRemove.forEach((playlist) => {
      playlist.sermons = playlist.sermons.filter(
        (attachedSermon) => attachedSermon.id !== sermon.id,
      );
    });
    await this.playlistRepository.save(playlistsToRemove);

    const playlistIdsToAdd = desiredPlaylistIds.filter(
      (playlistId) =>
        !currentPlaylists.some((playlist) => playlist.id === playlistId),
    );
    await this.attachSermonToPlaylists(sermon, playlistIdsToAdd);
  }
}
