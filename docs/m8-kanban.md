# M8 Persisted Kanban — Backend Contract (candidate PR)

Status: **implementation draft; PostgreSQL/CI checks must pass before merge**.
Depends on applied migration `008_create_core_issues`; new migration `009_persisted_kanban` must be run **once**, by the designated migrator, before deploying this Core binary. Migrations do not run on per-replica startup.

## Routes

Gateway public REST path (requires BFF key and verified access token; Core requires internal key and trusted actor):

- `GET /api/workspaces/:workspaceId/projects/:projectId/board` — `{ boardVersion, projectStatus, issues }`; roles OWNER, ADMIN, MEMBER. Issues are ordered by status `TODO`, `IN_PROGRESS`, `IN_REVIEW`, `DONE` and `boardPosition`. Archived projects remain readable.
- `POST /api/workspaces/:workspaceId/projects/:projectId/board/moves` — roles OWNER, ADMIN, MEMBER; archived projects rejected. Strict JSON schema:

```json
{
  "issueId": "a1ccf1aa-2517-42c5-89ed-ad407f9e6e6c",
  "toStatus": "IN_PROGRESS",
  "targetIndex": 0,
  "expectedBoardVersion": 2,
  "expectedIssueVersion": 1
}
```

`targetIndex` is zero-based and measured in the destination lane **after removing the card**. Valid range is `0..destinationLaneLength`. No cross-project movement. Success returns `{ boardVersion, issue }` with the new canonical issue DTO. The client should GET the board after a move or after 409; this API is not realtime.

Errors: `400 VALIDATION_ERROR / INVALID_TARGET_INDEX`, `404 WORKSPACE_NOT_FOUND / PROJECT_NOT_FOUND / ISSUE_NOT_FOUND` (tenant-safe), `409 BOARD_VERSION_CONFLICT / VERSION_CONFLICT / PROJECT_ARCHIVED`. Authentication errors: Gateway/Core `401/403`; do not assume UI hiding actions is sufficient.

## Transactional ordering and rollback

1. Browser requests go through Next BFF → Gateway allowlist/verified JWT → Core routes/controller/Zod → board service/repository → PostgreSQL.
2. Core `BEGIN` on **one** pg client; lock `core.projects` (`FOR UPDATE OF p`) and membership (`FOR SHARE OF m`). Compare board and issue versions under lock.
3. Build destination/source lane order from DB (not browser-submitted array). Reject invalid index. Update issue status and issue version; renumber only affected lanes using parameterized `UNNEST(UUID[]) WITH ORDINALITY`; bump project `board_version` once; return canonical issue.
4. Commit or rollback. No partial status/position writes on 400/404/409/SQL failures. Parallel moves on the same project serialize on the project row lock.
5. Existing M7 create/edit/delete API **shares the same project lock** and normalizes nondeleted lane positions after changes, bumping board_version. Direct M7 status PATCH appends the card to the new lane rather than silently corrupting ordering. Member removal also locks affected workspace project parents before clearing assignments and bumps affected board versions.
6. GET reads project version and issue rows from a single repeatable-read snapshot; no mixed-version board response.

## DB migration

`009` adds a separate `core.projects.board_version` (not conflated with project metadata `version`); backfills `core.issues.board_position` with stable `(created_at, id)` order within project/status; adds partial ordered lookup index. Existing soft-deleted rows are excluded; existing issue versions are unchanged. BIGINT `boardPosition` may serialize to a **string** in Node pg. Migration down intentionally drops board version and clears position data; do not downgrade casually after real board use.

## Limitations and follow-up

- MVP board GET loads a whole project's non-deleted issues; add bounded windowing/virtualization before very large boards. `normalizePositions` is O(project issues) for M7 write compatibility; spaced-order optimization is future work.
- No WebSocket live sync yet: refetch on explicit move, reload, tab focus and 409 on the frontend.
- No DB-level uniqueness constraint on active positions yet (concurrent app API writers serialized, but privileged direct SQL could violate ordering). Lock-compatible unique enforcement needs a separate tested migration.
- Explicit BFF route handlers, accessible DnD, touch/keyboard fallback and front-end version/refetch behavior are the **next frontend PR**, not included in this backend patch.

## Required verification prior to any PR merge

```bash
# In E:/ForgeFlow/forgeflow-backend on Node 24, isolated test DB only:
npm ci
npm run lint
npm test
# Start disposable PostgreSQL+Redis using this repo's Compose setup and appropriate local test env.
npm run db:migrate
npm run db:migrate       # safe replay
npm run test:integration
# Run backend Docker build/CI and check latest PR SHA.
git diff --check
```

Additional manual: two real browser sessions, cross-tenant 404, member direct-API delete 403, archived 409, stale issue/status PATCH 409; failed mutation must not change order. Do **not** apply migrations to an unknown production DB.
