import { Module } from '@nestjs/common';
import { SermonService } from './sermon.service';
import { SermonController } from './sermon.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SermonEntity } from './entities/sermon.entity';
import { PlaylistEntity } from 'src/playlist/entities/playlist.entity';
import { PlaylistSermonJoinEntity } from 'src/playlist/entities/playlist-sermon-join.entity';
import { SectionEntity } from 'src/section/entities/section.entity';
import { SectionPlaylistJoinEntity } from 'src/section/entities/section-playlist-join.entity';
import { MinioModule } from 'src/minio/minio.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SermonEntity,
      PlaylistEntity,
      PlaylistSermonJoinEntity,
      SectionEntity,
      SectionPlaylistJoinEntity,
    ]),
    MinioModule,
  ],
  controllers: [SermonController],
  providers: [SermonService],
  exports: [SermonService],
})
export class SermonModule {}
