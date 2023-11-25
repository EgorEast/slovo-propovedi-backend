import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { UpdatePlaylistDto } from './dto/update-playlist.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { PlaylistEntity } from './entities/playlist.entity';
import { Repository } from 'typeorm';
import { UpdatePlaylist } from './interfaces/interface';

@Injectable()
export class PlaylistService {
  constructor(
    @InjectRepository(PlaylistEntity)
    private playlistRepository: Repository<PlaylistEntity>,
  ) {}

  async create(createPlaylistDto: CreatePlaylistDto): Promise<PlaylistEntity> {
    try {
      return await this.playlistRepository.save(createPlaylistDto);
    } catch (error) {
      throw new HttpException(
        'from:createPlaylist ' + error.message,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async findAll(): Promise<[PlaylistEntity[], number]> {
    try {
      return await this.playlistRepository.findAndCount();
    } catch (error) {
      throw new HttpException(
        'from:findAllPlaylistItems ' + error.message,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async findOne(id: string) {
    try {
      return await this.playlistRepository.findOne({ where: { id } });
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
  ): Promise<{ status: 'success' }> {
    try {
      const updateFields: UpdatePlaylist = {};

      if (updatePlaylistDto.title) {
        updateFields.title = updatePlaylistDto.title;
      }
      if (updatePlaylistDto.description) {
        updateFields.description = updatePlaylistDto.description;
      }
      await this.playlistRepository.update(id, updateFields);
      return { status: 'success' };
    } catch (error) {
      throw new HttpException(
        'from:update ' + error.message,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async remove(id: string) {
    try {
      return await this.playlistRepository.delete(id);
    } catch (error) {
      throw new HttpException(
        'from:remove ' + error.message,
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
