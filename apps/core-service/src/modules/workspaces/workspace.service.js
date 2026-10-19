import { WorkspaceError } from './workspace.errors.js';

export function createWorkspaceService(repository) {
  async function requireMember(workspaceId, userId, allowedRoles) {
    const workspace = await repository.getMember(workspaceId, userId);
    // Conceal existence of another tenant's workspace.
    if (!workspace) throw new WorkspaceError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found');
    if (allowedRoles && !allowedRoles.includes(workspace.role)) {
      throw new WorkspaceError(403, 'ROLE_FORBIDDEN', 'Insufficient workspace permissions');
    }
    return workspace;
  }
  return {
    async create(userId, name) {
      return repository.transaction(async (client) => {
        const workspace = await repository.create(client, userId, name);
        await repository.createOwner(client, workspace.id, userId);
        return { ...workspace, role: 'OWNER' };
      });
    },
    async list(userId, page, limit) {
      const offset = (page - 1) * limit;
      const { workspaces, total } = await repository.list(userId, limit, offset);
      return { workspaces, pagination: { page, limit, total } };
    },
    get: (userId, workspaceId) => requireMember(workspaceId, userId),
    async rename(userId, workspaceId, name) {
      const member = await requireMember(workspaceId, userId, ['OWNER', 'ADMIN']);
      const updated = await repository.rename(workspaceId, userId, name);
      if (!updated) throw new WorkspaceError(403, 'ROLE_FORBIDDEN', 'Insufficient workspace permissions');
      return { ...updated, role: member.role };
    },
    async members(userId, workspaceId) {
      await requireMember(workspaceId, userId);
      return repository.members(workspaceId);
    },
  };
}
