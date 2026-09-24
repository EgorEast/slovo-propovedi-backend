import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { MinioService } from './minio/minio.service';
import { SermonEntity } from './sermon/entities/sermon.entity';
import { PlaylistEntity } from './playlist/entities/playlist.entity';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        { provide: MinioService, useValue: {} },
        { provide: JwtService, useValue: {} },
        { provide: getRepositoryToken(SermonEntity), useValue: {} },
        { provide: getRepositoryToken(PlaylistEntity), useValue: {} },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should be defined', () => {
      expect(appController).toBeDefined();
    });
  });
});
