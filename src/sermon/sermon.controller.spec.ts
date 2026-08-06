import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { SermonController } from './sermon.controller';
import { SermonService } from './sermon.service';

describe('SermonController', () => {
  let controller: SermonController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SermonController],
      providers: [
        { provide: SermonService, useValue: {} },
        { provide: JwtService, useValue: {} },
      ],
    }).compile();

    controller = module.get<SermonController>(SermonController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
