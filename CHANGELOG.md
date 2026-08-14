# Changelog

All notable changes are auto-generated from [conventional commits](https://www.conventionalcommits.org/) at release time via `npm run bump-version`.

## [Unreleased]

### Features
- three-tier roles (admin/moderator/user): UserRole enum, role column + CHECK + migration 002, RolesGuard + @Roles
- role-based access matrix: users admin-only, content admin/moderator, profile any authenticated user
- JWT payload now carries role; AuthGuard parses payload (legacy tokens → 401 → refresh upgrade)
- refreshTokens re-fetches the live user so stale/demoted roles take effect; last-admin demotion/removal guarded in transactions

## [0.2.0] - 2026-08-13

### Features
- forbid self-delete and last-admin removal (403 guard)
- full CRUD + change-password backend (controller, service, DTOs, tests)

### Maintenance
- add standalone docs/ (modules, contracts, architecture, conventions, db), AGENTS.md, update README
- add update ConflictException coverage for unique violation

## [0.1.1] - 2026-08-13

### Bug Fixes
- filter CI status by context in release workflow

## [0.1.0] - 2026-08-13

### Features
- add case-insensitive sermon search
- add playlists field to PlaylistSermon and setup pre-commit type-check hook
- restrict sermon audio to MP3, add middle transform option, allow PDF/FB2 uploads
- add cover reuse and drag-and-drop reordering
- login by username instead of email
- phase 11 cleanup — strict mode, dead code removal, sermon entity fix, CI docs, server URL
- migrate to Zod input+output validation
- presigned URLs, PgBouncer support, keyset pagination, GIN index for 200 concurrent users
- disable Swagger in backend, move OpenAPI spec to standalone service
- extend DTOs and services for many-to-many relations
- add health endpoint
- fix, add Makefile and .vault
- align backend endpoints with OpenAPI spec
- update Dockerfile from backend
- added nginx and update uploadFile method
- section-playlist relation and update sevices methods
- update relations
- sermons added
- added readme file

### Bug Fixes
- send null for cleared nullable fields in forms and regenerate types
- correct HTTP error codes and add position to section response
- populate nested playlists sections and sermons in API response
- normalize entities on create/findOne/update (fix 500 when relations attached)
- make files bucket public-read (s3:GetObject) so stored URLs stop 403ing
- default undefined relation arrays to [] in findAll (fix GET list 500)
- make @UploadedFile param a permissive ZodDto (strict global pipe → 500)
- return sections:[] and sermons:[] on create (match @ZodResponse contract, fix 500)
- return playlists:[] on create (match @ZodResponse contract, fix 500)
- remove redundant class-validator ValidationPipe
- drop whitelist from global ValidationPipe (stripped zod DTO props → login 500)
- move js-yaml to runtime dependencies (loaded unconditionally in main.ts)
- bump node 18->20 (global File for orval-generated zod schemas)
- --legacy-peer-deps on prod install too (orval/prettier peer conflict)
- npm install --legacy-peer-deps (orval/prettier peer conflict)
- add http code for login endpoint
- harden OpenAPI spec for correct Zod schema generation
- limit Node.js heap during build to prevent server OOM
- update Dockerfile, added build for server(9)
- update Dockerfile, added build for server(8)
- update Dockerfile, added build for server(7)
- update Dockerfile, added build for server(7)
- update Dockerfile, added build for server(6)
- update Dockerfile, added build for server(5)
- update Dockerfile, added build for server(4)
- update Dockerfile, added build for server(3)
- update Dockerfile, added build for server(2)
- update Dockerfile, added build for server(1)
- update Dockerfile, added build for server
- update package.json

### Refactors
- rename SWAGGER_* env vars to DOCS_*
- move openAPI.yaml to docs repo, fetch spec from remote URL, remove local yaml

### Maintenance
- use node 24 in docker and release workflow
- bump node to 24
- add Forgejo Actions CI/CD with self-contained deploy
- add .env to gitignore
- fix jest coverageDirectory for standalone repo
- apply prettier formatting to playlist and section services
- update openapi spec version
- format generated schemas with prettier in gen-schemas script
- enable strict Zod object validation in orval
- regenerate Zod schemas from updated OpenAPI spec
- format some files
- fix stale controller specs
- phase 1 - Set up OpenAPI-first Zod validation

### Other
- update docs
- added swagger and edit docs
- first commit
