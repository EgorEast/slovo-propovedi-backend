import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
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
  UpdateSermon,
} from './interfaces/interface';

@Injectable()
export class SermonService {
  constructor(
    @InjectRepository(SermonEntity)
    private sermonRepository: Repository<SermonEntity>,
    @InjectRepository(PlaylistEntity)
    private playlistRepository: Repository<PlaylistEntity>,
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

  async findAll(): Promise<AllSermonsResponse> {
    try {
      const [sermons, count] = await this.sermonRepository.findAndCount({
        relations: ['playlists'],
      });
      return {
        sermons,
        count,
      };
    } catch (error) {
      throw new HttpException(
        'from:findAllSermonItems ' + error.message,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async findOne(id: string): Promise<SermonEntity> {
    try {
      return await this.sermonRepository.findOne({
        where: { id },
        relations: ['playlists'],
      });
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
