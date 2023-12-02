import { Test, TestingModule } from '@nestjs/testing';
import { PlaylistController } from './sermon.controller';
import { PlaylistService } from './sermon.service';

describe('PlaylistController', () => {
  let controller: PlaylistController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlaylistController],
      providers: [PlaylistService],
    }).compile();

    controller = module.get<PlaylistController>(PlaylistController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
