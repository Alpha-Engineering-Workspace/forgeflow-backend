import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createAuthPool } from '../../apps/auth-service/src/db/pool.js';
import { createCorePool } from '../../apps/core-service/src/db/pool.js';
import { createWorkspaceRepository } from '../../apps/core-service/src/modules/workspaces/workspace.repository.js';
import { createWorkspaceService } from '../../apps/core-service/src/modules/workspaces/workspace.service.js';
import { createWorkspaceSummaryService } from '../../apps/core-service/src/modules/workspaces/workspace-summary.service.js';
import { createWorkspaceSummaryRepository } from '../../apps/core-service/src/modules/workspaces/workspace-summary.repository.js';
import { createProjectRepository } from '../../apps/core-service/src/modules/projects/project.repository.js';
import { createProjectService } from '../../apps/core-service/src/modules/projects/project.service.js';
import { createIssueRepository } from '../../apps/core-service/src/modules/issues/issue.repository.js';
import { createIssueService } from '../../apps/core-service/src/modules/issues/issue.service.js';
const authPool = createAuthPool(), corePool = createCorePool();
const workspaces = createWorkspaceService(createWorkspaceRepository(corePool));
const projects = createProjectService(createProjectRepository(corePool), workspaces);
const issues = createIssueService(createIssueRepository(corePool), workspaces, projects);
const summary = createWorkspaceSummaryService(createWorkspaceSummaryRepository(corePool), workspaces);
const users = [], spaces = [];
async function user() {
  const id = randomUUID(); users.push(id);
  await authPool.query(`INSERT INTO auth.users(id,name,email,password_hash,email_verified_at)
    VALUES($1,'Summary test user',$2,'test-hash',NOW())`, [id, `${id}@example.test`]);
  return id;
}
async function space(owner) { const created = await workspaces.create(owner, 'Summary scope test'); spaces.push(created.id); return created.id; }
afterAll(async () => {
  for (const id of spaces) {
    await corePool.query('DELETE FROM core.issues WHERE workspace_id=$1', [id]);
    await corePool.query('DELETE FROM core.projects WHERE workspace_id=$1', [id]);
    await corePool.query('DELETE FROM core.workspace_members WHERE workspace_id=$1', [id]);
    await corePool.query('DELETE FROM core.workspaces WHERE id=$1', [id]);
  }
  for (const id of users) await authPool.query('DELETE FROM auth.users WHERE id=$1', [id]);
  await Promise.all([corePool.end(), authPool.end()]);
});
describe('M9 PostgreSQL workspace summary', () => {
  it('counts all scoped, nondeleted issues across projects and rejects outsiders', async () => {
    const owner = await user(), outsider = await user(), a = await space(owner), b = await space(outsider);
    const aProject = await projects.create(owner, a, { name: 'Own project', description: '' });
    const bProject = await projects.create(outsider, b, { name: 'Foreign project', description: '' });
    const input = (status, priority) => ({ title: 'Tracked issue', description: '', type: 'TASK', status, priority, assigneeId: null });
    await issues.create(owner, a, aProject.id, input('DONE', 'HIGH'));
    await issues.create(owner, a, aProject.id, input('TODO', 'LOW'));
    await issues.create(outsider, b, bProject.id, input('IN_PROGRESS', 'URGENT'));
    const count = await summary.get(owner, a);
    expect(count.projects).toEqual({ total: 1, active: 1 });
    expect(count.issues).toMatchObject({ total: 2, done: 1, open: 1,
      byStatus: { TODO: 1, DONE: 1, IN_PROGRESS: 0 }, byPriority: { HIGH: 1, LOW: 1, URGENT: 0 } });
    expect(count.createdDaily.reduce((sum, day) => sum + day.count, 0)).toBe(2);
    await expect(summary.get(owner, b)).rejects.toMatchObject({ status: 404 });
    await expect(summary.get(outsider, a)).rejects.toMatchObject({ status: 404 });
  });
});
