# Milestone 2B — PostgreSQL, Redis, migrations and pgAdmin

All commands below run from `E:\ForgeFlow\forgeflow-backend` in VS Code **Git Bash**.
These instructions assume Docker Desktop is started. Use `docker-compose` on this Windows machine (its `docker compose` plugin is not detected).

## 1. Create the branch and apply the ZIP patch

Start with clean, updated `main`:

```bash
cd /e/ForgeFlow/forgeflow-backend
git status --short
git switch main
git pull --ff-only
git switch -c feat/database-infrastructure
```

Copy the patch archive contents into `forgeflow-backend` **merging** existing directories. It adds files and updates `.env.example` and CI; it should not erase 2A services or their README.

## 2. Install the libraries and scripts

```bash
npm install pg redis
npm install -D node-pg-migrate
npm pkg set 'scripts.db:migrate=node --env-file-if-exists=.env scripts/db-migrate.js'
npm pkg set 'scripts.db:seed=node scripts/db-seed.js'
npm pkg set 'scripts.test:integration=node --env-file-if-exists=.env ./node_modules/vitest/vitest.mjs run --config vitest.integration.config.js'
```

`pg` is the PostgreSQL client/pool library. `redis` is the Redis client for our integration test. `node-pg-migrate` manages versioned SQL migrations. These are root workspace dependencies; when adding business modules, declare their direct runtime dependencies in the appropriate workspace too.

## 3. Fill in local credentials

Open your **existing** `.env` and ADD missing 2B variables from `.env.example`. Do NOT replace your existing host/port settings blindly.
Generate four **different** passwords (run this command four times, each time copy the output to a different key):

```bash
node -e "console.log(require('node:crypto').randomBytes(24).toString('hex'))"
```

Place the values in `.env` for `POSTGRES_PASSWORD`, `AUTH_DB_PASSWORD`, `CORE_DB_PASSWORD`, and `MIGRATOR_DB_PASSWORD`. The file is gitignored. For local development use `DB_HOST=127.0.0.1`, `DB_PORT=5433`, `DB_NAME=forgeflow_dev`, `REDIS_URL=redis://127.0.0.1:6380`.

IMPORTANT: Docker's `.env` interpolation and Node's `--env-file-if-exists=.env` will read the SAME local file.

## 4. Start infrastructure and migrate

```bash
docker-compose config --quiet
docker-compose up -d --wait postgres redis
docker-compose ps
npm run db:migrate
npm run db:migrate
npm run test:integration
```

The second migration command must succeed without adding another migration history record. No sample users/projects are created in 2B. `npm run db:seed` intentionally does nothing yet.

If `--wait` is unsupported, use `docker-compose up -d postgres redis`, wait for both containers to become healthy in `docker-compose ps`, then run migrations.

## 5. Connect pgAdmin

pgAdmin 4 → **Register > Server**:

- General → Name: `ForgeFlow Local`
- Connection → Host: `127.0.0.1`
- Port: `5433`
- Maintenance DB: `forgeflow_dev`
- Username: `forgeflow_migrator`
- Password: your `MIGRATOR_DB_PASSWORD` from `.env`

Expand **Databases → forgeflow_dev → Schemas**. You should find `auth`, `core` and `public`. The migration history table is `public.pgmigrations`. You can inspect it using pgAdmin's Query Tool:

```sql
SELECT * FROM public.pgmigrations;
```

Do not use the migration user for application requests. App pools use `forgeflow_auth` and `forgeflow_core` respectively. Your pgAdmin migration account is for **local inspection only**.

## 6. Verify persistence, then finish milestone checks

```bash
docker-compose restart postgres
docker-compose up -d --wait postgres redis
npm run test:integration
npm run lint
npm test
```

PostgreSQL and Redis use named Docker volumes; `restart` keeps them. Do not use `docker-compose down -v` locally unless you explicitly want to DESTROY local database and queue data. Normal stop: `docker-compose down` (volumes preserved).

## 7. GitHub PR

```bash
git status --short
git add compose.yml docker .env.example shared/db-config.js apps/auth-service/src/db apps/core-service/src/db migrations scripts tests/db-config.test.js tests/integration vitest.integration.config.js docs/database-infrastructure.md docs/erd.md docs/api.md .github/workflows/ci.yml package.json package-lock.json
git diff --cached --stat
git commit -m "feat(database): add PostgreSQL Redis and migrations"
git push -u origin feat/database-infrastructure
```

Open a PR to `main`, wait for latest-commit CI green, self-review, squash-merge, and update your local `main`. Record the true PR URL/check outcomes. Dockerfiles for Gateway/Auth/Core are the next slice **2C**, not this one.

## How the pieces connect

`pgAdmin` (Windows) → localhost:5433 → Docker Postgres:5432.

`Auth service` → `createAuthPool()` → `pg` → `forgeflow_auth` DB role → `auth` schema.

`Core service` → `createCorePool()` → `pg` → `forgeflow_core` DB role → `core` schema.

`npm run db:migrate` → node-pg-migrate → `forgeflow_migrator` → CREATE and GRANT schemas, plus `public.pgmigrations`.

`Redis` is running for future queues/rate-limits. No service's business code uses it yet. Gateway has no SQL access.

## Troubleshooting and important limitations

- `password authentication failed`: inspect `.env`. Passwords from `docker/postgres/init` are set on **first initialization only**. Editing `.env` later does not update roles in an existing volume. Don't reset local volumes until you know the data is disposable.
- `5433 already allocated`: identify the existing listener and change BOTH `compose.yml` host port and `DB_PORT` in `.env` (then pgAdmin port too).
- `connection refused`: ensure Docker Desktop and both containers are running, wait for healthy state.
- `permission denied`: migrations MUST use `forgeflow_migrator`, not `forgeflow_auth` or `forgeflow_core`.
- Real database domain tables, API handlers, full readiness probes, transactions, and BFF connectivity are **not implemented** in 2B. Shared database has coupling; separate schemas/roles limit but don't remove it.
- `docker/postgres/init/` scripts only run for empty volumes. Never assume they reapply on restart.
