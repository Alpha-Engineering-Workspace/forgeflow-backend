# ForgeFlow Milestone 5 — Backend Workspace API & Tenant RBAC

## Source boundaries and why two PRs

Backend `E:/ForgeFlow/forgeflow-backend` is a separate Git repository from frontend. Milestone 5 changes Gateway, Core and one **new** Core-owned migration. Existing Auth Service JWT issuance and refresh rules are preserved. Implement/verify the backend contract first; only then apply frontend PR.

### Authenticated create flow

Browser → Next.js authenticated BFF → Gateway `POST /api/workspaces` → verify RS256 JWT signature/iss/aud/exp → discard any caller-supplied user-ID header → Gateway forwards verified `sub` and *private* `CORE_INTERNAL_KEY` → Core route/controller → Workspace Service → `repository.transaction` → PostgreSQL (`core.workspaces`, `core.workspace_members`), same checked-out `pg` client → commit once → 201 with real UUID. Failure inserting Owner membership rolls both writes back.

- Core receives only `x-forgeflow-user-id` from a Gateway that has verified JWT and an internal secret; Core is private.
- Workspace access is checked on the Core server. Foreign ID → 404; authenticated `MEMBER` attempting rename → 403; Owner/Admin → rename allowed.
- Membership records are tenant scoped; workspace list is joined on `(workspace_id, user_id)` membership. Frontend never supplies trusted roles.
- One PostgreSQL database holds Auth/Core-owned tables with restricted credentials. Core does not SELECT `auth.users` columns; migrations reference `auth.users(id)` by FK. This couples the services at the schema level.
- Membership CRUD/invitations are deliberately deferred. To exercise Member/Admin role checks, add second workspace membership ONLY in a controlled integration test fixture, never by forging HTTP headers or bypassing role checks.

### Endpoints and response contracts

| Method | Gateway | Success | Owner/Admin/Member rule |
|---|---|---|---|
| POST | `/api/workspaces` | `201 {workspace:{id,name,role,...}}` | signed-in verified user creates workspace, becomes Owner |
| GET | `/api/workspaces?page=1&limit=20` | `200 {workspaces,pagination}` | only own memberships |
| GET | `/api/workspaces/:id` | `200 {workspace}` | member of that workspace |
| PATCH | `/api/workspaces/:id` | `200 {workspace}` | Owner/Admin only |
| GET | `/api/workspaces/:id/members` | `200 {members:[{userId,role,...}]}` | member of that workspace; no Auth profiles |

Default list size 20, maximum 100. User-submitted IDs are not authorization. One OWNER per workspace enforced by partial unique index, membership is unique by composite PK. There is no arbitrary wildcard proxy.

## New configuration for local Node development

In existing **ignored** backend `.env`, add:

```dotenv
CORE_SERVICE_URL=http://127.0.0.1:3003
CORE_INTERNAL_KEY=<new independent securely random 32+ character secret>
```

Compose apps uses `http://core:3003` and injects the **same** private secret into Gateway and Core. Do not put this key in frontend `.env.local`, `NEXT_PUBLIC_*`, screenshots or Git. Existing `AUTH_INTERNAL_KEY`, `GATEWAY_BFF_KEY`, JWT/DB secrets remain unchanged.

### Delivery verification (run on your Windows Git Bash after applying patch)

1. Check `git status`, start backend branch from updated `main` (`feat/workspaces-mvp`) only when working tree is clean. Apply backend patch with `git apply --check` then `git apply`.
2. Set `CORE_SERVICE_URL`, `CORE_INTERNAL_KEY` in ignored backend `.env`. Do **not** edit an applied migration. Start Docker Desktop and `docker compose up -d postgres redis`.
3. `npm run db:migrate` (one migration owner only). Before migration, on CI run on disposable DB; don't run migrations on every API replica.
4. `npm run check && npm run test:integration && docker build -f apps/core-service/Dockerfile -t forgeflow-core:m5 . && docker build -f apps/api-gateway/Dockerfile -t forgeflow-gateway:m5 .`
5. Run `npm run dev:core`, `npm run dev:auth`, `npm run dev:gateway` in separate terminals, or Compose `-f compose.yml -f compose.apps.yml up -d --build`. Avoid port conflicts between local processes and Compose apps.
6. Record actual unit/integration/CI results, review staged diff, commit, push PR to `main`; merge after passing latest-SHA checks.

**Not yet verified here:** Live Windows Git, PostgreSQL migration and Docker/CI. Do not claim them passed from this patch alone.
