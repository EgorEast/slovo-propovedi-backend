import { Module } from '@nestjs/common';
import { SermonService } from './sermon.service';
import { SermonController } from './sermon.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SermonEntity } from './entities/sermon.entity';
import { PlaylistEntity } from 'src/playlist/entities/playlist.entity';
import { MinioModule } from 'src/minio/minio.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SermonEntity, PlaylistEntity]),
    MinioModule,
  ],
  controllers: [SermonController],
  providers: [SermonService],
  exports: [SermonService],
})
export class SermonModule {}
