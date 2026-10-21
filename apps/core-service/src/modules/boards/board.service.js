import { WorkspaceError } from '../workspaces/workspace.errors.js';

const fail = (status, code, message) => { throw new WorkspaceError(status, code, message); };

export function createBoardService(repository, issueRepository, workspaceService, projectService) {
  async function access(actor, workspaceId, projectId) {
    await workspaceService.authorize(actor, workspaceId);
    await projectService.get(actor, workspaceId, projectId);
  }
  return {
    async get(actor, workspaceId, projectId) {
      await access(actor, workspaceId, projectId);
      const { project, issues } = await repository.snapshot(workspaceId, projectId, actor);
      if (!project) fail(404, 'PROJECT_NOT_FOUND', 'Project not found');
      return { boardVersion: project.boardVersion, projectStatus: project.status, issues };
    },
    async move(actor, workspaceId, projectId, input) {
      await access(actor, workspaceId, projectId);
      return issueRepository.transaction(async (client) => {
        // All API writes acquire this same project lock, then work with issue rows.
        const project = await issueRepository.projectForWrite(client, workspaceId, projectId, actor);
        if (!project) fail(404, 'PROJECT_NOT_FOUND', 'Project not found');
        if (project.status !== 'ACTIVE') fail(409, 'PROJECT_ARCHIVED', 'Archived projects cannot be changed');
        if (project.boardVersion !== input.expectedBoardVersion) {
          fail(409, 'BOARD_VERSION_CONFLICT', 'Board changed; reload before moving');
        }
        const current = await repository.issues(workspaceId, projectId, actor, client);
        const moved = current.find((issue) => issue.id === input.issueId);
        if (!moved) fail(404, 'ISSUE_NOT_FOUND', 'Issue not found');
        if (moved.version !== input.expectedIssueVersion) {
          fail(409, 'VERSION_CONFLICT', 'Issue changed; reload before moving');
        }
        const sourceIds = current.filter((issue) => issue.status === moved.status && issue.id !== moved.id)
          .map((issue) => issue.id);
        const destinationIds = moved.status === input.toStatus ? sourceIds
          : current.filter((issue) => issue.status === input.toStatus).map((issue) => issue.id);
        if (input.targetIndex > destinationIds.length) {
          fail(400, 'INVALID_TARGET_INDEX', 'Destination position is outside the column');
        }
        const nextDestination = [...destinationIds];
        nextDestination.splice(input.targetIndex, 0, moved.id);
        if (!(await repository.moveIssue(client, workspaceId, projectId, moved.id,
          input.toStatus, input.expectedIssueVersion))) {
          fail(409, 'VERSION_CONFLICT', 'Issue changed; reload before moving');
        }
        if (moved.status !== input.toStatus) {
          await repository.reorderLane(client, workspaceId, projectId, moved.status, sourceIds);
        }
        await repository.reorderLane(client, workspaceId, projectId, input.toStatus, nextDestination);
        const boardVersion = await issueRepository.bumpBoardVersion(client, workspaceId, projectId);
        const issue = await issueRepository.get(workspaceId, projectId, actor, moved.id, client);
        return { boardVersion, issue };
      });
    },
  };
}
