const columns = `i.id, i.workspace_id AS "workspaceId", i.project_id AS "projectId",
  i.title, i.description, i.type, i.status, i.priority,
  i.assignee_user_id AS "assigneeId", i.created_by AS "createdBy",
  i.version, i.created_at AS "createdAt", i.updated_at AS "updatedAt"`;

const editingFields = {
  title: 'title', description: 'description', type: 'type',
  status: 'status', priority: 'priority', assigneeId: 'assignee_user_id',
};

export function createIssueRepository(pool) {
  return {
    async transaction(task) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await task(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    },
    async projectForWrite(client, workspaceId, projectId, actorId) {
      const { rows } = await client.query(`
        SELECT p.status FROM core.projects p
        JOIN core.workspace_members m ON m.workspace_id=p.workspace_id AND m.user_id=$3
        WHERE p.workspace_id=$1 AND p.id=$2
        FOR SHARE OF p, m
      `, [workspaceId, projectId, actorId]);
      return rows[0] ?? null;
    },
    async assigneeExists(client, workspaceId, assigneeId) {
      const { rowCount } = await client.query(`
        SELECT 1 FROM core.workspace_members
        WHERE workspace_id=$1 AND user_id=$2 FOR SHARE
      `, [workspaceId, assigneeId]);
      return rowCount > 0;
    },
    async create(client, workspaceId, projectId, actorId, input) {
      const { rows } = await client.query(`
        INSERT INTO core.issues
          (workspace_id,project_id,created_by,title,description,type,status,priority,assignee_user_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id
      `, [workspaceId, projectId, actorId, input.title, input.description,
        input.type, input.status, input.priority, input.assigneeId]);
      return this.get(workspaceId, projectId, actorId, rows[0].id, client);
    },
    async get(workspaceId, projectId, actorId, id, client = pool) {
      const { rows } = await client.query(`
        SELECT ${columns} FROM core.issues i
        WHERE i.workspace_id=$1 AND i.project_id=$2 AND i.id=$4 AND i.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM core.workspace_members m
            WHERE m.workspace_id=i.workspace_id AND m.user_id=$3)
      `, [workspaceId, projectId, actorId, id]);
      return rows[0] ?? null;
    },
    async list(workspaceId, projectId, actorId, options) {
      const filters = [
        'i.workspace_id=$1', 'i.project_id=$2', 'i.deleted_at IS NULL',
        'EXISTS (SELECT 1 FROM core.workspace_members m WHERE m.workspace_id=i.workspace_id AND m.user_id=$3)',
      ];
      const values = [workspaceId, projectId, actorId];
      for (const [key, column] of [['status','status'], ['priority','priority'], ['type','type'], ['assigneeId','assignee_user_id']]) {
        if (options[key] !== undefined) {
          values.push(options[key]); filters.push(`i.${column}=$${values.length}`);
        }
      }
      if (options.q !== undefined) {
        // Literal substring search: escape PostgreSQL LIKE wildcards in user input.
        const escaped = options.q.replace(/[\\%_]/g, '\\$&');
        values.push(`%${escaped}%`);
        filters.push(`(i.title ILIKE $${values.length} ESCAPE '\\' OR i.description ILIKE $${values.length} ESCAPE '\\')`);
      }
      const where = filters.join(' AND ');
      const count = await pool.query(`SELECT COUNT(*)::int AS total FROM core.issues i WHERE ${where}`, values);
      const pageParams = [...values, options.limit, (options.page - 1) * options.limit];
      const { rows } = await pool.query(`
        SELECT ${columns} FROM core.issues i WHERE ${where}
        ORDER BY i.created_at DESC, i.id DESC LIMIT $${pageParams.length-1} OFFSET $${pageParams.length}
      `, pageParams);
      return { issues: rows, pagination: { page: options.page, limit: options.limit, total: count.rows[0].total } };
    },
    async update(client, workspaceId, projectId, actorId, id, input) {
      const updates = []; const values = [workspaceId, projectId, actorId, id, input.expectedVersion];
      for (const [key, column] of Object.entries(editingFields)) {
        if (Object.hasOwn(input, key)) { values.push(input[key]); updates.push(`${column}=$${values.length}`); }
      }
      const { rows } = await client.query(`
        UPDATE core.issues i SET ${updates.join(', ')}, version=version+1, updated_at=NOW()
        WHERE i.workspace_id=$1 AND i.project_id=$2 AND i.id=$4 AND i.version=$5
          AND i.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM core.workspace_members m
            WHERE m.workspace_id=i.workspace_id AND m.user_id=$3)
        RETURNING id
      `, values);
      return rows[0] ? this.get(workspaceId, projectId, actorId, rows[0].id, client) : null;
    },
    async remove(client, workspaceId, projectId, actorId, id, expectedVersion) {
      const { rows } = await client.query(`
        UPDATE core.issues i SET deleted_at=NOW(), version=version+1, updated_at=NOW()
        WHERE i.workspace_id=$1 AND i.project_id=$2 AND i.id=$4
          AND i.version=$5 AND i.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM core.workspace_members m
            WHERE m.workspace_id=i.workspace_id AND m.user_id=$3 AND m.role IN ('OWNER','ADMIN'))
        RETURNING id
      `, [workspaceId, projectId, actorId, id, expectedVersion]);
      return rows.length > 0;
    },
  };
}
