import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { InvidiousInstanceEntity } from './entities/invidious-instance.entity';

// Instances verified working on 2026-10-05 via the /api/v1/videos probe.
// Seeded only while the table is empty, so a fresh deploy starts with a usable
// list instead of an empty import form.
const SEED_URLS = ['https://inv.phobos.observer', 'https://invidious.f5.si'];

const HTTPS_PREFIX = 'https://';

@Injectable()
export class InvidiousInstancesService implements OnModuleInit {
  private readonly logger = new Logger(InvidiousInstancesService.name);

  constructor(
    @InjectRepository(InvidiousInstanceEntity)
    private readonly repository: Repository<InvidiousInstanceEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedIfEmpty();
  }

  async findAll(): Promise<InvidiousInstanceEntity[]> {
    try {
      return await this.repository.find({ order: { id: 'ASC' } });
    } catch (error) {
      throw this.wrap('findAll', error);
    }
  }

  async replace(urls: string[]): Promise<InvidiousInstanceEntity[]> {
    this.assertValidUrls(urls);
    try {
      return await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(InvidiousInstanceEntity);
        // Full replace. The entity carries no position column, so the only way
        // to persist the requested order (which IS the UI order) is to rewrite
        // every row; ids then stay ascending and mirror the array order.
        await repository.clear();
        const rows = urls.map((url) => repository.create({ url }));
        return await repository.save(rows);
      });
    } catch (error) {
      throw this.wrap('replace', error);
    }
  }

  private async seedIfEmpty(): Promise<void> {
    try {
      if ((await this.repository.count()) > 0) {
        return;
      }
      await this.repository.save(
        SEED_URLS.map((url) => this.repository.create({ url })),
      );
      this.logger.log(`Seeded ${SEED_URLS.length} Invidious instances`);
    } catch (error) {
      // Best-effort: a seed failure must never abort application bootstrap.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to seed Invidious instances: ${message}`);
    }
  }

  private assertValidUrls(urls: string[]): void {
    if (new Set(urls).size !== urls.length) {
      throw new BadRequestException('Дубликаты Invidious-инстансов запрещены');
    }
    for (const url of urls) {
      if (!url.startsWith(HTTPS_PREFIX)) {
        throw new BadRequestException(
          `Адрес должен начинаться с ${HTTPS_PREFIX}: ${url}`,
        );
      }
    }
  }

  private wrap(operation: string, error: unknown): HttpException {
    if (error instanceof HttpException) {
      return error;
    }
    const message = error instanceof Error ? error.message : String(error);
    return new HttpException(
      `from:${operation} ${message}`,
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
