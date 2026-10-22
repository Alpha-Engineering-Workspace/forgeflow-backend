# M9 — Workspace summary API (Backend-first)

- `GET /api/workspaces/:workspaceId/summary` via BFF → Gateway allowlist → internal Core route.
- Authenticated tenant membership is verified **before** statistics queries.
- Count queries are fixed-number, parameterized by `workspace_id`; no per-project N+1 loops and no new migration.
- Projects total includes archived, active is active only. Issues count non-deleted issues across active and archived projects; open = TODO + IN_PROGRESS + IN_REVIEW.
- `createdDaily` is last **14 UTC dates** of issue creation, not completion throughput. Dates with zero values are filled in frontend; unavailable data is not invented.
- No caching of permission results. UI BFF validates response schema and strips undeclared fields.
- Tests: membership denied, SQL tenant separation, category consistency, zero totals, Gateway method allowlist.
- Release: backend first; no downtime schema change. Frontend depends on this endpoint and must deploy only after its backend is live.
