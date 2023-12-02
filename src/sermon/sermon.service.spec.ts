import { Test, TestingModule } from '@nestjs/testing';
import { SermonService } from './sermon.service';

describe('SermonService', () => {
  let service: SermonService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SermonService],
    }).compile();

    service = module.get<SermonService>(SermonService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
