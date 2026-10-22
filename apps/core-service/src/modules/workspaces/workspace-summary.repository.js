// Fixed-count tenant-scoped queries: do not enumerate projects and query each in a loop.
export function createWorkspaceSummaryRepository(pool) {
  return {
    async get(workspaceId) {
      const [projects, statuses, priorities, daily] = await Promise.all([
        pool.query(`SELECT COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status='ACTIVE')::int AS active
          FROM core.projects WHERE workspace_id=$1`, [workspaceId]),
        pool.query(`SELECT i.status, COUNT(*)::int AS count FROM core.issues i
          WHERE i.workspace_id=$1 AND i.deleted_at IS NULL
          GROUP BY i.status`, [workspaceId]),
        pool.query(`SELECT i.priority, COUNT(*)::int AS count FROM core.issues i
          WHERE i.workspace_id=$1 AND i.deleted_at IS NULL
          GROUP BY i.priority`, [workspaceId]),
        pool.query(`SELECT (i.created_at AT TIME ZONE 'UTC')::date::text AS day,
          COUNT(*)::int AS count FROM core.issues i
          WHERE i.workspace_id=$1 AND i.deleted_at IS NULL
            AND (i.created_at AT TIME ZONE 'UTC')::date >=
              (NOW() AT TIME ZONE 'UTC')::date - 13
          GROUP BY day ORDER BY day`, [workspaceId]),
      ]);
      return { projects: projects.rows[0], statusRows: statuses.rows,
        priorityRows: priorities.rows, createdDaily: daily.rows };
    },
  };
}
