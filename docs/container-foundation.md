# ForgeFlow — Milestone 2C: Docker Foundation

This document explains the added files using beginner-friendly Bangla and English technical terms.

**Scope:** three Node.js containers; PostgreSQL and Redis reuse the **2B** setup. There is NO authentication, project CRUD, BFF connection, or Gateway forwarding yet.

## 1) New files — why do we need them?

| File | Responsibility |
| --- | --- |
| `apps/api-gateway/Dockerfile` | Creates a Linux image that runs the Gateway Node.js process on port 3001. |
| `apps/auth-service/Dockerfile` | Creates a separate image for the Auth process on port 3002. |
| `apps/core-service/Dockerfile` | Creates a separate image for the Core process on port 3003. |
| `.dockerignore` | Prevents `.env`, `.git`, `node_modules`, and unnecessary files from entering Docker's build context. |
| `compose.apps.yml` | Adds the three services *on top of* existing `compose.yml`; does not replace database/Redis setup. |
| `scripts/smoke-internal.js` | Runs inside Gateway container and confirms Docker DNS can reach Auth and Core health routes. |
| `.github/workflows/container-build.yml` | Builds and starts containers in disposable GitHub CI, then checks health endpoints. |

## 2) Concepts in easy Bangla

- **Dockerfile** হলো একটি *recipe*। এর instruction দিয়ে image বানায়।
- **Image** হলো application চালানোর packaged template।
- **Container** হলো সেই image থেকে চালু হওয়া process/environment।
- **Compose** একাধিক container, network, environment, volumes একসাথে define করে।
- **Build context** হলো Docker build-এর সময় পাঠানো files-এর collection। `.dockerignore` context ছোট ও নিরাপদ রাখে।
- `npm ci --omit=dev` committed `package-lock.json` মেনে production dependencies install করে।
- `USER node` মানে app process root user হিসেবে run করে না।
- `CMD ["node", "..."]` সরাসরি Node.js process চালায়। Docker shutdown signal সেটিতে পৌঁছাতে পারে।
- `HOST=0.0.0.0` container-এর network interface-এ listen করে। `127.0.0.1` হলে অন্য container সেটি reach করতে পারত না।

## 3) Containers and ports

```text
Your Windows browser
  |
  | http://127.0.0.1:3001/health/live
  v
Gateway container :3001  (host published on Windows loopback only)
  |
  | (2C smoke test only; NO routing yet)
  +--> http://auth:3002/health/live --> Auth container :3002
  +--> http://core:3003/health/live --> Core container :3003

Auth/Core: internal-only (no Windows host ports)
  |
  +--> postgres:5432  (prepared environment, DB not queried by health routes)

PostgreSQL: Windows 127.0.0.1:5433 -> container postgres:5432
Redis:      Windows 127.0.0.1:6380 -> container redis:6379
```

Docker service names `auth`, `core`, `postgres` are private network hostnames.
The `gateway` health endpoint does not currently forward any API request to Auth/Core.

## 4) Prerequisites and branch setup

Use **VS Code Git Bash on Windows**, from `E:\ForgeFlow\forgeflow-backend`.

1. Start Docker Desktop.
2. Ensure 2B was merged and local `main` is updated.
3. Run `git status --short` and preserve unexpected local modifications.

```bash
cd /e/ForgeFlow/forgeflow-backend
git switch main
git pull --ff-only
git switch -c feat/container-foundation
```

Extract the Milestone 2C ZIP **into the backend repo root**, merging folders. The patch contains **only new paths**. Keep your existing `.env`, `compose.yml`, migrations, and 2B permission fixes.

## 5) Start the full backend infrastructure

Keep the existing 2B `.env` file with four local passwords. Docker Compose automatically reads it for variable interpolation. No real credentials are committed.

```bash
docker-compose -f compose.yml -f compose.apps.yml config --quiet
docker-compose -f compose.yml -f compose.apps.yml up -d --build --wait
docker-compose -f compose.yml -f compose.apps.yml ps
```

Expected containers: `postgres`, `redis`, `auth`, `core`, `gateway` with healthy status.

**Do not use `npm run dev:*` at the same time as containerized Gateway port 3001.** Stop the local Gateway development process first to avoid a host port conflict.

## 6) Smoke checks

Host-side test (run in Git Bash):

```bash
curl --fail http://127.0.0.1:3001/health/live
```

Expected JSON includes `"service":"api-gateway"` and `"status":"alive"`.

Check Docker's internal service-name networking from the Gateway container:

```bash
docker-compose -f compose.yml -f compose.apps.yml exec -T gateway node scripts/smoke-internal.js
```

Expected output:

```text
auth-service: reachable and alive
core-service: reachable and alive
```

Check Docker logs:

```bash
docker-compose -f compose.yml -f compose.apps.yml logs --tail=30 gateway auth core
```

They are Pino JSON logs written to stdout (not to separate log files).

## 7) Normal shutdown (KEEP database volumes)

```bash
docker-compose -f compose.yml -f compose.apps.yml down
```

`down` removes containers/networks but keeps named PostgreSQL and Redis volumes. **Do not run `down -v` on your local development database** unless you intentionally want to delete all of its data. The CI workflow uses `-v` only because the CI environment is disposable.

The existing `shared/start-server.js` listens for SIGTERM/SIGINT and calls `server.close()`. Compose gives 20 seconds before a forced stop. Full request-drain deadlines and actual DB readiness checks still need future implementation and verification.

## 8) Milestone tests and GitHub PR

Keep the 2B unit/integration checks; run them separately (integration requires Docker DB/Redis up and 2B `.env`):

```bash
npm run lint
npm test
npm run test:integration
```

Commit only reviewed 2C files:

```bash
git add .dockerignore compose.apps.yml
 git add apps/api-gateway/Dockerfile apps/auth-service/Dockerfile apps/core-service/Dockerfile
 git add scripts/smoke-internal.js .github/workflows/container-build.yml docs/container-foundation.md
 git diff --cached --stat
 git commit -m "feat(docker): containerize Gateway Auth and Core"
 git push -u origin feat/container-foundation
```

Open PR into `main`. Required evidence: existing Backend CI green **and** new "Backend container build and smoke" workflow green on latest commit. Review and squash-merge; record PR link and merged SHA.

## 9) Common errors

- **Port 3001 is already allocated**: stop any locally running `npm run dev:gateway` process, then retry.
- **Cannot find `package-lock.json`**: ensure 2B `package-lock.json` was committed and is present at backend root. Build context must be repository root (`context: .`).
- **Container reports unhealthy**: `docker-compose -f compose.yml -f compose.apps.yml logs --tail=80 gateway auth core`, then inspect `ps`.
- **Missing passwords**: make sure existing 2B `.env` contains nonempty `POSTGRES_PASSWORD`, `AUTH_DB_PASSWORD`, `CORE_DB_PASSWORD`, `MIGRATOR_DB_PASSWORD`. Never paste them into chat or GitHub.
- **Auth/Core inaccessible from Windows browser**: expected! They have no published host ports. Check them through the Gateway container smoke test.
- **Wrong host/port**: on Windows, PostgreSQL is `127.0.0.1:5433`; *inside containers*, it is `postgres:5432`.

## 10) What 2C proves / what it does not prove

**Proves when local+CI smoke pass:** image builds, Node service startup, Linux container DNS reachability, published Gateway liveness, Docker health checks, stdout logs, and reproducible Docker packaging.

**Does NOT yet prove:** authenticated API routing, DB-backed request readiness, database calls by services, Redis rate limiting, full high availability, frontend BFF connectivity, or a safe application rollout. These come in later milestones.
