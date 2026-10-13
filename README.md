# ForgeFlow Backend

JavaScript/Node.js backend for ForgeFlow. This repository contains independent runtime services, one root npm lockfile and CI pipeline. **Milestone 2A is a skeleton, not a functional authentication or CRM API.**

## Current state — Milestone 2A

| Runtime | Development port | Routes available |
| --- | --- | --- |
| API Gateway | 3001 | `/health/live`, `/health/ready` |
| Auth Service | 3002 | `/health/live`, `/health/ready` |
| Core Service | 3003 | `/health/live`, `/health/ready` |

Realtime and Worker will be added in later milestones. PostgreSQL, Redis, migrations, actual API routing, JWTs, rate limits, Docker builds and production-grade readiness will be implemented in upcoming slices. Never expose current Auth/Core development ports to the public Internet.

## Requirements

- Node.js 24 (`.nvmrc`), npm and Git Bash on Windows
- Separate GitHub repository: `forgeflow-frontend`

## First-time setup

```bash
cd /e/ForgeFlow/forgeflow-backend
npm install
cp .env.example .env
npm run lint
npm test
```

`npm install` generates the **root `package-lock.json`**. Commit that lockfile so GitHub Actions can run `npm ci`. Don't commit `.env`.

## Run services locally

Open three terminals from the backend repository root:

```bash
npm run dev:gateway
npm run dev:auth
npm run dev:core
```

Health endpoints:

- <http://127.0.0.1:3001/health/live>
- <http://127.0.0.1:3002/health/live>
- <http://127.0.0.1:3003/health/live>

Each service has its own npm workspace at `apps/<service-name>`. You can also run e.g. `npm run dev --workspace=apps/api-gateway`.

## Request flow (future)

Browser → Next.js BFF → ingress / Nginx → API Gateway → Auth or Core → PostgreSQL.

Each service will use route → middleware → controller → service → repository modules when domain APIs arrive. Services handle business rules and transactions; repositories own parameterized SQL. Gateway routes and authenticates, but does not query domain tables.

## Security foundation

- Express hides its identifying header and uses Helmet.
- Request IDs are newly generated; arbitrary forwarded IDs are not trusted.
- JSON request bodies limited to 64 KiB by default.
- Known parse/payload errors and unknown routes produce structured JSON.
- Pino logs request metadata, not request bodies or tokens.
- No auth/authorization is implemented yet; only health endpoints are registered.
- `/health/ready` means *process-only* readiness for now. Later it must incorporate dependencies.

## CI and development workflow

Feature branch → `npm run lint && npm test` → commit including root lockfile → push → PR → latest-commit GitHub Actions green → review → squash merge. The `Backend CI` workflow validates PRs and main pushes. Extend it with PostgreSQL/Redis integration tests and Docker builds in later slices.

## Phase 2 roadmap

- 2A: service foundations, tests and CI
- 2B: PostgreSQL + Redis Compose, migrations, integration tests
- 2C: Dockerfiles and runtime/container hardening
- 2D: Next.js BFF ↔ Gateway connection
