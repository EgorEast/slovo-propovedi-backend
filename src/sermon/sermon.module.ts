import { Module } from '@nestjs/common';
import { SermonService } from './sermon.service';
import { SermonController } from './sermon.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SermonEntity } from './entities/sermon.entity';

@Module({
  imports: [TypeOrmModule.forFeature([SermonEntity])],
  controllers: [SermonController],
  providers: [SermonService],
  exports: [SermonService],
})
export class SermonModule {}
