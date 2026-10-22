const STATUS = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'];
const PRIORITY = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

function zeroCounts(keys, rows, key) {
  const output = Object.fromEntries(keys.map((item) => [item, 0]));
  for (const row of rows) if (Object.hasOwn(output, row[key])) output[row[key]] = row.count;
  return output;
}

export function createWorkspaceSummaryService(repository, workspaceService) {
  return {
    async get(actorId, workspaceId) {
      // Enforce authorization before making any aggregate query; outsider gets 404.
      await workspaceService.authorize(actorId, workspaceId);
      const data = await repository.get(workspaceId);
      const byStatus = zeroCounts(STATUS, data.statusRows, 'status');
      const byPriority = zeroCounts(PRIORITY, data.priorityRows, 'priority');
      const totalIssues = STATUS.reduce((sum, key) => sum + byStatus[key], 0);
      return {
        scope: { workspaceId, timeZone: 'UTC', createdDailyDays: 14,
          includesArchivedProjects: true, excludesDeletedIssues: true },
        projects: { total: data.projects.total, active: data.projects.active },
        issues: { total: totalIssues, open: totalIssues - byStatus.DONE, done: byStatus.DONE,
          byStatus, byPriority },
        createdDaily: data.createdDaily,
      };
    },
  };
}
