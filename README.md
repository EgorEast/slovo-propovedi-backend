# Слово.Проповеди — Backend API

NestJS 10 + TypeORM + PostgreSQL + MinIO backend for **«Слово.Проповеди»** — the API powering the
public site, the admin SPA and the mobile client. Repository root is the former `backend/` of the
`slovo-propovedi-admin` monorepo, now a standalone repository.

## Documentation

Architectural and operational documentation lives in [`docs/`](./docs) (in Russian) — start with
[`docs/README.md`](./docs/README.md), which is the index and the hard rules for agents.

- **Agent guide:** [`AGENTS.md`](./AGENTS.md) — read this first when working in this repo.
- **REST contract & codegen pipeline:** [`docs/contracts/rest-api.md`](./docs/contracts/rest-api.md).
  The spec itself is external, in the `slovo-propovedi-docs` repo, published at
  [`https://docs.slovo-propovedi.ru/openAPI.yaml`](https://docs.slovo-propovedi.ru/openAPI.yaml).
- **Contract source of truth = generated validation schemas** (`src/generated/index.ts`); the spec
  version lives in the external `openAPI.yaml`.
- **DB schema:** [`docs/db.md`](./docs/db.md). **Architecture:** [`docs/architecture.md`](./docs/architecture.md).

Documentation rules:

- Update `docs/**` in the **same PR** as the code change — a code change without a docs update is incomplete.
- Every backend module is documented in `docs/modules/<name>.md`.
- Generated code in `src/generated/` is **never hand-edited** — only regenerated via `npm run gen:schemas`.

## Installation

```bash
$ npm install
```

## Running the app

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Test

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## License

Private / UNLICENSED (see `package.json`).
