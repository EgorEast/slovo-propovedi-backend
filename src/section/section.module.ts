import { Module } from '@nestjs/common';
import { SectionService } from './section.service';
import { SectionController } from './section.controller';
import { SectionEntity } from './entities/section.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlaylistModule } from 'src/playlist/playlist.module';

@Module({
  imports: [TypeOrmModule.forFeature([SectionEntity]), PlaylistModule],
  controllers: [SectionController],
  providers: [SectionService],
})
export class SectionModule {}
