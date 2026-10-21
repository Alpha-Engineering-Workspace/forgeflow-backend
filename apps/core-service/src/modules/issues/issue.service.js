import { WorkspaceError } from '../workspaces/workspace.errors.js';

function fail(status, code, message) { throw new WorkspaceError(status, code, message); }

export function createIssueService(repository, workspaceService, projectService) {
  async function access(actor, workspaceId, projectId, roles) {
    await workspaceService.authorize(actor, workspaceId, roles);
    return projectService.get(actor, workspaceId, projectId);
  }
  async function inActiveProject(actor, workspaceId, projectId, task) {
    return repository.transaction(async (client) => {
      const project = await repository.projectForWrite(client, workspaceId, projectId, actor);
      if (!project) fail(404, 'PROJECT_NOT_FOUND', 'Project not found');
      if (project.status !== 'ACTIVE') fail(409, 'PROJECT_ARCHIVED', 'Archived projects cannot be changed');
      return task(client);
    });
  }
  async function validateAssignee(client, workspaceId, input) {
    if (input.assigneeId !== undefined && input.assigneeId !== null &&
        !(await repository.assigneeExists(client, workspaceId, input.assigneeId))) {
      fail(400, 'INVALID_ASSIGNEE', 'Assignee must belong to this workspace');
    }
  }
  async function staleOrMissing(actor, workspaceId, projectId, issueId) {
    const existing = await repository.get(workspaceId, projectId, actor, issueId);
    if (!existing) fail(404, 'ISSUE_NOT_FOUND', 'Issue not found');
    fail(409, 'VERSION_CONFLICT', 'Issue changed; reload before editing');
  }
  return {
    async create(actor, workspaceId, projectId, input) {
      await access(actor, workspaceId, projectId);
      return inActiveProject(actor, workspaceId, projectId, async (client) => {
        await validateAssignee(client, workspaceId, input);
        return repository.create(client, workspaceId, projectId, actor, input);
      });
    },
    async list(actor, workspaceId, projectId, options) {
      await access(actor, workspaceId, projectId);
      return repository.list(workspaceId, projectId, actor, options);
    },
    async get(actor, workspaceId, projectId, id) {
      await access(actor, workspaceId, projectId);
      return (await repository.get(workspaceId, projectId, actor, id)) ??
        fail(404, 'ISSUE_NOT_FOUND', 'Issue not found');
    },
    async update(actor, workspaceId, projectId, id, input) {
      await access(actor, workspaceId, projectId);
      const result = await inActiveProject(actor, workspaceId, projectId, async (client) => {
        await validateAssignee(client, workspaceId, input);
        return repository.update(client, workspaceId, projectId, actor, id, input);
      });
      return result ?? staleOrMissing(actor, workspaceId, projectId, id);
    },
    async remove(actor, workspaceId, projectId, id, expectedVersion) {
      await access(actor, workspaceId, projectId, ['OWNER','ADMIN']);
      const removed = await inActiveProject(actor, workspaceId, projectId, (client) =>
        repository.remove(client, workspaceId, projectId, actor, id, expectedVersion));
      if (!removed) await staleOrMissing(actor, workspaceId, projectId, id);
      return undefined;
    },
  };
}
