import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createAuthPool } from '../../apps/auth-service/src/db/pool.js';
import { createCorePool } from '../../apps/core-service/src/db/pool.js';
import { createWorkspaceRepository } from '../../apps/core-service/src/modules/workspaces/workspace.repository.js';
import { createWorkspaceService } from '../../apps/core-service/src/modules/workspaces/workspace.service.js';

const authPool = createAuthPool();
const corePool = createCorePool();
const workspace = createWorkspaceService(createWorkspaceRepository(corePool));
const createdUsers = [];
const createdWorkspaces = [];

async function user() {
  const id = randomUUID();
  await authPool.query(`INSERT INTO auth.users(id,name,email,password_hash,email_verified_at)
    VALUES ($1,'Workspace Test',$2,'test-hash',NOW())`, [id, `${id}@example.test`]);
  createdUsers.push(id);
  return id;
}

afterAll(async () => {
  for (const id of createdWorkspaces) await corePool.query('DELETE FROM core.workspaces WHERE id = $1', [id]);
  for (const id of createdUsers) await authPool.query('DELETE FROM auth.users WHERE id = $1', [id]);
  await Promise.all([authPool.end(), corePool.end()]);
});

describe('Workspace PostgreSQL constraints / tenant isolation', () => {
  it('persists owner membership and rejects guessed workspace UUID', async () => {
    const a = await user(); const b = await user();
    const wA = await workspace.create(a, 'Real team A');
    const wB = await workspace.create(b, 'Real team B');
    createdWorkspaces.push(wA.id, wB.id);
    expect((await workspace.list(a, 1, 20)).workspaces.map((w) => w.id)).toEqual([wA.id]);
    await expect(workspace.get(a, wB.id)).rejects.toMatchObject({ status: 404 });
    await expect(workspace.rename(a, wB.id, 'No')).rejects.toMatchObject({ status: 404 });
    const result = await corePool.query('SELECT role FROM core.workspace_members WHERE workspace_id = $1 AND user_id = $2', [wA.id, a]);
    expect(result.rows[0].role).toBe('OWNER');
    await expect(corePool.query(`INSERT INTO core.workspace_members(workspace_id,user_id,role)
      VALUES($1,$2,'OWNER')`, [wA.id, b])).rejects.toMatchObject({ code: '23505' });
  });
  it('transaction rolls back workspace if membership insertion fails', async () => {
    const id = await user();
    const originalRepo = createWorkspaceRepository(corePool);
    const broken = createWorkspaceService({ ...originalRepo, createOwner: async () => { throw Error('simulated failure'); } });
    const before = await corePool.query('SELECT COUNT(*)::int AS count FROM core.workspaces WHERE created_by=$1', [id]);
    await expect(broken.create(id, 'Rollback test')).rejects.toThrow('simulated failure');
    const after = await corePool.query('SELECT COUNT(*)::int AS count FROM core.workspaces WHERE created_by=$1', [id]);
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });
});
