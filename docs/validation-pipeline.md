# Validation Pipeline — OpenAPI-First Workflow

This project uses an **OpenAPI-first** approach: the YAML spec is the single source of truth for all API contracts. Zod schemas and DTOs are generated from it.

## Workflow

### 1. Edit the OpenAPI spec

Make changes in `openAPI.yaml` (repo root). This is the source of truth.

### 2. Regenerate backend schemas

```bash
cd backend
npm run gen:schemas
```

This reads `openAPI.yaml` and generates Zod schemas into `src/generated/index.ts`.

### 3. CI freshness check

In CI, verify generated schemas are up-to-date:

```bash
npm run gen:schemas && git diff --exit-code -- src/generated/ || (echo "::error::Generated schemas are stale. Run: npm run gen:schemas" && exit 1)
```

If this fails, someone edited `openAPI.yaml` but forgot to regenerate.

### 4. Regenerate frontend API client

From `frontend/web-app/`:

```bash
npm run generate-api
```

This uses Orval to generate a typed API client from `openAPI.yaml`.

### Key rule

When `openAPI.yaml` changes, **both** backend and frontend must be regenerated:

```bash
# Backend
cd backend && npm run gen:schemas

# Frontend
cd frontend/web-app && npm run generate-api
```

Commit both the yaml and all generated files together.

## Validation layers

| Layer | Tool | Purpose |
|-------|------|---------|
| Request body/query/params | `ZodValidationPipe` (strict mode) | Validates incoming data against Zod DTOs |
| Response serialization | `@ZodResponse()` | Validates outgoing data matches the spec |
| Legacy routes | `ValidationPipe` (class-validator) | Fallback for any non-migrated routes |

`strictSchemaDeclaration: true` ensures every DTO at every boundary is a Zod DTO — no unvalidated data can slip through.
