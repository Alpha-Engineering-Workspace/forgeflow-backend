// Dependency-free contract sanity checks. NOT a substitute for Vitest/PostgreSQL integration.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { workspaceCorePath } from '../apps/api-gateway/src/clients/core-client.js';
import { createIssueService } from '../apps/core-service/src/modules/issues/issue.service.js';
import { createIssueRepository } from '../apps/core-service/src/modules/issues/issue.repository.js';

const workspaceId = randomUUID(), projectId = randomUUID(), issueId = randomUUID();
const actorId = randomUUID(), strangerId = randomUUID();
const base = `/${workspaceId}/projects/${projectId}/issues`;
assert.equal(workspaceCorePath('GET', base), `/internal/workspaces${base}`);
assert.equal(workspaceCorePath('PATCH', `${base}/${issueId}`), `/internal/workspaces${base}/${issueId}`);
assert.equal(workspaceCorePath('DELETE', `${base}/${issueId}`), `/internal/workspaces${base}/${issueId}`);
assert.equal(workspaceCorePath('POST', `${base}/${issueId}`), null);
assert.equal(workspaceCorePath('GET', `/${strangerId}/projects/not-a-uuid/issues`), null);

let issue = null;
const db = {
  async transaction(fn) { return fn({}); },
  async projectForWrite() { return {status:'ACTIVE'}; },
  async assigneeExists(_client, _workspace, assignee) { return assignee === actorId; },
  async create(_c, ws, project, actor, data) {
    issue = { id: issueId, workspaceId:ws, projectId:project, createdBy:actor, ...data, version:1 };
    return issue;
  },
  async get(ws, project, actor, id) {
    return ws === workspaceId && project === projectId && actor === actorId && id === issueId ? issue : null;
  },
  async update(_c, ws, project, actor, id, patch) {
    if (patch.expectedVersion !== issue?.version) return null;
    issue = { ...issue, status:patch.status, version:issue.version+1 };
    return issue;
  },
};
const workspaces = { async authorize(actor) {
  if (actor !== actorId) throw Object.assign(new Error('not found'), {status:404});
} };
const projects = { async get(_actor, _ws, id) {
  if (id !== projectId) throw Object.assign(new Error('not found'), {status:404});
  return {status:'ACTIVE'};
} };
const service = createIssueService(db, workspaces, projects);
await assert.rejects(service.create(strangerId, workspaceId, projectId, {title:'No'}), {status:404});
await assert.rejects(service.create(actorId, workspaceId, projectId, {title:'Bad',assigneeId:strangerId}),
  {status:400,code:'INVALID_ASSIGNEE'});
await service.create(actorId, workspaceId, projectId, {title:'Useful issue',assigneeId:actorId});
assert.equal((await service.update(actorId, workspaceId, projectId, issueId,
  {status:'DONE',expectedVersion:1})).version, 2);
await assert.rejects(service.update(actorId, workspaceId, projectId, issueId,
  {status:'TODO',expectedVersion:1}), {status:409,code:'VERSION_CONFLICT'});

// SQL must use placeholders for search values, not interpolate user text.
const queries = [];
const fakePool = { async query(sql, params) {
  queries.push({sql,params});
  return sql.includes('COUNT(') ? {rows:[{total:0}]} : {rows:[]};
} };
await createIssueRepository(fakePool).list(workspaceId, projectId, actorId,
  {page:1,limit:20,q:"abc%' OR 1=1 --"});
assert.equal(queries.length,2);
assert.ok(queries[0].sql.includes('ILIKE'));
assert.ok(!queries[0].sql.includes('OR 1=1'));
assert.ok(queries[0].params.some((param) => typeof param === 'string' && param.includes('OR 1=1')));
console.log('M7 node smoke: passed (scoped routing, role errors, version, parameterized search).');
