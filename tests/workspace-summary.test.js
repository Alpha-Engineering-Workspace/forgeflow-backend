import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceSummaryService } from '../apps/core-service/src/modules/workspaces/workspace-summary.service.js';
import { workspaceCorePath } from '../apps/api-gateway/src/clients/core-client.js';

const w = '7f37aa5c-0caa-4a33-bdbd-b78117c415bb';

describe('M9 workspace summary contract', () => {
  it('requires membership before accessing aggregate repository', async () => {
    const repository = { get: vi.fn() };
    const service = createWorkspaceSummaryService(repository, { authorize: vi.fn().mockRejectedValue({ status: 404 }) });
    await expect(service.get('outside', w)).rejects.toMatchObject({ status: 404 });
    expect(repository.get).not.toHaveBeenCalled();
  });
  it('fills zero categories and returns true zero-total state without NaN', async () => {
    const service = createWorkspaceSummaryService({ get: async () => ({
      projects: { total: 2, active: 1 }, statusRows: [{ status: 'DONE', count: 2 }],
      priorityRows: [{ priority: 'LOW', count: 2 }], createdDaily: [],
    }) }, { authorize: async () => {} });
    const result = await service.get('owner', w);
    expect(result.issues).toMatchObject({ total: 2, open: 0, done: 2,
      byStatus: { TODO: 0, IN_PROGRESS: 0, IN_REVIEW: 0, DONE: 2 },
      byPriority: { LOW: 2, MEDIUM: 0, HIGH: 0, URGENT: 0 } });
    expect(result.scope.workspaceId).toBe(w);
  });
  it('gateway allowlists GET summary and refuses mutations', () => {
    expect(workspaceCorePath('GET', `/${w}/summary`)).toBe(`/internal/workspaces/${w}/summary`);
    expect(workspaceCorePath('POST', `/${w}/summary`)).toBeNull();
  });
});
