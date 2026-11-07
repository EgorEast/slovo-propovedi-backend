import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { computeBlurhash } from './blurhash';
import { PictureEntity } from './entities/picture.entity';

@Injectable()
export class PicturesService {
  private readonly logger = new Logger(PicturesService.name);

  constructor(
    @InjectRepository(PictureEntity)
    private readonly picturesRepository: Repository<PictureEntity>,
  ) {}

  /**
   * Best-effort blurhash capture for a freshly uploaded image: a failure is
   * logged and never fails the upload — the cover stays usable, only its
   * placeholder is missing.
   */
  async recordForUpload(picturePath: string, image: Buffer): Promise<void> {
    try {
      const blurhash = await computeBlurhash(image);
      await this.record(picturePath, blurhash);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Blurhash for ${picturePath} failed: ${message}`);
    }
  }

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
