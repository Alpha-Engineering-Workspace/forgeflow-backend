# ForgeFlow API — current contract (Milestone 2B)

Each service currently implements only:

- `GET /health/live`: 200 + `{ "service": "...", "status": "alive" }`
- `GET /health/ready`: 200 + process-only readiness (NOT a database/Redis health check)

The Gateway does not yet proxy Auth/Core. No auth, workspace, project, or CRUD endpoints exist. Real dependency-aware readiness and API routing arrive later; do not treat the process-only readiness endpoint as production readiness.
