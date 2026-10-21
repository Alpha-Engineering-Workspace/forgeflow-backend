import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createAuthPool } from '../../apps/auth-service/src/db/pool.js';
import { createCorePool } from '../../apps/core-service/src/db/pool.js';
import { createWorkspaceRepository } from '../../apps/core-service/src/modules/workspaces/workspace.repository.js';
import { createWorkspaceService } from '../../apps/core-service/src/modules/workspaces/workspace.service.js';
import { createProjectRepository } from '../../apps/core-service/src/modules/projects/project.repository.js';
import { createProjectService } from '../../apps/core-service/src/modules/projects/project.service.js';
import { createIssueRepository } from '../../apps/core-service/src/modules/issues/issue.repository.js';
import { createIssueService } from '../../apps/core-service/src/modules/issues/issue.service.js';
import { createInvitationRepository } from '../../apps/core-service/src/modules/invitations/invitation.repository.js';

const authPool = createAuthPool(), corePool = createCorePool();
const workspace = createWorkspaceService(createWorkspaceRepository(corePool));
const projects = createProjectService(createProjectRepository(corePool), workspace);
const issues = createIssueService(createIssueRepository(corePool), workspace, projects);
const invitations = createInvitationRepository(corePool);
const createdUsers = [], createdWorkspaces = [];

async function newUser() {
  const id = randomUUID();
  await authPool.query(`INSERT INTO auth.users(id,name,email,password_hash,email_verified_at)
    VALUES($1,'M7 Test User',$2,'test-hash',NOW())`, [id, `${id}@example.test`]);
  createdUsers.push(id); return id;
}
async function newWorkspace(owner) {
  const result = await workspace.create(owner, 'Issue Test Workspace');
  createdWorkspaces.push(result.id); return result.id;
}
async function join(ws, userId, role='MEMBER') {
  await corePool.query('INSERT INTO core.workspace_members(workspace_id,user_id,role) VALUES($1,$2,$3)', [ws,userId,role]);
}
const input = (title, assigneeId=null) => ({ title, description:'M7 data', status:'TODO', priority:'HIGH', type:'TASK', assigneeId });

afterAll(async () => {
  // CASCADE from projects removes test issues. Do not remove or reset real user data.
  for (const id of createdWorkspaces) {
    await corePool.query('DELETE FROM core.issues WHERE workspace_id=$1', [id]);
    await corePool.query('DELETE FROM core.projects WHERE workspace_id=$1', [id]);
    await corePool.query('DELETE FROM core.workspace_members WHERE workspace_id=$1', [id]);
    await corePool.query('DELETE FROM core.workspaces WHERE id=$1', [id]);
  }
  for (const id of createdUsers) await authPool.query('DELETE FROM auth.users WHERE id=$1', [id]);
  await Promise.all([corePool.end(), authPool.end()]);
});

describe('M7 PostgreSQL tenant, concurrency and assignee invariants', () => {
  it('enforces tenant/project scope, member issue writes and assignment FK', async () => {
    const owner = await newUser(), member = await newUser(), outsider = await newUser();
    const w = await newWorkspace(owner), otherW = await newWorkspace(outsider);
    await join(w, member);
    const p = await projects.create(owner, w, { name:'Delivery', description:'' });
    const foreign = await projects.create(outsider, otherW, { name:'Foreign', description:'' });
    const issue = await issues.create(member, w, p.id, input('Repair failed API', member));
    expect(issue.version).toBe(1);
    expect(issue.assigneeId).toBe(member);
    await expect(issues.get(outsider, w, p.id, issue.id)).rejects.toMatchObject({ status:404 });
    await expect(issues.get(owner, otherW, foreign.id, issue.id)).rejects.toMatchObject({ status:404 });
    await expect(issues.create(member, w, p.id, input('Invalid assignee', outsider)))
      .rejects.toMatchObject({ status:400, code:'INVALID_ASSIGNEE' });
    await expect(corePool.query(`INSERT INTO core.issues(workspace_id,project_id,title,created_by,assignee_user_id)
      VALUES($1,$2,'SQL foreign assignee',$3,$4)`, [w,p.id,member,outsider])).rejects.toMatchObject({ code:'23503' });
    await expect(issues.create(owner, w, foreign.id, input('Cross-workspace project'))).rejects.toMatchObject({ status:404 });
    expect((await issues.list(member, w, p.id, { page:1,limit:20,status:'TODO' })).issues).toHaveLength(1);
    expect((await issues.list(owner, w, p.id, { page:1,limit:20,q:'failed' })).issues).toHaveLength(1);
    expect((await issues.list(owner, w, p.id, { page:1,limit:20,q:'%_' })).issues).toHaveLength(0);
  });

  it('returns 409 on stale updates and rejects writes after project archive', async () => {
    const owner = await newUser(), w = await newWorkspace(owner);
    const project = await projects.create(owner, w, { name:'Concurrency', description:'' });
    const issue = await issues.create(owner, w, project.id, input('Issue first version'));
    const concurrent = await Promise.allSettled([
      issues.update(owner,w,project.id,issue.id,{priority:'URGENT',expectedVersion:1}),
      issues.update(owner,w,project.id,issue.id,{status:'DONE',expectedVersion:1}),
    ]);
    expect(concurrent.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === 'rejected')).toMatchObject([
      {status:'rejected',reason:{status:409,code:'VERSION_CONFLICT'}},
    ]);
    expect((await issues.get(owner,w,project.id,issue.id)).version).toBe(2);
    await projects.archive(owner,w,project.id,project.version);
    await expect(issues.create(owner,w,project.id,input('No writes in archive')))
      .rejects.toMatchObject({status:409,code:'PROJECT_ARCHIVED'});
    await expect(issues.update(owner,w,project.id,issue.id,{status:'DONE',expectedVersion:2}))
      .rejects.toMatchObject({ status:409, code:'PROJECT_ARCHIVED' });
  });

  it('removes membership and clears assignments with version increment', async () => {
    const owner = await newUser(), member = await newUser(), w = await newWorkspace(owner);
    await join(w, member);
    const project = await projects.create(owner,w,{ name:'Assignment',description:'' });
    const issue = await issues.create(owner,w,project.id,input('Assigned bug',member));
    await invitations.remove(w, owner, member);
    const changed = await issues.get(owner,w,project.id,issue.id);
    expect(changed.assigneeId).toBeNull();
    expect(changed.version).toBe(2);
    await expect(issues.get(member,w,project.id,issue.id)).rejects.toMatchObject({status:404});
    await expect(issues.update(owner,w,project.id,issue.id,{status:'DONE',expectedVersion:1}))
      .rejects.toMatchObject({status:409});
  });
});
