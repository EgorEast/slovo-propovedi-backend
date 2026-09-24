import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule as NestTypeOrmModule } from '@nestjs/typeorm';
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
import { HealthModule } from './health/health.module';
import { SermonEntity } from './sermon/entities/sermon.entity';
import { PlaylistEntity } from './playlist/entities/playlist.entity';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    HealthModule,
    SectionModule,
    AuthModule,
    UsersModule,
    PlaylistModule,
    TypeOrmModule,
    SermonModule,
    MinioModule,
    // AppController needs the sermon/playlist repositories to build the
    // referenced-file sets for the orphans endpoints.
    NestTypeOrmModule.forFeature([SermonEntity, PlaylistEntity]),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
  ],
})
export class AppModule {}
