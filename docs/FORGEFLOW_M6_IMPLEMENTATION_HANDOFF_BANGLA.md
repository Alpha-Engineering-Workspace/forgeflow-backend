# ForgeFlow — Milestone 6 Implementation Handoff (Bangla)

**Scope:** Projects CRUD + genuine email invitation, acceptance and member-role management. **Code status:** isolated snapshot-based implementation; **not applied to the owner's Windows repositories, not merged, not deployed**.

## 1. Inspection: যেটুকু সত্যিই যাচাই হয়েছে

Uploaded ZIP-এর Git objects দিয়ে separate clean trees inspect করা হয়েছে। Backend `main`: `0b11f19` (`feat(workspaces): ... (#7)`); frontend `main`: `dcb658a` (`feat(ui): ... (#7)`). Frontend `AGENTS.md` পড়া হয়েছে; backend snapshot-এ `AGENTS.md` নেই। Original M5 migrations `001`–`005`, latest `005_create_core_workspaces.js`। Both repositories in the uploaded ZIP contained Git objects, but the raw ZIP extraction itself showed CRLF/untracked-file artifacts. Code was therefore developed **only on clean Git HEAD worktrees**, not in the dirty archive extraction. No Windows `E:/ForgeFlow/...` directory is mounted here, and GitHub remote tip could not be checked through container Git. Confirm current Windows main before applying.

**Two repositories only:** `E:/ForgeFlow/forgeflow-backend` and `E:/ForgeFlow/forgeflow-frontend`. No new microservice, ORM, TypeScript, or third repo.

## 2. Deliverables

- `forgeflow-m6-backend.patch` — backend files/migrations/API/Gateway allowlist/rate limits/Resend adapter/negative tests.
- `forgeflow-m6-frontend.patch` — strict server-only BFF, Projects UI, Members/Invitations UI, acceptance screen, minimal sidebar/workspace page links. Original premium CSS/theme/branding preserved.
- This guide. Both patches were successfully checked/applied to **fresh copies of the uploaded Git HEAD** and have clean `git diff --check`.

**Do not copy either whole ZIP over a live repository.** Patches preserve unrelated files and show exact diffs. They require review against latest remote main.

## 3. Backend file-to-file flow — Project creation

```text
Browser UI: src/features/milestone6/components/projects-page.jsx
  → POST /api/backend/workspaces/:workspaceId/projects
  → Next.js Route Handler: src/app/api/backend/workspaces/[workspaceId]/projects/route.js
  → src/features/milestone6/server/domain-gateway.js
       (Origin + Zod + Auth.js + Redis private token lookup)
  → Gateway apps/api-gateway/src/app.js
       (BFF key, signed RS256 JWT)
  → Gateway clients/core-client.js (explicit allowlist; verified user ID)
  → Core modules/workspaces/workspace.routes.js (internal key)
  → modules/projects/project.controller.js (HTTP + Zod)
  → project.service.js (membership/RBAC, business rules)
  → project.repository.js (parameterized SQL; workspace scope)
  → PostgreSQL core.projects
  ← 201 safe project JSON, returning through all layers
```

**সহজ ভাষায়:** React button শুধু form-এর data পাঠায়। BFF private JWT যোগ করে। Gateway user কে তা signature দিয়ে প্রমাণ করে। Core যাচাই করে এই user Workspace-এর `OWNER`/`ADMIN` কি না। তারপর PostgreSQL-এ Project তৈরি করে। Response উল্টো পথে UI-তে ফিরে আসে। Browser সরাসরি database বা raw backend token ব্যবহার করে না।

Member-এর GET/list permission আছে, কিন্তু create/edit/archive নেই। অন্য workspace-এর project UUID দিলে `404`। `PATCH`/archive-এ `expectedVersion` mismatch হলে `409`; archive করার পরে update বন্ধ। List default 20, max 100.

## 4. Email invitation → member creation

```text
Owner/Admin UI → POST invitation {email,role}
  → BFF Origin/session checks → Gateway JWT + Redis invite limiter
  → Core invitation.service.js → invitation.repository.js
  → PostgreSQL stores SHA-256(token), email, role, 7-day expiry
  → Core-only invitation-mail.js → Resend HTTPS
  → email link: /invite#token=... (fragment absent from HTTP GET)
  → Recipient registers/verifies/logs in via EXISTING M3 Auth flow
  → /invite page: POST one-time token through secured BFF
  → Gateway retrieves fresh verified email via Auth /internal/auth/me
  → Core checks trusted email matches invitation email
  → SELECT ... FOR UPDATE + INSERT workspace_members + mark token used
  → COMMIT; user can now access workspace
```

Core application role cannot query `auth.users`; Auth profile fields are owned by Auth. Browser-supplied email/role cannot impersonate an invitee on acceptance. Token remains hashed in DB; raw token only passes through the email link and accept POST. One workspace cannot accept a token for another email. Concurrent/replayed accept gives a safe rejection. Only `ADMIN`/`MEMBER` may be invited; adding or changing an `OWNER` is disallowed. Role change/removal cancel the target inviter's outstanding pending invites in the same Core transaction.

Resend delivery: provider acceptance records `SENT`, failure records `FAILED`. `202` **does not** prove inbox delivery. Authorized Owner/Admin can manually resend (rotates token) or cancel. No BullMQ automatic recovery is claimed. Rate limits: 12/hour/user/workspace for sending/resending, 30/hour/user for accept attempts; Redis failure returns 503.

## 5. Core endpoints

| Method | Gateway path | Purpose |
|---|---|---|
| GET/POST | `/api/workspaces/:w/projects` | List/create |
| GET/PATCH | `/api/workspaces/:w/projects/:p` | Detail/edit |
| POST | `/api/workspaces/:w/projects/:p/archive` | Archive |
| GET/POST | `/api/workspaces/:w/invitations` | Admin invitation history/create |
| POST | `/api/workspaces/:w/invitations/:i/resend` | Rotate token + send email |
| POST | `/api/workspaces/:w/invitations/:i/cancel` | Cancel pending |
| POST | `/api/workspaces/invitations/accept` | Accept as matching verified user |
| PATCH/DELETE | `/api/workspaces/:w/members/:u` | Edit role/remove, not Owner/self |

Frontend has matching explicit `/api/backend/workspaces/...` Route Handlers; there is **no wildcard BFF**. M5 existing `/api/workspaces/:w/members` GET is retained.

## 6. Mail settings (private only)

In `forgeflow-backend/.env` (ignored, never send secrets here), the existing `RESEND_API_KEY` and verified `AUTH_EMAIL_FROM` can be reused; Core needs the extra local-development variables:

```dotenv
WORKSPACE_INVITE_EMAIL_MODE=resend
WORKSPACE_INVITE_RESEND_API_KEY=YOUR_EXISTING_RESEND_API_KEY
WORKSPACE_INVITE_EMAIL_FROM="ForgeFlow <verify@YOUR_VERIFIED_DOMAIN>"
WORKSPACE_INVITE_BASE_URL=http://localhost:3000
```

For Docker Compose, new Core environment mapping reuses `RESEND_API_KEY`/`AUTH_EMAIL_FROM`; additionally set `WORKSPACE_INVITE_BASE_URL`. For a hosted environment, **use a real HTTPS frontend URL**. Never put the Resend secret in `NEXT_PUBLIC_*`, JSX, Git or logs. If not configured, create invite returns 503 instead of fake success.

## 7. Safe Git Bash application order

First save the patches as:

```text
E:/ForgeFlow/forgeflow-m6-backend.patch
E:/ForgeFlow/forgeflow-m6-frontend.patch
```

**Backend PR first.** In VS Code Git Bash:

```bash
cd /e/ForgeFlow/forgeflow-backend
git status --short --branch
# Stop and preserve your work if there are unexpected changes.
git switch main
git fetch origin
git pull --ff-only origin main
git log -1 --oneline   # Uploaded base was 0b11f19; inspect if different.
git switch -c feat/m6-projects-invitations-api
git apply --check ../forgeflow-m6-backend.patch
git apply ../forgeflow-m6-backend.patch
git diff --check
git diff --stat
```

If current main changed, **do not force-apply or overwrite any file**. Inspect the difference and adapt the patch carefully. The two patch files themselves never apply automatically to the user's computer.

Once the backend changes are reviewed, verified, committed, pushed and its PR passes CI, merge backend first. Then:

```bash
cd /e/ForgeFlow/forgeflow-frontend
git status --short --branch
git switch main
git fetch origin
git pull --ff-only origin main
git log -1 --oneline   # Uploaded base was dcb658a; inspect if different.
git switch -c feat/m6-projects-invitations-ui
git apply --check ../forgeflow-m6-frontend.patch
git apply ../forgeflow-m6-frontend.patch
git diff --check
git diff --stat
```

Do not merge/push anything until checks pass. Keep CI/latest-SHA status and both PR URLs as evidence, not assumptions.

## 8. One bundled verification checkpoint — **pending on actual Windows environment**

With **Node 24**, Docker Desktop, PostgreSQL/Redis and correct ignored `.env` settings:

```bash
# BACKEND /e/ForgeFlow/forgeflow-backend
node scripts/m6-node-smoke.mjs
npm ci
npm run db:migrate
npm run check
npm run test:integration
docker compose -f compose.yml -f compose.apps.yml build gateway core

# FRONTEND /e/ForgeFlow/forgeflow-frontend
npm ci
npm run lint
npm test
npm run build
docker build -t forgeflow-frontend:m6 .
```

**Real browser checks (same bundle):** two verified users and two workspaces → foreign UUID/role denial → Owner creates/edits/archives project → refresh persistence → invite an existing/new verified email → receive actual mail → accept from matching account → replay reject → wrong-email reject → admin role edit/removal with Owner protected → reload → mobile/tablet/desktop responsiveness. Check real Resend delivery and browser history/address bar for token leakage. Verify failed delivery + resend. Recheck DB migrations 006/007 from clean disposable DB, plus upgrade from M5 database. Run latest-SHA GitHub Actions in both PRs. No test, merge, or deployment result should be marked complete until actually observed.

**Why tests couldn't all run here:** This sandbox has Node 22, no Docker/PostgreSQL/Redis services, and its npm offline cache lacks required dependencies (e.g., `zod`). Thus `npm ci`, Vitest, full build and DB integration were **not completed** here. Syntax checks and a dependency-free service smoke were completed; don't equate these with production readiness.

## 9. GitHub PR/CI workflow and limits

Backend branch → code review → `npm run check`, integration/migration, Docker CI → push → PR → latest-commit green CI → squash merge. Frontend branch → BFF/React checks, build/Docker, responsive/browser review → PR → latest-commit CI → squash merge. Record merge SHAs for both. No direct main development; never commit `.env` or reset existing user work.

Current unsupported claims: **No live Windows checkout reviewed; no GitHub PR created, no final CI run inspected, no merges and no deployment.** Member list still displays ID/role instead of Auth-owned trusted profile names/emails. No durable outbox retries, no realtime rooms or worker. More than one OWNER/transfer is intentionally unsupported.

## 10. Final code review warnings / future hardening

- Shared Auth/Core DB coupling still exists; auth identity ownership remains separate.
- Invitation email provider request success is not delivery confirmation. Manual resend handles failures now; future outbox/worker should give durable retries.
- Pending invitations from a demoted/removed inviter are transactionally canceled. Revoked/expired tokens cannot grant access.
- Member lists are capped at 100 from M5. Auth profile enrichment should use an authorized, scoped API; do not add direct Core `auth.users` reads.
- Real mail sender configuration/rate-limit resilience, IDOR tests and two-account browser acceptance are mandatory before merge.
- Realtime access after membership removal must be revalidated when Socket.IO is built in a later milestone.

**Handoff result:** Two inspectable M6 feature patches, not a completed/merged/released Milestone 6. Apply backend first, verify, then frontend; report the actual terminal + CI outcomes together at the single checkpoint.
