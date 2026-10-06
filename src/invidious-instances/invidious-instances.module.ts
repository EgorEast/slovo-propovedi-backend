import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvidiousInstanceEntity } from './entities/invidious-instance.entity';
import { InvidiousInstancesController } from './invidious-instances.controller';
import { InvidiousInstancesService } from './invidious-instances.service';

@Module({
  imports: [TypeOrmModule.forFeature([InvidiousInstanceEntity])],
  controllers: [InvidiousInstancesController],
  providers: [InvidiousInstancesService],
  exports: [InvidiousInstancesService, TypeOrmModule],
})
export class InvidiousInstancesModule {}
