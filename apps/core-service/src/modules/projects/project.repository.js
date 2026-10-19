const columns = `p.id, p.workspace_id AS "workspaceId", p.name, p.description, p.status,
  p.version, p.created_by AS "createdBy", p.created_at AS "createdAt",
  p.updated_at AS "updatedAt", p.archived_at AS "archivedAt"`;

export function createProjectRepository(pool) {
  return {
    async create(workspaceId, actorId, { name, description }) {
      const { rows } = await pool.query(`
        INSERT INTO core.projects(workspace_id, created_by, name, description)
        SELECT $1, $2, $3, $4 WHERE EXISTS (
          SELECT 1 FROM core.workspace_members
          WHERE workspace_id=$1 AND user_id=$2 AND role IN ('OWNER','ADMIN')
        ) RETURNING id
      `, [workspaceId, actorId, name, description]);
      return rows[0] ? this.get(workspaceId, actorId, rows[0].id) : null;
    },
    async list(workspaceId, actorId, { page, limit, status }) {
      const offset = (page - 1) * limit;
      const { rows } = await pool.query(`
        SELECT ${columns} FROM core.projects p
        WHERE p.workspace_id=$1 AND p.status=$3 AND EXISTS (
          SELECT 1 FROM core.workspace_members m
          WHERE m.workspace_id=p.workspace_id AND m.user_id=$2
        ) ORDER BY p.created_at DESC, p.id DESC LIMIT $4 OFFSET $5
      `, [workspaceId, actorId, status, limit, offset]);
      const count = await pool.query(`
        SELECT COUNT(*)::int AS total FROM core.projects p
        WHERE p.workspace_id=$1 AND p.status=$3 AND EXISTS (
          SELECT 1 FROM core.workspace_members m WHERE m.workspace_id=p.workspace_id AND m.user_id=$2
        )
      `, [workspaceId, actorId, status]);
      return { projects: rows, pagination: { page, limit, total: count.rows[0].total } };
    },
    async get(workspaceId, actorId, id) {
      const { rows } = await pool.query(`
        SELECT ${columns} FROM core.projects p
        WHERE p.workspace_id=$1 AND p.id=$3 AND EXISTS (
          SELECT 1 FROM core.workspace_members m WHERE m.workspace_id=p.workspace_id AND m.user_id=$2
        )
      `, [workspaceId, actorId, id]);
      return rows[0] ?? null;
    },
    async update(workspaceId, actorId, id, input) {
      const { rows } = await pool.query(`
        UPDATE core.projects p SET name=$4, description=$5, version=version+1, updated_at=NOW()
        WHERE p.workspace_id=$1 AND p.id=$3 AND p.status='ACTIVE' AND p.version=$6
          AND EXISTS (SELECT 1 FROM core.workspace_members m
            WHERE m.workspace_id=p.workspace_id AND m.user_id=$2 AND m.role IN ('OWNER','ADMIN'))
        RETURNING ${columns}
      `, [workspaceId, actorId, id, input.name, input.description, input.expectedVersion]);
      return rows[0] ?? null;
    },
    async archive(workspaceId, actorId, id, expectedVersion) {
      const { rows } = await pool.query(`
        UPDATE core.projects p SET status='ARCHIVED', archived_at=NOW(), version=version+1, updated_at=NOW()
        WHERE p.workspace_id=$1 AND p.id=$3 AND p.status='ACTIVE' AND p.version=$4
          AND EXISTS (SELECT 1 FROM core.workspace_members m
            WHERE m.workspace_id=p.workspace_id AND m.user_id=$2 AND m.role IN ('OWNER','ADMIN'))
        RETURNING ${columns}
      `, [workspaceId, actorId, id, expectedVersion]);
      return rows[0] ?? null;
    },
  };
}
