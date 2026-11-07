import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PictureEntity } from './entities/picture.entity';
import { PicturesService } from './pictures.service';

@Module({
  imports: [TypeOrmModule.forFeature([PictureEntity])],
  providers: [PicturesService],
  exports: [PicturesService],
})
export class PicturesModule {}
