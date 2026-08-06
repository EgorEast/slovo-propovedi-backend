import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { UpdatePlaylistDto } from './dto/update-playlist.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { PlaylistEntity } from './entities/playlist.entity';
import { SectionEntity } from 'src/section/entities/section.entity';
import { In, Repository } from 'typeorm';
import {
  AllPlaylistsResponse,
  StatusPlaylistResponse,
} from './interfaces/interface';
import { SermonService } from 'src/sermon/sermon.service';

@Injectable()
export class PlaylistService {
  constructor(
    private sermonService: SermonService,
    @InjectRepository(PlaylistEntity)
    private playlistRepository: Repository<PlaylistEntity>,
    @InjectRepository(SectionEntity)
    private sectionRepository: Repository<SectionEntity>,
  ) {}

  async create(createPlaylistDto: CreatePlaylistDto): Promise<PlaylistEntity> {
    try {
      const playlist = this.playlistRepository.create({
        title: createPlaylistDto.title,
        description: createPlaylistDto.description,
        artwork: createPlaylistDto.artwork,
        sections: [],
        sermons: [],
      });
      if (createPlaylistDto.sermonsIds && createPlaylistDto.sermonsIds.length) {
        const sermons = await this.sermonService.findByIds(
          createPlaylistDto.sermonsIds,
        );
        if (!sermons) {
          throw new Error('Sermons not found');
        }
        playlist.sermons = sermons;
      }
      return await this.playlistRepository.save(playlist);
    } catch (error) {
      throw new HttpException(
        'from:createPlaylist ' + error.message,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async findAll(): Promise<AllPlaylistsResponse> {
    try {
      const [playlists, count] = await this.playlistRepository.findAndCount({
        relations: ['sermons', 'sections'],
      });
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

  async findByIds(ids: string[]): Promise<PlaylistEntity[]> {
    try {
      if (!ids.length) {
        throw new Error('ids in empty');
      }
      return await this.playlistRepository.find({ where: { id: In(ids) } });
    } catch (error) {
      throw new HttpException(
        'from:findByIds playlist ' + error.message,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async findOne(id: string): Promise<PlaylistEntity> {
    try {
      return await this.playlistRepository.findOne({
        where: { id },
        relations: ['sermons', 'sections'],
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

      if (updatePlaylistDto.artwork !== undefined) {
        playlist.artwork = updatePlaylistDto.artwork;
      }

      if (updatePlaylistDto.sermonsIds !== undefined) {
        if (updatePlaylistDto.sermonsIds.length > 0) {
          const sermons = await this.sermonService.findByIds(
            updatePlaylistDto.sermonsIds,
          );
          if (!sermons) {
            throw new Error('Sermons not found');
          }
          playlist.sermons = sermons;
        } else {
          playlist.sermons = [];
        }
      }

      await this.syncPlaylistSectionMembership(
        playlist,
        updatePlaylistDto.sectionsIds,
      );

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

  private async attachPlaylistToSections(
    playlist: PlaylistEntity,
    sectionIds: string[] | undefined,
  ): Promise<void> {
    if (!sectionIds?.length) {
      return;
    }

    const sections = await this.sectionRepository.find({
      where: { id: In(sectionIds) },
      relations: ['playlists'],
    });

    sections.forEach((section) => {
      const isPlaylistAlreadyAttached = section.playlists.some(
        (attachedPlaylist) => attachedPlaylist.id === playlist.id,
      );
      if (!isPlaylistAlreadyAttached) {
        section.playlists.push(playlist);
      }
    });

    await this.sectionRepository.save(sections);
  }

  private async syncPlaylistSectionMembership(
    playlist: PlaylistEntity,
    desiredSectionIds: string[] | undefined,
  ): Promise<void> {
    if (desiredSectionIds === undefined) {
      return;
    }

    const allSections = await this.sectionRepository.find({
      relations: ['playlists'],
    });
    const currentSections = allSections.filter((section) =>
      section.playlists.some(
        (attachedPlaylist) => attachedPlaylist.id === playlist.id,
      ),
    );

    const sectionsToRemove = currentSections.filter(
      (section) => !desiredSectionIds.includes(section.id),
    );
    sectionsToRemove.forEach((section) => {
      section.playlists = section.playlists.filter(
        (attachedPlaylist) => attachedPlaylist.id !== playlist.id,
      );
    });
    await this.sectionRepository.save(sectionsToRemove);

    const sectionIdsToAdd = desiredSectionIds.filter(
      (sectionId) =>
        !currentSections.some((section) => section.id === sectionId),
    );
    await this.attachPlaylistToSections(playlist, sectionIdsToAdd);
  }
}
