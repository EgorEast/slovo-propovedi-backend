import { Module } from '@nestjs/common';
import { PlaylistService } from './playlist.service';
import { PlaylistController } from './playlist.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlaylistEntity } from './entities/playlist.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PlaylistEntity])],
  controllers: [PlaylistController],
  providers: [PlaylistService],
})
export class PlaylistModule {}
