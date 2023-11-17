import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from './db/typeorm.module';
import { SectionModule } from './section/section.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PlaylistModule } from './playlist/playlist.module';
import { MinioService } from './minio/minio.service';
import { ConfigModule } from '@nestjs/config';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    SectionModule,
    AuthModule,
    UsersModule,
    PlaylistModule,
    TypeOrmModule,
  ],
  controllers: [AppController],
  providers: [AppService, MinioService],
})
export class AppModule {}
