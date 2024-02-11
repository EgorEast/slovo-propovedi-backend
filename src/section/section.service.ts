import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreateSectionDto } from './dto/create-section.dto';
import { UpdateSectionDto } from './dto/update-section.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { SectionEntity } from './entities/section.entity';
import { In, Repository } from 'typeorm';
import { AllSectionsResponse, UpdateSection } from './interfacies/interface';
import { PlaylistService } from 'src/playlist/playlist.service';

@Injectable()
export class SectionService {
  constructor(
    private playlistService: PlaylistService,
    @InjectRepository(SectionEntity)
    private sectionRepository: Repository<SectionEntity>,
  ) {}

  async createSectionItem(
    createSectionDto: CreateSectionDto,
  ): Promise<SectionEntity> {
    try {
      return await this.sectionRepository.save(createSectionDto);
    } catch (error) {
      throw new HttpException(
        'from:createSectionItem ' + error.message,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async findByIds(ids: string[]): Promise<SectionEntity[]> {
    try {
      if (!ids.length) {
        throw new Error('ids in empty');
      }
      return await this.sectionRepository.find({ where: { id: In(ids) } });
    } catch (error) {
      throw new HttpException(
        'from:findByIds section ' + error.message,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async findAllSectionItems(): Promise<AllSectionsResponse> {
    try {
      const [result, count] = await this.sectionRepository.findAndCount();
      return {
        sections: result,
        count: count,
      };
    } catch (error) {
      throw new HttpException(
        'from:findAllSectionItems ' + error.message,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async findOneSectionItem(id: string): Promise<SectionEntity> {
    try {
      return await this.sectionRepository.findOne({ where: { id } });
    } catch (error) {
      throw new HttpException(
        'from:findOneSectionItem ' + error.message,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async update(
    id: string,
    updateSectionDto: UpdateSectionDto,
  ): Promise<SectionEntity> {
    try {
      const section = await this.sectionRepository.findOne({
        where: { id },
        relations: ['playlists'],
      });

      if (!section) {
        throw new Error('Section not found');
      }

      if (updateSectionDto.title) {
        section.title = updateSectionDto.title;
      }
      if (updateSectionDto.description) {
        section.description = updateSectionDto.description;
      }

      if (
        updateSectionDto.playlistsIds &&
        updateSectionDto.playlistsIds.length
      ) {
        const playlists = await this.playlistService.findByIds(
          updateSectionDto.playlistsIds,
        );
        if (!playlists) {
          throw new Error('Playlists not found');
        }
        section.playlists = playlists;
      }

      return await this.sectionRepository.save(section);
    } catch (error) {
      throw new HttpException(
        'from:update ' + error.message,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async remove(id: string) {
    try {
      await this.sectionRepository.delete(id);
      return { status: 'success' };
    } catch (error) {
      throw new HttpException(
        'from:remove ' + error.message,
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
