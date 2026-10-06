import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { InvidiousInstancesService } from './invidious-instances.service';
import { InvidiousInstanceEntity } from './entities/invidious-instance.entity';

interface RepositoryMock {
  find: jest.Mock;
  count: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  clear: jest.Mock;
}

describe('InvidiousInstancesService', () => {
  let service: InvidiousInstancesService;
  let repository: RepositoryMock;
  let transactionRepository: RepositoryMock;
  let dataSource: { transaction: jest.Mock };

  beforeEach(async () => {
    const buildRepository = (): RepositoryMock => ({
      find: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      clear: jest.fn(),
    });

    repository = buildRepository();
    transactionRepository = buildRepository();
    dataSource = {
      transaction: jest.fn((callback: (manager: unknown) => unknown) =>
        callback({ getRepository: () => transactionRepository }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvidiousInstancesService,
        {
          provide: getRepositoryToken(InvidiousInstanceEntity),
          useValue: repository,
        },
        {
          provide: getDataSourceToken(),
          useValue: dataSource,
        },
      ],
    }).compile();

    service = module.get<InvidiousInstancesService>(InvidiousInstancesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('returns instances ordered by ascending id', async () => {
      repository.find.mockResolvedValue([
        { id: 1, url: 'https://a.example' },
        { id: 2, url: 'https://b.example' },
      ]);

      const result = await service.findAll();

      expect(repository.find).toHaveBeenCalledWith({ order: { id: 'ASC' } });
      expect(result).toEqual([
        { id: 1, url: 'https://a.example' },
        { id: 2, url: 'https://b.example' },
      ]);
    });
  });

  describe('replace', () => {
    it('clears the table and inserts the urls in order inside one transaction', async () => {
      transactionRepository.create.mockImplementation((data) => data);
      transactionRepository.save.mockImplementation((rows) =>
        Promise.resolve(rows.map((row, index) => ({ id: index + 1, ...row }))),
      );

      const result = await service.replace([
        'https://a.example',
        'https://b.example',
      ]);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(transactionRepository.clear).toHaveBeenCalledTimes(1);
      expect(transactionRepository.create).toHaveBeenNthCalledWith(1, {
        url: 'https://a.example',
      });
      expect(transactionRepository.create).toHaveBeenNthCalledWith(2, {
        url: 'https://b.example',
      });
      expect(result).toEqual([
        { id: 1, url: 'https://a.example' },
        { id: 2, url: 'https://b.example' },
      ]);
    });

    it('rejects duplicate urls before touching the database', async () => {
      await expect(
        service.replace(['https://a.example', 'https://a.example']),
      ).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('rejects urls that do not start with https://', async () => {
      await expect(service.replace(['http://a.example'])).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.replace(['ftp://a.example'])).rejects.toThrow(
        BadRequestException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('allows an empty list (full replace with nothing)', async () => {
      transactionRepository.save.mockResolvedValue([]);

      const result = await service.replace([]);

      expect(transactionRepository.clear).toHaveBeenCalledTimes(1);
      expect(result).toEqual([]);
    });
  });

  describe('onModuleInit (seed)', () => {
    it('seeds the verified instances when the table is empty', async () => {
      repository.count.mockResolvedValue(0);
      repository.create.mockImplementation((data) => data);
      repository.save.mockResolvedValue([]);

      await service.onModuleInit();

      expect(repository.save).toHaveBeenCalledWith([
        { url: 'https://inv.phobos.observer' },
        { url: 'https://invidious.f5.si' },
      ]);
    });

    it('does not seed when the table already has rows', async () => {
      repository.count.mockResolvedValue(2);

      await service.onModuleInit();

      expect(repository.save).not.toHaveBeenCalled();
    });

    it('swallows seed failures so bootstrap is not aborted', async () => {
      repository.count.mockRejectedValue(new Error('db down'));

      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });
});
