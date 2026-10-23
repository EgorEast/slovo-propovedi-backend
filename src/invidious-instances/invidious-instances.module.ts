import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvidiousInstanceEntity } from './entities/invidious-instance.entity';
import { InvidiousInstancesController } from './invidious-instances.controller';
import { InvidiousInstancesService } from './invidious-instances.service';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([InvidiousInstanceEntity]),
    // AuthGuard re-checks the live user (role/token_version) on every request.
    UsersModule,
  ],
  controllers: [InvidiousInstancesController],
  providers: [InvidiousInstancesService],
  exports: [InvidiousInstancesService, TypeOrmModule],
})
export class InvidiousInstancesModule {}
