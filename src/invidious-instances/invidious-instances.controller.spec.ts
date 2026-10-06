import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InvidiousInstancesController } from './invidious-instances.controller';
import { InvidiousInstancesService } from './invidious-instances.service';
import { AuthGuard } from '../auth/guard/auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/user-role.enum';

describe('InvidiousInstancesController', () => {
  let controller: InvidiousInstancesController;
  let service: { findAll: jest.Mock; replace: jest.Mock };

  beforeEach(async () => {
    service = { findAll: jest.fn(), replace: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InvidiousInstancesController],
      providers: [
        { provide: InvidiousInstancesService, useValue: service },
        // AuthGuard (referenced by @UseGuards) needs a JwtService to construct.
        { provide: JwtService, useValue: {} },
      ],
    }).compile();

    controller = module.get<InvidiousInstancesController>(
      InvidiousInstancesController,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('findAll delegates to the service', async () => {
    service.findAll.mockResolvedValue([{ id: 1, url: 'https://a.example' }]);

    await expect(controller.findAll()).resolves.toEqual([
      { id: 1, url: 'https://a.example' },
    ]);
  });

  it('replace passes the urls to the service', async () => {
    service.replace.mockResolvedValue([{ id: 1, url: 'https://a.example' }]);

    await controller.replace({ urls: ['https://a.example'] });

    expect(service.replace).toHaveBeenCalledWith(['https://a.example']);
  });

  it('protects both routes with AuthGuard + RolesGuard for admins only', () => {
    const reflector = new Reflector();

    for (const handler of [controller.findAll, controller.replace]) {
      expect(reflector.get(ROLES_KEY, handler)).toEqual([UserRole.Admin]);
      const guards = reflector.get<unknown[]>('__guards__', handler);
      expect(guards).toContain(AuthGuard);
      expect(guards).toContain(RolesGuard);
    }
  });
});
