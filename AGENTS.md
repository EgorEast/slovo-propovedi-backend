# AGENTS.md

Backend API guide for agents working in this repository: the **Слово.Проповеди NestJS backend API** —
a NestJS 10 + TypeORM + PostgreSQL + MinIO service. This repo is the standalone backend, split from the
former `slovo-propovedi-admin` monorepo; its former path `backend/` is now the repo root.

## Read the knowledge base first

- Start with `docs/README.md` and `docs/architecture.md` before touching the application bootstrap or
  environment handling.
- Read the relevant `docs/modules/<module>.md` document before implementing or changing a module
  (auth, users, sermons, playlists, sections, minio, app/files, health).
- Update the affected `docs/**` in the same commit as the code change.
- Record any TODO/hack in the same commit (see `docs/README.md` for the debt-document convention).

## Documentation rules

Documentation lives in `docs/` and is written in **Russian** (the AGENTS.md and the root README.md are
the exceptions — they are in English).

- Every backend module is documented in `docs/modules/<name>.md` — one document per module plus
  `docs/modules/README.md` as the index.
- The REST contract and the codegen pipeline are documented in `docs/contracts/rest-api.md`; the spec
  itself is external, in the `slovo-propovedi-docs` repo (published at
  `https://docs.slovo-propovedi.ru/openAPI.yaml`).
- The DB schema is in `docs/db.md`; the validation pipeline in `docs/validation-pipeline.md`.
- **Source of truth = validation schemas.** The API contract is defined by the generated zod schemas
  (`src/generated/index.ts`) exposed via `createZodDto` DTOs, not by prose docs. Docs describe; schemas
  decide. Never trust a doc field list over the schema. OpenAPI version is not pinned in docs — see
  `info.version` in the external `openAPI.yaml`.
- **Update docs in the same PR as the code change.** A code change without a docs update is incomplete.
- **Tech debt: fix new debt immediately instead of recording it.** When a debt item is resolved,
  **delete** its entry from `docs/debt.md` — the file lists **open** debts only; resolved entries are
  removed, not archived.

## Stack & conventions

- **NestJS 10**, **TypeORM** (`synchronize: false`), **PostgreSQL**, **MinIO**.
- **Validation via `nestjs-zod`**: `createZodDto(...)` for every request DTO, `@ZodResponse` for
  responses, strict `zod.strictObject` at the boundary. `strictSchemaDeclaration: true` requires every
  route parameter to be a Zod DTO.
- **Passwords via `bcrypt`** (10 rounds). **Auth via JWT** — own `AuthGuard`, payload `{ id, email }`;
  no Passport. No global guard — protection is per-route.
- **Parse, don't validate** at the boundary: `@nestjs/zod` rejects unknown keys; generated schemas are
  the single source of truth, extended/overridden with `.extend(...)` where needed (never rewritten).
- **Generated code is a contract.** `src/generated/index.ts` is **never hand-edited** — only
  regenerated.

## OpenAPI-first codegen

- The API contract lives in the **external** `slovo-propovedi-docs` repo and is published at
  `https://docs.slovo-propovedi.ru/openAPI.yaml`. There is no OpenAPI file in this repo.
- After the spec changes, run `npm run gen:schemas` (Orval → `src/generated/index.ts`) and commit the
  regenerated schemas together with the code.
- The frontend SDK is generated separately in the `slovo-propovedi-admin` repo.

## DDL

- Schema changes only via SQL files: `sql/bootstrap.sql` (fresh DB) plus manual migrations under
  `sql/` (e.g. `sql/migrate-add-username.sql`, `sql/migrations/001_add_positions.sql`).
- Never use ORM `synchronize` for schema changes (`synchronize: false`). Migrations are applied
  manually via `psql` and are idempotent.

## Quality gates

- `npm run test` — unit tests (Jest).
- `npm run build` — `nest build`.
- `npm run lint` — eslint.

## Deployment

- Deploy is tag-driven: push a `v*` tag → Forgejo Actions builds the Docker image and deploys to the VPS.
- Commits follow Conventional Commits (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`).
