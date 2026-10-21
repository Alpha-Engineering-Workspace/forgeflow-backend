const issueColumns = `i.id, i.workspace_id AS "workspaceId", i.project_id AS "projectId",
  i.title, i.description, i.type, i.status, i.priority,
  i.assignee_user_id AS "assigneeId", i.created_by AS "createdBy",
  i.board_position AS "boardPosition", i.version,
  i.created_at AS "createdAt", i.updated_at AS "updatedAt"`;

export function createBoardRepository(pool) {
  return {
    async snapshot(workspaceId, projectId, actorId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const project = await this.projectForRead(workspaceId, projectId, actorId, client);
        const issues = project ? await this.issues(workspaceId, projectId, actorId, client) : [];
        await client.query('COMMIT');
        return { project, issues };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    },
    async projectForRead(workspaceId, projectId, actorId, client = pool) {
      const { rows } = await client.query(`
        SELECT p.status, p.board_version AS "boardVersion"
        FROM core.projects p
        WHERE p.workspace_id=$1 AND p.id=$2 AND EXISTS (
          SELECT 1 FROM core.workspace_members m WHERE m.workspace_id=p.workspace_id AND m.user_id=$3
        )
      `, [workspaceId, projectId, actorId]);
      return rows[0] ?? null;
    },
    async issues(workspaceId, projectId, actorId, client = pool) {
      const { rows } = await client.query(`
        SELECT ${issueColumns} FROM core.issues i
        WHERE i.workspace_id=$1 AND i.project_id=$2 AND i.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM core.workspace_members m
            WHERE m.workspace_id=i.workspace_id AND m.user_id=$3)
        ORDER BY CASE i.status
          WHEN 'TODO' THEN 0 WHEN 'IN_PROGRESS' THEN 1
          WHEN 'IN_REVIEW' THEN 2 ELSE 3 END,
          i.board_position ASC NULLS LAST, i.created_at ASC, i.id ASC
      `, [workspaceId, projectId, actorId]);
      return rows;
    },
    async moveIssue(client, workspaceId, projectId, issueId, toStatus, expectedVersion) {
      const { rows } = await client.query(`
        UPDATE core.issues SET status=$4, board_position=NULL,
          version=version+1, updated_at=NOW()
        WHERE workspace_id=$1 AND project_id=$2 AND id=$3
          AND version=$5 AND deleted_at IS NULL
        RETURNING id
      `, [workspaceId, projectId, issueId, toStatus, expectedVersion]);
      return rows.length === 1;
    },
    async reorderLane(client, workspaceId, projectId, status, ids) {
      if (!ids.length) return;
      const { rowCount } = await client.query(`
        UPDATE core.issues i SET board_position=ordered.position
        FROM (
          SELECT id, (ordinality-1)::BIGINT AS position
          FROM UNNEST($4::UUID[]) WITH ORDINALITY AS sequence(id, ordinality)
        ) ordered
        WHERE i.id=ordered.id AND i.workspace_id=$1 AND i.project_id=$2
          AND i.status=$3 AND i.deleted_at IS NULL
          AND i.board_position IS DISTINCT FROM ordered.position
      `, [workspaceId, projectId, status, ids]);
      // Membership/project and row identity are validated by the board service.
      return rowCount;
    },
  };
}
