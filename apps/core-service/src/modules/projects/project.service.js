import { WorkspaceError } from '../workspaces/workspace.errors.js';

export function createProjectService(repository, workspaceService) {
  const required = (id, actor, roles) => workspaceService.authorize(actor, id, roles);
  function missing() { throw new WorkspaceError(404, 'PROJECT_NOT_FOUND', 'Project not found'); }
  return {
    async create(actor, workspaceId, input) {
      await required(workspaceId, actor, ['OWNER', 'ADMIN']);
      return (await repository.create(workspaceId, actor, input)) ?? missing();
    },
    async list(actor, workspaceId, options) {
      await required(workspaceId, actor);
      return repository.list(workspaceId, actor, options);
    },
    async get(actor, workspaceId, id) {
      await required(workspaceId, actor);
      return (await repository.get(workspaceId, actor, id)) ?? missing();
    },
    async update(actor, workspaceId, id, input) {
      await required(workspaceId, actor, ['OWNER', 'ADMIN']);
      const updated = await repository.update(workspaceId, actor, id, input);
      if (updated) return updated;
      const current = await repository.get(workspaceId, actor, id);
      if (!current) missing();
      if (current.status === 'ARCHIVED') throw new WorkspaceError(409, 'PROJECT_ARCHIVED', 'Archived projects cannot be changed');
      throw new WorkspaceError(409, 'VERSION_CONFLICT', 'Project changed; reload before editing');
    },
    async archive(actor, workspaceId, id, expectedVersion) {
      await required(workspaceId, actor, ['OWNER', 'ADMIN']);
      const archived = await repository.archive(workspaceId, actor, id, expectedVersion);
      if (archived) return archived;
      const current = await repository.get(workspaceId, actor, id);
      if (!current) missing();
      throw new WorkspaceError(409, current.status === 'ARCHIVED' ? 'PROJECT_ARCHIVED' : 'VERSION_CONFLICT',
        'Project already archived or changed; reload first');
    },
  };
}
