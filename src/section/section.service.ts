import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreateSectionDto } from './dto/create-section.dto';
import { UpdateSectionDto } from './dto/update-section.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { SectionEntity } from './entities/section.entity';
import { Repository } from 'typeorm';
import { UpdateSection } from './interfacies/interface';

@Injectable()
export class SectionService {
  constructor(
    @InjectRepository(SectionEntity)
    private sectionRepository: Repository<SectionEntity>,
  ) {}

  async createSectionItem(createSectionDto: CreateSectionDto) {
    try {
      return await this.sectionRepository.save(createSectionDto);
    } catch (error) {
      throw new HttpException(
        'from:createSectionItem ' + error.message,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async findAllSectionItems() {
    try {
      return await this.sectionRepository.findAndCount();
    } catch (error) {
      throw new HttpException(
        'from:findAllSectionItems ' + error.message,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async findOneSectionItem(id: string) {
    try {
      return await this.sectionRepository.findOne({ where: { id } });
    } catch (error) {
      throw new HttpException(
        'from:findOneSectionItem ' + error.message,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async update(id: string, updateSectionDto: UpdateSectionDto) {
    try {
      const updateFields: UpdateSection = {};

      if (updateSectionDto.title) {
        updateFields.title = updateSectionDto.title;
      }
      if (updateSectionDto.description) {
        updateFields.description = updateSectionDto.description;
      }
      await this.sectionRepository.update(id, updateFields);
      return {};
    } catch (error) {
      throw new HttpException(
        'from:update ' + error.message,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async remove(id: string) {
    try {
      return await this.sectionRepository.delete(id);
    } catch (error) {
      throw new HttpException(
        'from:remove ' + error.message,
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
