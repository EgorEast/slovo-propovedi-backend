import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PictureEntity } from './entities/picture.entity';

@Injectable()
export class PicturesService {
  constructor(
    @InjectRepository(PictureEntity)
    private readonly picturesRepository: Repository<PictureEntity>,
  ) {}

  async record(picturePath: string, blurhash: string | null): Promise<void> {
    const existing = await this.picturesRepository.findOne({
      where: { picturePath },
    });

    if (existing) {
      existing.blurhash = blurhash;
      await this.picturesRepository.save(existing);
      return;
    }

    await this.picturesRepository.insert({ picturePath, blurhash });
  }
}
