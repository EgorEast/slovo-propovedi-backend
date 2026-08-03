import { Module, forwardRef } from '@nestjs/common';
import { PlaylistService } from './playlist.service';
import { PlaylistController } from './playlist.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlaylistEntity } from './entities/playlist.entity';
import { SectionEntity } from 'src/section/entities/section.entity';
import { SermonModule } from 'src/sermon/sermon.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PlaylistEntity, SectionEntity]),
    SermonModule,
  ],
  controllers: [PlaylistController],
  providers: [PlaylistService],
  exports: [PlaylistService],
})
export class PlaylistModule {}
