import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { FeatureFlag } from './entities/feature-flag.entity';
import { FeatureFlagOverride } from './entities/feature-flag-override.entity';
import { FeatureFlagsController } from './feature-flags.controller';
import { FeatureFlagsService } from './feature-flags.service';

@Module({
  imports: [TypeOrmModule.forFeature([FeatureFlag, FeatureFlagOverride, User])],
  controllers: [FeatureFlagsController],
  providers: [FeatureFlagsService],
})
export class FeatureFlagsModule {}
