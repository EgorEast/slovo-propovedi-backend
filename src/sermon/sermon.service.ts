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
      return await this.sermonRepository.save(sermon);
    } catch (error) {
      throw new HttpException(
        'from:createSermon ' + error.message,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async findAll(): Promise<AllSermonsResponse> {
    try {
      const [sermons, count] = await this.sermonRepository.findAndCount();
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
      return await this.sermonRepository.findOne({ where: { id } });
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
}
