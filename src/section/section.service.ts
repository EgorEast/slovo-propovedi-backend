import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreateSectionDto } from './dto/create-section.dto';
import { UpdateSectionDto } from './dto/update-section.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { SectionEntity } from './entities/section.entity';
import { In, Repository } from 'typeorm';
import {
  AllSectionsResponse,
  NormalizedSection,
} from './interfacies/interface';
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
  ): Promise<NormalizedSection> {
    try {
      const section = this.sectionRepository.create({
        title: createSectionDto.title,
        description: createSectionDto.description,
        itemsSize: createSectionDto.itemsSize,
        itemsRows: createSectionDto.itemsRows,
        transform: createSectionDto.transform,
        isDescriptionTitleOnSlideLarge:
          createSectionDto.isDescriptionTitleOnSlideLarge,
        whereIsSlideTitleLocated: createSectionDto.whereIsSlideTitleLocated,
        borderRadius: createSectionDto.borderRadius,
        playlists: [],
      });
      const saved = await this.sectionRepository.save(section);
      return this.normalizeSection(saved);
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
      const [result, count] = await this.sectionRepository.findAndCount({
        relations: ['playlists', 'playlists.sections', 'playlists.sermons'],
      });
      return {
        sections: result.map((sec) => this.normalizeSection(sec)),
        count: count,
      };
    } catch (error) {
      throw new HttpException(
        'from:findAllSectionItems ' + error.message,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async findOneSectionItem(id: string): Promise<NormalizedSection | null> {
    try {
      const section = await this.sectionRepository.findOne({
        where: { id },
        relations: ['playlists', 'playlists.sections', 'playlists.sermons'],
      });
      if (!section) {
        return null;
      }
      return this.normalizeSection(section);
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
  ): Promise<NormalizedSection> {
    try {
      const section = await this.sectionRepository.findOne({
        where: { id },
        relations: ['playlists', 'playlists.sections', 'playlists.sermons'],
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
      if (updateSectionDto.itemsSize) {
        section.itemsSize = updateSectionDto.itemsSize;
      }
      if (updateSectionDto.itemsRows !== undefined) {
        section.itemsRows = updateSectionDto.itemsRows;
      }
      if (updateSectionDto.transform) {
        section.transform = updateSectionDto.transform;
      }
      if (updateSectionDto.isDescriptionTitleOnSlideLarge !== undefined) {
        section.isDescriptionTitleOnSlideLarge =
          updateSectionDto.isDescriptionTitleOnSlideLarge;
      }
      if (updateSectionDto.whereIsSlideTitleLocated !== undefined) {
        section.whereIsSlideTitleLocated =
          updateSectionDto.whereIsSlideTitleLocated;
      }
      if (updateSectionDto.borderRadius !== undefined) {
        section.borderRadius = updateSectionDto.borderRadius;
      }

      if (updateSectionDto.playlistsIds !== undefined) {
        if (updateSectionDto.playlistsIds.length > 0) {
          const playlists = await this.playlistService.findByIds(
            updateSectionDto.playlistsIds,
          );
          if (playlists.length !== updateSectionDto.playlistsIds.length) {
            throw new Error('Some playlists not found');
          }
          section.playlists = playlists;
        } else {
          section.playlists = [];
        }
      }

      const saved = await this.sectionRepository.save(section);
      const reloaded = await this.sectionRepository.findOne({
        where: { id: saved.id },
        relations: ['playlists', 'playlists.sections', 'playlists.sermons'],
      });
      if (!reloaded) {
        throw new Error('Section not found after update');
      }
      return this.normalizeSection(reloaded);
    } catch (error) {
      throw new HttpException(
        'from:update ' + error.message,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private normalizeSection(sec: SectionEntity): NormalizedSection {
    return {
      ...sec,
      playlists: (sec.playlists ?? []).map((pl) => ({
        ...pl,
        sections: (pl.sections ?? []).map((s) => ({
          id: s.id,
          title: s.title,
        })),
        sermons: (pl.sermons ?? []).map((s) => ({
          ...s,
          playlists: s.playlists ?? [],
        })),
      })),
    };
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
