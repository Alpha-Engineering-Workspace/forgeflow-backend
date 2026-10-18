# ForgeFlow — Milestone 3 backend integration handoff

**Scope:** Backend authentication implementation bundle, designed from the owner's `forgeflow-backend.zip` (branch `feat/auth-api`). **Not a verified merge/deployment.** Frontend Auth.js/BFF/UI remains separate work.

## 1. What was inspected and deliberately retained

- `migrations/001_create_service_schemas.js`, `002_create_auth_users.js`, existing Auth/Core DB pools, Gateway/Auth/Core health skeleton, Dockerfiles, Compose, and existing integration tests.
- Existing `auth.users` and 3A tests are **not duplicated or overwritten**.
- `shared/http.js` mounted the fallback 404 before feature routes. This bundle adds a `mountRoutes` callback before 404, retaining existing health behavior.
- Existing rate limits and auth endpoints were not implemented in the uploaded archive. All changes in this bundle are proposed new work until locally tested and merged.

## 2. New files and request call chain

Browser -> Next.js server BFF (future implementation; `GATEWAY_BFF_KEY` secret) -> Gateway `POST /api/auth/register|login|refresh|logout|password/*` or `GET /api/auth/me` -> `apps/api-gateway/src/app.js` -> `middleware/auth-limits.js` (login/reset only) -> `clients/auth-client.js` -> private Auth HTTP `/internal/auth/*` with `AUTH_INTERNAL_KEY` -> `apps/auth-service/src/app.js` -> `modules/auth/auth.routes.js` -> `auth.controller.js` -> `auth.service.js` -> `auth.repository.js` -> `auth.users`, `auth.refresh_sessions`, `auth.password_resets`.

- Auth.js and all backend tokens must live in **server-only** frontend state; never expose tokens through browser `session`, `localStorage`, `NEXT_PUBLIC_*`, cookies readable by JavaScript, or logs.
- Gateway verifies RS256 signature/issuer/audience/expiry on `/me`; Auth independently verifies tokens again.
- Auth service is reachable through Docker private network or local process, not a public port. Internal key is required even when accessed privately.
- Gateway requires `GATEWAY_BFF_KEY` for all `/api/auth/*`. Existing `/health/*` endpoints remain unaffected.
- Passwords: bcrypt cost 12. Passwords 12..72 UTF-8 bytes. Emails lowercased by API and uniqueness enforced in DB. No password hash in API responses.
- Refresh tokens: opaque random values, only SHA256 hashes in PostgreSQL. Rotated atomically under `FOR UPDATE`. Replay revokes the token family. Logout revokes the family. **BFF must coordinate concurrent refresh operations**, particularly across Next.js instances.
- Password resets: opaque, hash-only tokens, 15-minute expiry, single-use. Successful reset revokes the user's sessions. Password reset delivery is intentionally **development/test file-based**; production email integration is NOT included.
- Redis limits at Gateway: 30 requests/15min/IP and 5/15min/IP+email for login; 20 requests/hour/IP and 3/hour/IP+email (forgot), or IP+token (reset). 429 + Retry-After. When limiter is unavailable, guarded routes return 503.
- Gateway ignores unverified `X-Forwarded-For`; it accepts optional `x-forgeflow-client-ip` only *after* validating the BFF secret. The BFF must derive IP from verified ingress metadata, not raw browser headers. Credentials protect Gateway routes; do not make the secret public.

## 3. Required env (add to existing ignored backend `.env`)

Run `node scripts/generate-auth-env.js` ONCE. It writes `.env.auth.generated` with 4 fresh values, without printing secret values to the terminal. Open that file locally, and **copy the four values into your existing `.env`** while preserving existing DB passwords. Do not commit `.env` or `.env.auth.generated`.

```dotenv
# Example only — VALUES BELOW MUST BE REPLACED with generated ones:
AUTH_JWT_PUBLIC_KEY_B64=<generated-public-key-base64>
AUTH_JWT_PRIVATE_KEY_B64=<generated-private-key-base64>
AUTH_INTERNAL_KEY=<generated-random-value>
GATEWAY_BFF_KEY=<generated-random-value>
AUTH_SERVICE_URL=http://127.0.0.1:3002
REDIS_URL=redis://127.0.0.1:6380
AUTH_RESET_OUTBOX_FILE=.env.reset-outbox.jsonl
```

Do not set `AUTH_JWT_PRIVATE_KEY_B64` for Gateway deployment. Only Auth gets it. Auth JWT keys are independent from NextAuth `AUTH_SECRET`.

**Docker Compose:** `compose.apps.yml` now passes gateway/Auth secrets and private service URLs. With `NODE_ENV=production`, the **local file reset mail transport refuses delivery**; do not claim password recovery works in Docker/production until an approved provider transport exists. To exercise recovery in Milestone 3 use locally started Auth service in development mode, as described below. Docker build will need an updated root `package-lock.json` after npm install.

## 4. Local Windows Git Bash application — preserve existing work

1. In `E:/ForgeFlow/forgeflow-backend`, run `git status --short --branch`. Confirm your branch is `feat/auth-api` (create the branch from `main` ONLY if no branch exists). The untracked `docs/Milestone-2-Complete.md`, 002 migration and 3A tests are user work; preserve them.
2. Unpack the delivery ZIP to **a separate staging folder**, not directly on top of your repo. Review the list and compare any overlapping files (`shared/http.js`, service `app.js`, `server.js`, `compose.apps.yml`, `apps/auth-service/package.json`). Copy only the listed changes to the corresponding paths inside `E:/ForgeFlow/forgeflow-backend`. The optional `.patch` is for `git apply --check` and `git apply` when your checkout matches the uploaded archive; apply **either** the patch **or** the ZIP overlay, not both.
3. Dependencies cannot be installed/locked in the sandbox because outbound npm network access is unavailable. In your local backend repo run:

```bash
npm install bcrypt@^6.0.0 --workspace=@forgeflow/auth-service
node scripts/generate-auth-env.js
```

   `npm install` updates the **root `package-lock.json`**. Review and commit lockfile changes; Docker/CI use `npm ci`. If `.env.auth.generated` already exists, generator intentionally refuses to overwrite it.
4. Append the four generated values and the `AUTH_SERVICE_URL`, `REDIS_URL`, `AUTH_RESET_OUTBOX_FILE` values to your existing ignored `.env` (never paste secrets into chat). Ensure Node.js 24 is selected per `.nvmrc`.
5. Start Docker Desktop, then Git Bash from the backend repo:

```bash
docker-compose -f compose.yml up -d postgres redis
npm run db:migrate
npm run check
npm run test:integration
```

   The migration adds **003**, not another 002. Existing 3A integration tests should still pass. New integration `auth-flow.test.js` needs a running DB and bcrypt installed.
6. For a development-only end-to-end backend flow (local PostgreSQL/Redis in Docker), use separate terminals:

```bash
npm run dev:auth
npm run dev:gateway
```

   The Gateway exposes `127.0.0.1:3001`; Auth should stay local/private. BFF hasn't been built yet, so test through **server-only** test utilities or curl in a trusted localhost development environment with the required header. Do not paste access/refresh tokens or internal keys into chat, logs, or screenshots.
7. Check `git diff --check`, `git diff`, `git status --short`, include focused changes plus `package-lock.json`, commit on feature branch, push, create PR, verify all required CI jobs on latest SHA, self-review, squash-merge, and pull `main`. Do **not** commit generated local secrets or the Milestone-2 document unless deliberately intended.

## 5. API contract (intended for SERVER-SIDE BFF ONLY)

All routes below require `x-forgeflow-bff-key` from the server-side BFF; Gateway forwards through private internal Auth route with its own key.

| Gateway HTTP | Request JSON | Success | Failure examples |
| --- | --- | --- | --- |
| `POST /api/auth/register` | `{name,email,password}` | `201 {user:{id,name,email,created_at,updated_at}}` | 400 invalid, 409 duplicate |
| `POST /api/auth/login` | `{email,password}` | `200 {user,accessToken,refreshToken,expiresIn,tokenType}` | 401 invalid, 429 limited |
| `POST /api/auth/refresh` | `{refreshToken}` | `200 {accessToken,refreshToken,expiresIn,tokenType}` | 401 expired/replayed |
| `POST /api/auth/logout` | `{refreshToken}` | `204` | 400 invalid body |
| `GET /api/auth/me` | Bearer access token | `200 {user}` | 401 invalid/expired |
| `POST /api/auth/password/forgot` | `{email}` | `202` generic response | 429 limited |
| `POST /api/auth/password/reset` | `{token,password}` | `204` | 400 expired/used, 429 limited |

**Never pass these token fields into a browser-visible session response.** BFF should use same-site, HttpOnly, Secure cookies and origin/CSRF protections for mutations; Auth.js encrypted session handling with server-only token persistence needs separate verification. On 401 due to access expiry, serialize refresh once and retry original request **once**, never automatically replay ambiguous non-idempotent writes without defined behavior.

## 6. Verification and release limitations

- Bundle source inspected, syntax checked, ESLint checked using extracted repo dependencies, and lightweight JWT/route/proxy smoke tests passed in sandbox.
- Full Vitest/unit and PostgreSQL integration tests **NOT** executed here: ZIP held Windows `node_modules` and lacked the Linux Rollup binary, npm registry was unreachable, and sandbox Node version was 22 (repo targets 24).
- No real PostgreSQL/Redis container or GitHub CI access was available in this sandbox.
- Production reset email, frontend Auth.js cookie/session/CSRF implementation, production rollout, CI/PR verification and coordinated multi-instance BFF refresh remain pending.
- Process-only `/health/ready` has NOT become database-aware readiness; retain its label and don't advertise production readiness.
- Add BFF integration, frontend tests and route security before marking Milestone 3 complete.
