import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  forwardRef,
} from '@nestjs/common';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { UpdatePlaylistDto } from './dto/update-playlist.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { PlaylistEntity } from './entities/playlist.entity';
import { Repository } from 'typeorm';
import {
  AllPlaylistsResponse,
  StatusPlaylistResponse,
  UpdatePlaylist,
} from './interfaces/interface';
import { SermonService } from 'src/sermon/sermon.service';

@Injectable()
export class PlaylistService {
  constructor(
    @Inject(forwardRef(() => SermonService))
    private sermonService: SermonService,
    @InjectRepository(PlaylistEntity)
    private playlistRepository: Repository<PlaylistEntity>,
  ) {}

  async create(createPlaylistDto: CreatePlaylistDto): Promise<PlaylistEntity> {
    try {
      const playlist = this.playlistRepository.create({
        title: createPlaylistDto.title,
        description: createPlaylistDto.description,
      });
      return this.playlistRepository.save(playlist);
      // throw new HttpException('Проповедь не найдена', HttpStatus.BAD_REQUEST);
    } catch (error) {
      throw new HttpException(
        'from:createPlaylist ' + error.message,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async findAll(): Promise<AllPlaylistsResponse> {
    try {
      const [playlists, count] = await this.playlistRepository.findAndCount();
      return {
        playlists,
        count,
      };
    } catch (error) {
      throw new HttpException(
        'from:findAllPlaylistItems ' + error.message,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async findOne(id: string): Promise<PlaylistEntity> {
    try {
      return await this.playlistRepository.findOne({
        where: { id },
        relations: ['sermons'],
      });
    } catch (error) {
      throw new HttpException(
        'from:findOnePlaylistItem ' + error.message,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async update(
    id: string,
    updatePlaylistDto: UpdatePlaylistDto,
  ): Promise<PlaylistEntity> {
    try {
      const playlist = await this.playlistRepository.findOne({
        where: { id },
        relations: ['sermons'],
      });

      if (!playlist) {
        throw new Error('Playlist not found');
      }

      if (updatePlaylistDto.title) {
        playlist.title = updatePlaylistDto.title;
      }
      if (updatePlaylistDto.description) {
        playlist.description = updatePlaylistDto.description;
      }

      if (updatePlaylistDto.sermonsIds && updatePlaylistDto.sermonsIds.length) {
        const sermons = await this.sermonService.findByIds(
          updatePlaylistDto.sermonsIds,
        );
        if (!sermons) {
          throw new Error('Sermons not found');
        }
        playlist.sermons = sermons;
      }

      return await this.playlistRepository.save(playlist);
    } catch (error) {
      throw new HttpException(
        'from:update ' + error.message,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async remove(id: string): Promise<StatusPlaylistResponse> {
    try {
      await this.playlistRepository.delete(id);
      return { status: 'success' };
    } catch (error) {
      throw new HttpException(
        'from:remove ' + error.message,
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
