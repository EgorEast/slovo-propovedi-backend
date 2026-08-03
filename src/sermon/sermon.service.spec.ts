import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SermonService } from './sermon.service';
import { SermonEntity } from './entities/sermon.entity';
import { PlaylistEntity } from 'src/playlist/entities/playlist.entity';
import { MinioService } from 'src/minio/minio.service';

describe('SermonService', () => {
  let service: SermonService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SermonService,
        {
          provide: getRepositoryToken(SermonEntity),
          useValue: {},
        },
        {
          provide: getRepositoryToken(PlaylistEntity),
          useValue: {},
        },
        {
          provide: MinioService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<SermonService>(SermonService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
