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
import { createBoardRepository } from '../../apps/core-service/src/modules/boards/board.repository.js';
import { createBoardService } from '../../apps/core-service/src/modules/boards/board.service.js';
import { createInvitationRepository } from '../../apps/core-service/src/modules/invitations/invitation.repository.js';

const authPool = createAuthPool(), corePool = createCorePool();
const workspaces = createWorkspaceService(createWorkspaceRepository(corePool));
const projects = createProjectService(createProjectRepository(corePool), workspaces);
const issueRepo = createIssueRepository(corePool);
const issues = createIssueService(issueRepo, workspaces, projects);
const boards = createBoardService(createBoardRepository(corePool), issueRepo, workspaces, projects);
const invites = createInvitationRepository(corePool);
const users = [], spaces = [];
async function user() {
  const id = randomUUID();
  await authPool.query(`INSERT INTO auth.users(id,name,email,password_hash,email_verified_at)
    VALUES($1,'M8 Kanban Test',$2,'test-hash',NOW())`, [id, `${id}@example.test`]);
  users.push(id); return id;
}
async function workspace(owner) {
  const ws = await workspaces.create(owner, 'M8 Kanban Workspace');
  spaces.push(ws.id); return ws.id;
}
async function issue(owner, ws, p, title, status='TODO') {
  return issues.create(owner, ws, p, { title, status, type:'TASK', priority:'MEDIUM',
    description:'', assigneeId:null });
}
const move = (card, boardVersion, toStatus, targetIndex) => ({
  issueId: card.id, toStatus, targetIndex,
  expectedBoardVersion: boardVersion, expectedIssueVersion: card.version,
});
const titles = (board, status) => board.issues.filter((i) => i.status === status).map((i) => i.title);
function expectContiguous(board) {
  for (const status of ['TODO','IN_PROGRESS','IN_REVIEW','DONE']) {
    expect(board.issues.filter((i) => i.status === status).map((i) => Number(i.boardPosition)))
      .toEqual(board.issues.filter((i) => i.status === status).map((_, index) => index));
  }
}

afterAll(async () => {
  for (const ws of spaces) {
    await corePool.query('DELETE FROM core.issues WHERE workspace_id=$1', [ws]);
    await corePool.query('DELETE FROM core.projects WHERE workspace_id=$1', [ws]);
    await corePool.query('DELETE FROM core.workspace_members WHERE workspace_id=$1', [ws]);
    await corePool.query('DELETE FROM core.workspaces WHERE id=$1', [ws]);
  }
  for (const id of users) await authPool.query('DELETE FROM auth.users WHERE id=$1', [id]);
  await Promise.all([corePool.end(), authPool.end()]);
});

describe('M8 PostgreSQL persisted Kanban invariants (requires migration 009)', () => {
  it('persists ordered same-lane and cross-lane moves; M7 CRUD preserves board integrity', async () => {
    const owner = await user(), ws = await workspace(owner);
    const p = await projects.create(owner, ws, { name:'Kanban Delivery', description:'' });
    const a = await issue(owner, ws, p.id, 'Alpha');
    const b = await issue(owner, ws, p.id, 'Beta');
    const c = await issue(owner, ws, p.id, 'Gamma');
    let board = await boards.get(owner, ws, p.id);
    expect(titles(board,'TODO')).toEqual(['Alpha','Beta','Gamma']);
    expectContiguous(board);
    let change = await boards.move(owner,ws,p.id,move(c,board.boardVersion,'TODO',0));
    expect(change.issue.version).toBe(c.version+1);
    expect(change.issue.boardPosition).toBe('0');
    board = await boards.get(owner,ws,p.id);
    expect(titles(board,'TODO')).toEqual(['Gamma','Alpha','Beta']);
    expectContiguous(board);
    change = await boards.move(owner,ws,p.id,move(b,board.boardVersion,'DONE',0));
    board = await boards.get(owner,ws,p.id);
    expect(titles(board,'TODO')).toEqual(['Gamma','Alpha']);
    expect(titles(board,'DONE')).toEqual(['Beta']);
    expect(change.boardVersion).toBe(board.boardVersion);
    expectContiguous(board);
    // Old issue PATCH status is still supported and must append to destination lane.
    const updated = await issues.update(owner,ws,p.id,a.id,{ status:'DONE', expectedVersion:a.version });
    expect(updated.boardPosition).toBe('1');
    board = await boards.get(owner,ws,p.id);
    expect(titles(board,'DONE')).toEqual(['Beta','Alpha']);
    expectContiguous(board);
    await issues.remove(owner,ws,p.id,a.id,updated.version);
    board = await boards.get(owner,ws,p.id);
    expect(titles(board,'DONE')).toEqual(['Beta']);
    expectContiguous(board);
  });

  it('serializes parallel board moves and rejects stale versions, invalid indices and foreign tenants', async () => {
    const owner = await user(), member = await user(), foreign = await user();
    const ws = await workspace(owner), foreignWs = await workspace(foreign);
    await corePool.query('INSERT INTO core.workspace_members(workspace_id,user_id,role) VALUES($1,$2,$3)', [ws,member,'MEMBER']);
    const p = await projects.create(owner,ws,{name:'Parallel',description:''});
    const other = await projects.create(foreign,foreignWs,{name:'Other Workspace',description:''});
    const card = await issue(owner,ws,p.id,'Parallel target');
    const board = await boards.get(owner,ws,p.id);
    await expect(boards.get(foreign,ws,p.id)).rejects.toMatchObject({status:404});
    await expect(boards.move(foreign,ws,p.id,move(card,board.boardVersion,'DONE',0)))
      .rejects.toMatchObject({status:404});
    await expect(boards.move(owner,foreignWs,other.id,move(card,board.boardVersion,'DONE',0)))
      .rejects.toMatchObject({status:404});
    await expect(boards.move(member,ws,p.id,move(card,board.boardVersion,'TODO',3)))
      .rejects.toMatchObject({status:400,code:'INVALID_TARGET_INDEX'});
    const results = await Promise.allSettled([
      boards.move(owner,ws,p.id,move(card,board.boardVersion,'DONE',0)),
      boards.move(member,ws,p.id,move(card,board.boardVersion,'IN_REVIEW',0)),
    ]);
    expect(results.filter((r) => r.status==='fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status==='rejected')).toMatchObject([
      {status:'rejected',reason:{status:409,code:'BOARD_VERSION_CONFLICT'}},
    ]);
    const final = await boards.get(owner,ws,p.id);
    expect(final.boardVersion).toBe(board.boardVersion+1);
    expectContiguous(final);
    await expect(boards.move(owner,ws,p.id,move(card,final.boardVersion,'TODO',0)))
      .rejects.toMatchObject({status:409,code:'VERSION_CONFLICT'});
  });

  it('invalidates board version for assignee removal and prevents archived writes', async () => {
    const owner = await user(), member = await user(), ws = await workspace(owner);
    await corePool.query('INSERT INTO core.workspace_members(workspace_id,user_id,role) VALUES($1,$2,$3)', [ws,member,'MEMBER']);
    const p = await projects.create(owner,ws,{name:'Member Board',description:''});
    const card = await issues.create(owner,ws,p.id,{title:'Assigned to member', description:'',
      type:'BUG', status:'TODO',priority:'HIGH',assigneeId:member});
    const before = await boards.get(owner,ws,p.id);
    await invites.remove(ws,owner,member);
    const after = await boards.get(owner,ws,p.id);
    expect(after.boardVersion).toBe(before.boardVersion+1);
    expect(after.issues[0]).toMatchObject({assigneeId:null,version:card.version+1});
    await projects.archive(owner,ws,p.id,p.version);
    const readArchived = await boards.get(owner,ws,p.id);
    expect(readArchived.projectStatus).toBe('ARCHIVED');
    await expect(boards.move(owner,ws,p.id,move(after.issues[0],readArchived.boardVersion,'DONE',0)))
      .rejects.toMatchObject({status:409,code:'PROJECT_ARCHIVED'});
  });
});
