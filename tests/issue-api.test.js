import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../apps/core-service/src/app.js';
import { createIssueService } from '../apps/core-service/src/modules/issues/issue.service.js';
import { workspaceCorePath } from '../apps/api-gateway/src/clients/core-client.js';
import { WorkspaceError } from '../apps/core-service/src/modules/workspaces/workspace.errors.js';

const workspaceId = randomUUID(), projectId = randomUUID(), otherProjectId = randomUUID();
const ownerId = randomUUID(), memberId = randomUUID(), strangerId = randomUUID();
const secret = '0123456789abcdef0123456789abcdef';
const headers = (actor) => ({ 'x-forgeflow-user-id': actor, 'x-forgeflow-internal-key': secret });
const base = `/internal/workspaces/${workspaceId}/projects/${projectId}/issues`;

function fixture() {
  let archived = false;
  const issues = new Map();
  const workspace = {
    async authorize(actor, ws, roles) {
      if (ws !== workspaceId || actor === strangerId) throw new WorkspaceError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found');
      const role = actor === ownerId ? 'OWNER' : 'MEMBER';
      if (roles && !roles.includes(role)) throw new WorkspaceError(403, 'ROLE_FORBIDDEN', 'Forbidden');
      return { id: ws, role };
    },
  };
  const projects = {
    async get(actor, ws, id) {
      await workspace.authorize(actor, ws);
      if (id !== projectId) throw new WorkspaceError(404, 'PROJECT_NOT_FOUND', 'Project not found');
      return { id, workspaceId: ws, status: archived ? 'ARCHIVED' : 'ACTIVE' };
    },
  };
  const repository = {
    transaction: (fn) => fn({}),
    async projectForWrite(_db, ws, id, actor) {
      if (ws !== workspaceId || id !== projectId || actor === strangerId) return null;
      return { status: archived ? 'ARCHIVED' : 'ACTIVE' };
    },
    async assigneeExists(_db, ws, assignee) {
      return ws === workspaceId && [ownerId, memberId].includes(assignee);
    },
    async create(_db, ws, project, actor, input) {
      const issue = { id: randomUUID(), workspaceId: ws, projectId: project, ...input, createdBy: actor, version: 1 };
      issues.set(issue.id, issue); return issue;
    },
    async get(ws, project, actor, id) {
      const issue = issues.get(id);
      return issue?.workspaceId === ws && issue.projectId === project && actor !== strangerId ? issue : null;
    },
    async list(ws, project, actor) {
      return { issues: [...issues.values()].filter((i) => i.workspaceId === ws && i.projectId === project && actor !== strangerId),
        pagination: { page: 1, limit: 20, total: issues.size } };
    },
    async update(_db, ws, project, actor, id, input) {
      const old = await this.get(ws, project, actor, id);
      if (!old || old.version !== input.expectedVersion) return null;
      const updated = { ...old, ...input, version: old.version + 1 };
      delete updated.expectedVersion;
      issues.set(id, updated); return updated;
    },
    async remove(_db, ws, project, actor, id, version) {
      const old = await this.get(ws, project, actor, id);
      if (!old || old.version !== version || actor !== ownerId) return false;
      issues.delete(id); return true;
    },
  };
  return { service: createIssueService(repository, workspace, projects), projects, setArchived: (value) => { archived = value; } };
}

const projectStub = { list: async () => ({ projects: [] }), create: async () => ({}), get: async () => ({}) };
const workspaceStub = { create: async () => ({}), list: async () => ({}), get: async () => ({}), rename: async () => ({}), members: async () => [] };

function app(f) { return createApp({ service: workspaceStub, projectService: projectStub, issueService: f.service, internalKey: secret }); }

describe('M7 issue contract and authorization', () => {
  it('rejects unknown routes/methods at Gateway allowlist', () => {
    expect(workspaceCorePath('GET', `/${workspaceId}/projects/${projectId}/issues`)).toBe(base);
    expect(workspaceCorePath('PATCH', `/${workspaceId}/projects/${projectId}/issues/${memberId}`)).toBe(`${base}/${memberId}`);
    expect(workspaceCorePath('DELETE', `/${workspaceId}/projects/${projectId}/issues/${memberId}`)).toBe(`${base}/${memberId}`);
    expect(workspaceCorePath('POST', `/${workspaceId}/projects/${projectId}/issues/${memberId}`)).toBeNull();
    expect(workspaceCorePath('GET', `/${workspaceId}/projects/invalid/issues`)).toBeNull();
  });
  it('requires internal identity and validates input', async () => {
    const f = fixture(), server = app(f);
    await request(server).get(base).expect(403);
    await request(server).get(base).set('x-forgeflow-internal-key', secret).expect(401);
    await request(server).post(base).set(headers(ownerId)).send({ title: '' }).expect(400);
    await request(server).post(base).set(headers(ownerId)).send({ title: 'Valid title', role: 'OWNER' }).expect(400);
  });
  it('allows Member create/edit, rejects foreign assignee and stale writes', async () => {
    const f = fixture();
    const created = await f.service.create(memberId, workspaceId, projectId,
      { title: 'Issue', description: '', type: 'TASK', status: 'TODO', priority: 'HIGH', assigneeId: memberId });
    await expect(f.service.create(memberId, workspaceId, projectId,
      { title: 'Not allowed', assigneeId: strangerId })).rejects.toMatchObject({ status: 400, code: 'INVALID_ASSIGNEE' });
    const updated = await f.service.update(memberId, workspaceId, projectId, created.id, { status: 'DONE', expectedVersion: 1 });
    expect(updated.version).toBe(2);
    await expect(f.service.update(memberId, workspaceId, projectId, created.id,
      { status: 'IN_PROGRESS', expectedVersion: 1 })).rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });
    await expect(f.service.get(strangerId, workspaceId, projectId, created.id)).rejects.toMatchObject({ status: 404 });
    await expect(f.service.get(ownerId, workspaceId, otherProjectId, created.id)).rejects.toMatchObject({ status: 404 });
    await expect(f.service.remove(memberId, workspaceId, projectId, created.id, 2)).rejects.toMatchObject({ status: 403 });
  });
  it('blocks writes to archived projects; Owner may soft-delete issues', async () => {
    const f = fixture(), issue = await f.service.create(ownerId, workspaceId, projectId,
      { title: 'Bug', description: '', type: 'BUG', status: 'TODO', priority: 'LOW', assigneeId: null });
    f.setArchived(true);
    await expect(f.service.update(ownerId, workspaceId, projectId, issue.id,
      { priority: 'URGENT', expectedVersion: 1 })).rejects.toMatchObject({ status: 409, code: 'PROJECT_ARCHIVED' });
    f.setArchived(false);
    await expect(f.service.remove(ownerId, workspaceId, projectId, issue.id, 1)).resolves.toBeUndefined();
  });
  it('returns structured response through Core routes', async () => {
    const f = fixture(), server = app(f);
    const created = await request(server).post(base).set(headers(memberId)).send({ title: 'M7 issue' }).expect(201);
    expect(created.body.issue.version).toBe(1);
    const read = await request(server).get(`${base}/${created.body.issue.id}`).set(headers(ownerId)).expect(200);
    expect(read.body.issue.title).toBe('M7 issue');
  });
});
