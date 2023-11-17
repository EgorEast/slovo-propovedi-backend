import { Module } from '@nestjs/common';
import { SectionService } from './section.service';
import { SectionController } from './section.controller';
import { SectionEntity } from './entities/section.entity';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [TypeOrmModule.forFeature([SectionEntity])],
  controllers: [SectionController],
  providers: [SectionService],
})
export class SectionModule {}
