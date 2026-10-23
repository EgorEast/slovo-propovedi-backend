import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { SermonController } from './sermon.controller';
import { SermonService } from './sermon.service';
import { UsersService } from '../users/users.service';

describe('SermonController', () => {
  let controller: SermonController;
  let sermonService: { getDistinctValues: jest.Mock };

  beforeEach(async () => {
    sermonService = { getDistinctValues: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SermonController],
      providers: [
        { provide: SermonService, useValue: sermonService },
        { provide: JwtService, useValue: {} },
        // AuthGuard (referenced by @UseGuards) re-checks the live user.
        { provide: UsersService, useValue: {} },
      ],
    }).compile();

    controller = module.get<SermonController>(SermonController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates getDistinctValues to the service', async () => {
    const result = { artists: ['Иоанн'], books: ['Бытие'] };
    sermonService.getDistinctValues.mockResolvedValue(result);

    await expect(controller.getDistinctValues()).resolves.toBe(result);
    expect(sermonService.getDistinctValues).toHaveBeenCalledTimes(1);
  });
});
