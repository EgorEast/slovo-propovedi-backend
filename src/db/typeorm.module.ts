import { Module } from '@nestjs/common';
import { TypeOrmModule as NestTypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    NestTypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const configuredPort = Number(configService.get('POSTGRES_PORT', 5432));
        if (!Number.isInteger(configuredPort)) {
          throw new Error(
            `POSTGRES_PORT must be an integer, got "${configService.get(
              'POSTGRES_PORT',
            )}"`,
          );
        }
        return {
          type: 'postgres',
          host: configService.get('POSTGRES_HOST'),
          port: configuredPort,
          username: configService.get('POSTGRES_USER'),
          password: configService.get('POSTGRES_PASSWORD'),
          database: configService.get('POSTGRES_DB'),
          entities: [
            __dirname + '/../**/*.entity.{js,ts}',
            'node_modules/nestjs-admin/**/*.entity.js',
          ],
          // PgBouncer (transaction mode) setup — see backend/sql/bootstrap.sql.
          //
          // The playbook puts PgBouncer in front of PostgreSQL
          // (POSTGRES_HOST=slovo-pgbouncer, POSTGRES_PORT=6432) so the DB only
          // ever sees a handful of pooled connections. For transaction mode to
          // work the backend must avoid the things PgBouncer cannot proxy:
          //
          // - synchronize: false — DDL must not run through the pooler. The
          //   schema is created once from backend/sql/bootstrap.sql instead.
          // - installExtensions: false — extension provisioning ("CREATE
          //   EXTENSION uuid-ossp") is done in bootstrap.sql, not at runtime
          //   through the pooler.
          // - poolSize: 5 — PgBouncer already pools connections, so the backend
          //   only needs a small client pool. This also keeps the Node.js heap
          //   footprint low on the 1 vCPU / 2GB VPS.
          synchronize: false,
          installExtensions: false,
          poolSize: 5,
        };
      },
      inject: [ConfigService],
    }),
  ],
})
export class TypeOrmModule {}
