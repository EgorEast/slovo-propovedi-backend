import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule as NestTypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerGuard, ThrottlerModule, minutes } from '@nestjs/throttler';
import { ZodSerializerInterceptor } from 'nestjs-zod';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from './db/typeorm.module';
import { SectionModule } from './section/section.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PlaylistModule } from './playlist/playlist.module';
import { MinioModule } from './minio/minio.module';
import { ConfigModule } from '@nestjs/config';
import { SermonModule } from './sermon/sermon.module';
import { InvidiousInstancesModule } from './invidious-instances/invidious-instances.module';
import { FeatureFlagsModule } from './feature-flags/feature-flags.module';
import { HealthModule } from './health/health.module';
import { SermonEntity } from './sermon/entities/sermon.entity';
import { PlaylistEntity } from './playlist/entities/playlist.entity';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // Generous global baseline so the public catalog (sermons, playlists,
    // sections, files) is untouched in normal use. The auth controller
    // overrides this with stricter per-route limits (see AuthController).
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: minutes(1), limit: 300 }],
      errorMessage: 'Too many requests. Please try again later.',
    }),
    HealthModule,
    SectionModule,
    AuthModule,
    UsersModule,
    PlaylistModule,
    TypeOrmModule,
    SermonModule,
    InvidiousInstancesModule,
    FeatureFlagsModule,
    MinioModule,
    // AppController needs the sermon/playlist repositories to build the
    // referenced-file sets for the orphans endpoints.
    NestTypeOrmModule.forFeature([SermonEntity, PlaylistEntity]),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
    // Throttling is the only global guard; auth authorization stays per-route.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
