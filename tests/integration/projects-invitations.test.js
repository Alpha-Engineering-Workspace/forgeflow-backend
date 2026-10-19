import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createAuthPool } from '../../apps/auth-service/src/db/pool.js';
import { createCorePool } from '../../apps/core-service/src/db/pool.js';
import { createWorkspaceRepository } from '../../apps/core-service/src/modules/workspaces/workspace.repository.js';
import { createWorkspaceService } from '../../apps/core-service/src/modules/workspaces/workspace.service.js';
import { createProjectRepository } from '../../apps/core-service/src/modules/projects/project.repository.js';
import { createProjectService } from '../../apps/core-service/src/modules/projects/project.service.js';
import { createInvitationRepository } from '../../apps/core-service/src/modules/invitations/invitation.repository.js';
import { createInvitationService } from '../../apps/core-service/src/modules/invitations/invitation.service.js';
const authPool = createAuthPool(), corePool = createCorePool();
const workspace = createWorkspaceService(createWorkspaceRepository(corePool));
const projects = createProjectService(createProjectRepository(corePool), workspace);
const mailer = { ready: () => true, send: vi.fn(async () => {}) };
const invitations = createInvitationService(createInvitationRepository(corePool), workspace, mailer);
const users = [], workspaces = [];

async function user() {
  const id = randomUUID();
  await authPool.query(`INSERT INTO auth.users(id,name,email,password_hash,email_verified_at)
    VALUES($1,'M6 Test User',$2,'fake-hash',NOW())`, [id, `${id}@example.test`]);
  users.push(id); return id;
}
async function team(owner) {
  const w = await workspace.create(owner, 'M6 Integration Team');
  workspaces.push(w.id); return w.id;
}
afterAll(async () => {
  for (const id of workspaces) {
    await corePool.query('DELETE FROM core.projects WHERE workspace_id=$1', [id]);
    await corePool.query('DELETE FROM core.workspaces WHERE id=$1', [id]);
  }
  for (const id of users) await authPool.query('DELETE FROM auth.users WHERE id=$1', [id]);
  await Promise.all([authPool.end(), corePool.end()]);
});

describe('M6 real PostgreSQL tenant/RBAC and invitation transaction', () => {
  it('scopes projects to workspace; rejects member writes; enforces version and archival', async () => {
    const owner = await user(), intruder = await user(), member = await user();
    const w = await team(owner), other = await team(intruder);
    await corePool.query(`INSERT INTO core.workspace_members(workspace_id,user_id,role)
      VALUES($1,$2,'MEMBER')`, [w, member]);
    const item = await projects.create(owner, w, { name:'Alpha project',description:'In real Postgres' });
    expect(item.version).toBe(1);
    await expect(projects.get(intruder,w,item.id)).rejects.toMatchObject({status:404});
    await expect(projects.get(owner,other,item.id)).rejects.toMatchObject({status:404});
    await expect(projects.create(member,w,{name:'Bad',description:''})).rejects.toMatchObject({status:403});
    expect((await projects.list(member,w,{page:1,limit:20,status:'ACTIVE'})).projects).toHaveLength(1);
    const edited = await projects.update(owner,w,item.id,{name:'Renamed',description:'',expectedVersion:1});
    expect(edited.version).toBe(2);
    await expect(projects.update(owner,w,item.id,{name:'stale',description:'',expectedVersion:1})).rejects.toMatchObject({status:409});
    await projects.archive(owner,w,item.id,2);
    await expect(projects.update(owner,w,item.id,{name:'later',description:'',expectedVersion:3})).rejects.toMatchObject({status:409,code:'PROJECT_ARCHIVED'});
    expect((await projects.list(owner,w,{page:1,limit:20,status:'ARCHIVED'})).projects).toHaveLength(1);
  });
  it('accepts verified-email invitation once, prevents replay and Owner demotion/removal', async () => {
    const owner = await user(), invitee = await user(), stranger = await user();
    const w = await team(owner), inviteEmail = `${invitee}@example.test`;
    const invitation = await invitations.create(owner,w,{email:inviteEmail,role:'ADMIN'});
    expect(invitation.role).toBe('ADMIN');
    expect(invitation.deliveryStatus).toBe('SENT');
    const token = mailer.send.mock.lastCall[0].token;
    await expect(invitations.accept(stranger,`${stranger}@example.test`,token)).rejects.toMatchObject({status:400});
    expect(await invitations.accept(invitee,inviteEmail,token)).toEqual({workspaceId:w,role:'ADMIN'});
    await expect(invitations.accept(invitee,inviteEmail,token)).rejects.toMatchObject({status:400});
    const access = await workspace.get(invitee,w);
    expect(access.role).toBe('ADMIN');
    await expect(invitations.changeRole(invitee,w,owner,'MEMBER')).rejects.toMatchObject({status:403});
    await expect(invitations.remove(invitee,w,owner)).rejects.toMatchObject({status:403});
    await expect(invitations.remove(invitee,w,invitee)).rejects.toMatchObject({status:403});
    const pending = await invitations.create(invitee,w,{email:`${stranger}@example.test`,role:'MEMBER'});
    const pendingToken = mailer.send.mock.lastCall[0].token;
    await invitations.changeRole(owner,w,invitee,'MEMBER');
    const canceled = await corePool.query('SELECT status FROM core.workspace_invitations WHERE id=$1', [pending.id]);
    expect(canceled.rows[0].status).toBe('CANCELED');
    await expect(invitations.accept(stranger,`${stranger}@example.test`,pendingToken)).rejects.toMatchObject({status:400});
  });
  it('blocks duplicate pending invitations and verifies cancel/resend invalidate older token', async () => {
    const owner = await user(), invitee = await user(), w = await team(owner);
    const email = `${invitee}@example.test`;
    const first = await invitations.create(owner,w,{email,role:'MEMBER'});
    const old = mailer.send.mock.lastCall[0].token;
    await expect(invitations.create(owner,w,{email,role:'MEMBER'})).rejects.toMatchObject({status:409});
    const refreshed = await invitations.resend(owner,w,first.id);
    expect(refreshed.id).toBe(first.id);
    const current = mailer.send.mock.lastCall[0].token;
    await expect(invitations.accept(invitee,email,old)).rejects.toMatchObject({status:400});
    await invitations.cancel(owner,w,first.id);
    await expect(invitations.accept(invitee,email,current)).rejects.toMatchObject({status:400});
    const open = await invitations.create(owner,w,{email,role:'MEMBER'});
    expect(open.id).not.toBe(first.id);
  });
});
