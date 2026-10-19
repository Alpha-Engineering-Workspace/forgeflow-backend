// All SQL is parameterized. The service is responsible for transactions.
export function createWorkspaceRepository(pool) {
  return {
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async create(client, userId, name) {
      const result = await client.query(`
        INSERT INTO core.workspaces(name, created_by) VALUES($1, $2)
        RETURNING id, name, created_at AS "createdAt", updated_at AS "updatedAt"
      `, [name, userId]);
      return result.rows[0];
    },
    async createOwner(client, workspaceId, userId) {
      await client.query(`
        INSERT INTO core.workspace_members(workspace_id, user_id, role) VALUES($1, $2, 'OWNER')
      `, [workspaceId, userId]);
    },
    async list(userId, limit, offset) {
      const result = await pool.query(`
        SELECT w.id, w.name, w.created_at AS "createdAt", w.updated_at AS "updatedAt", m.role
        FROM core.workspaces w
        JOIN core.workspace_members m ON m.workspace_id = w.id
        WHERE m.user_id = $1
        ORDER BY w.created_at DESC, w.id DESC
        LIMIT $2 OFFSET $3
      `, [userId, limit, offset]);
      const count = await pool.query(`
        SELECT COUNT(*)::int AS total FROM core.workspace_members WHERE user_id = $1
      `, [userId]);
      return { workspaces: result.rows, total: count.rows[0].total };
    },
    async getMember(workspaceId, userId) {
      const result = await pool.query(`
        SELECT w.id, w.name, w.created_at AS "createdAt", w.updated_at AS "updatedAt", m.role
        FROM core.workspaces w
        JOIN core.workspace_members m ON m.workspace_id = w.id
        WHERE w.id = $1 AND m.user_id = $2
      `, [workspaceId, userId]);
      return result.rows[0] ?? null;
    },
    async rename(workspaceId, userId, name) {
      const result = await pool.query(`
        UPDATE core.workspaces w SET name = $3, updated_at = NOW()
        WHERE w.id = $1 AND EXISTS (
          SELECT 1 FROM core.workspace_members m
          WHERE m.workspace_id = w.id AND m.user_id = $2 AND m.role IN ('OWNER', 'ADMIN')
        )
        RETURNING id, name, created_at AS "createdAt", updated_at AS "updatedAt"
      `, [workspaceId, userId, name]);
      return result.rows[0];
    },
    async members(workspaceId) {
      // Core must not SELECT Auth-owned profile data. Return IDs/roles only.
      const result = await pool.query(`
        SELECT user_id AS "userId", role, created_at AS "joinedAt"
        FROM core.workspace_members WHERE workspace_id = $1
        ORDER BY CASE role WHEN 'OWNER' THEN 0 WHEN 'ADMIN' THEN 1 ELSE 2 END, created_at
        LIMIT 100
      `, [workspaceId]);
      return result.rows;
    },
  };
}
