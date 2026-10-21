# ForgeFlow M7 — Issues API (backend slice)

This document accompanies a **backend-only feature patch**, not a claim that the feature has been merged, tested against your Windows database, or deployed.

## Scope

- `008_create_core_issues.js` adds `core.issues`: one issue belongs to one `(workspace_id, project_id)`, with a composite project FK. Statuses: `TODO`, `IN_PROGRESS`, `IN_REVIEW`, `DONE`. Types: `TASK`, `BUG`, `FEATURE`. Priorities: `LOW`, `MEDIUM`, `HIGH`, `URGENT`.
- Optional assignee must have a membership in the same Workspace; a composite FK enforces this even if someone calls SQL directly. PostgreSQL 17 supports column-list `ON DELETE SET NULL (assignee_user_id)`. Removing a member clears assignment and increases issue version transactionally.
- `board_position` remains nullable; persistent ordering belongs to M8. No fake Kanban, activity/outbox, or realtime claim in M7.
- Issue writes in an archived Project return `409 PROJECT_ARCHIVED`. `expectedVersion` protects updates and deletions; stale edits get `409 VERSION_CONFLICT`.
- All members of a Project's Workspace may list/create/edit issues. Only OWNER/ADMIN may soft-delete. Project creation/edit/archive permissions from M6 stay unchanged.

## API mapping

Gateway paths `/api/workspaces/:workspaceId/projects/:projectId/issues...`
map to private Core `/internal/workspaces/:workspaceId/projects/:projectId/issues...`.

| Method | URL suffix | Payload / result |
| --- | --- | --- |
| GET | `/issues?page=1&limit=20&status=TODO&priority=HIGH&type=TASK&assigneeId=<UUID>&q=text` | `{issues,pagination}`; filters optional; 20 default/100 max |
| POST | `/issues` | `{title,description?,type?,status?,priority?,assigneeId?}` → `201 {issue}` |
| GET | `/issues/:issueId` | `200 {issue}` |
| PATCH | `/issues/:issueId` | `{expectedVersion,...changedFields}` → `200 {issue}` |
| DELETE | `/issues/:issueId` | `{expectedVersion}` → `204` (soft delete) |

Errors include `400 VALIDATION_ERROR`, `400 INVALID_ASSIGNEE`, `401 UNAUTHORIZED`, `403 ROLE_FORBIDDEN`, `404 WORKSPACE_NOT_FOUND`, `404 PROJECT_NOT_FOUND`, `404 ISSUE_NOT_FOUND`, `409 PROJECT_ARCHIVED`, `409 VERSION_CONFLICT`.

## File-to-file request flow (সহজ বাংলা)

`Browser → Next.js private BFF (M7 frontend pending) → Gateway app.js (JWT verify) → clients/core-client.js (explicit route/method and safe query allowlist) → Core workspace.routes.js (internal key and verified userId) → project.routes.js → issue.routes.js → issue.controller.js (Zod) → issue.service.js (Workspace/Project RBAC, version/rules, transaction) → issue.repository.js (parameterized SQL) → PostgreSQL`.

`workspaceId`, `projectId` ও `issueId`—তিনটি একসঙ্গে check হয়। কেবল UUID জানলেই অন্য Workspace-এর Issue দেখা যায় না। `Core`-এর বাইরে JWT দিয়ে Domain permission নির্ধারণ করা হয় না। Browser backend tokens পায় না।

## Migration and roll-forward rules

- `npm run db:migrate` only on intended development database after confirming M6 `006/007` already applied; old migrations remain untouched.
- CI: disposable PostgreSQL 17/Redis, empty-schema migration test, unit/integration tests, Docker Gateway/Core build.
- Separate backend `feat/m7-issues-api` branch/PR, then frontend `feat/m7-issues-ui` once backend is merged.
- Migration ownership is one CLI/job, never per replica.
- M7 backend does **not** add issue activity/outbox records; that remains a consistency and audit feature for a later migration. API users should not infer real-time updates.

## Explicitly pending

Real local test output, GitHub latest-SHA CI, frontend pages/BFF integration, mobile UX, main merge SHA and deployment evidence. Recorded M6 baseline in this archive is reconstructed from the uploaded M5 snapshot plus M6 backend patch; **it is not a live checkout of your actual current `main`**.
