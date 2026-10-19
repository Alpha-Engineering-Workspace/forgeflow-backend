import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../apps/core-service/src/app.js';
import { createProjectService } from '../apps/core-service/src/modules/projects/project.service.js';
import { workspaceCorePath } from '../apps/api-gateway/src/clients/core-client.js';

const w = randomUUID(); const foreign = randomUUID();
const owner = randomUUID(); const member = randomUUID(); const outsider = randomUUID();
const key = 'abcdefghijklmnopqrstuvwxyz012345';
const identity = (user) => ({ 'x-forgeflow-internal-key': key, 'x-forgeflow-user-id': user });

function fixture() {
  const rows = new Map();
  const role = new Map([[`${w}/${owner}`, 'OWNER'], [`${w}/${member}`, 'MEMBER']]);
  const workspaces = {
    async authorize(user, ws, allowed) {
      const actual = role.get(`${ws}/${user}`);
      if (!actual) throw Object.assign(Error('not found'), { status: 404 });
      if (allowed && !allowed.includes(actual)) throw Object.assign(Error('forbidden'), { status: 403 });
      return { id: ws, role: actual };
    },
  };
  const repo = {
    async create(ws, user, input) {
      if (!['OWNER','ADMIN'].includes(role.get(`${ws}/${user}`))) return null;
      const row = { id: randomUUID(), workspaceId: ws, ...input, status: 'ACTIVE', version: 1 };
      rows.set(row.id, row); return row;
    },
    async list(ws, user, { page, limit, status }) {
      const projects = [...rows.values()].filter((p) => p.workspaceId === ws && p.status === status && role.has(`${ws}/${user}`));
      return { projects: projects.slice((page-1)*limit, page*limit), pagination: { page, limit, total: projects.length } };
    },
    async get(ws, user, id) { const p = rows.get(id); return p?.workspaceId === ws && role.has(`${ws}/${user}`) ? p : null; },
    async update(ws, user, id, input) {
      const p = await this.get(ws, user, id);
      if (!p || p.version !== input.expectedVersion || p.status !== 'ACTIVE' || !['OWNER','ADMIN'].includes(role.get(`${ws}/${user}`))) return null;
      const updated = { ...p, name: input.name, description: input.description, version: p.version+1 };
      rows.set(id, updated); return updated;
    },
    async archive(ws, user, id, version) {
      const p = await this.get(ws, user, id);
      if (!p || p.version !== version || p.status !== 'ACTIVE' || !['OWNER','ADMIN'].includes(role.get(`${ws}/${user}`))) return null;
      const updated = { ...p, status: 'ARCHIVED', version: p.version+1 };
      rows.set(id, updated); return updated;
    },
  };
  const projects = createProjectService(repo, workspaces);
  return { projects, role };
}

describe('M6 Projects: tenant and role guards', () => {
  it('denies missing membership, member writes and cross-workspace IDs', async () => {
    const { projects } = fixture();
    await expect(projects.create(outsider, w, { name: 'Stolen', description: '' })).rejects.toMatchObject({ status: 404 });
    await expect(projects.create(member, w, { name: 'Unauthorized', description: '' })).rejects.toMatchObject({ status: 403 });
    const p = await projects.create(owner, w, { name: 'Demo', description: '' });
    expect((await projects.list(member, w, { page: 1, limit: 20, status: 'ACTIVE' })).projects).toHaveLength(1);
    await expect(projects.get(owner, foreign, p.id)).rejects.toMatchObject({ status: 404 });
    await expect(projects.get(outsider, w, p.id)).rejects.toMatchObject({ status: 404 });
    await expect(projects.update(member, w, p.id, { name: 'Hacked', description: '', expectedVersion: 1 })).rejects.toMatchObject({ status: 403 });
  });
  it('returns 409 for stale and archived mutations', async () => {
    const { projects } = fixture();
    const p = await projects.create(owner, w, { name: 'Demo', description: '' });
    const updated = await projects.update(owner, w, p.id, { name: 'Updated', description: 'New', expectedVersion: 1 });
    expect(updated.version).toBe(2);
    await expect(projects.update(owner, w, p.id, { name: 'Race', description: '', expectedVersion: 1 })).rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });
    const archived = await projects.archive(owner, w, p.id, 2);
    expect(archived.status).toBe('ARCHIVED');
    await expect(projects.archive(owner, w, p.id, 2)).rejects.toMatchObject({ status: 409 });
    await expect(projects.update(owner, w, p.id, { name: 'Bad', description: '', expectedVersion: 3 })).rejects.toMatchObject({ status: 409, code: 'PROJECT_ARCHIVED' });
  });
  it('Gateway only allows known scoped paths and methods', () => {
    expect(workspaceCorePath('GET', `/${w}/projects`)).toBe(`/internal/workspaces/${w}/projects`);
    expect(workspaceCorePath('POST', `/${w}/projects/${foreign}/archive`)).toBe(`/internal/workspaces/${w}/projects/${foreign}/archive`);
    expect(workspaceCorePath('DELETE', `/${w}/projects/${foreign}`)).toBeNull();
    expect(workspaceCorePath('GET', '/not-a-uuid/projects')).toBeNull();
    expect(workspaceCorePath('POST', '/invitations/accept')).toBe('/internal/workspaces/invitations/accept');
  });
  it('Core rejects direct calls without Gateway private key', async () => {
    const fake = { create: () => {}, list: () => {}, get: () => {}, rename: () => {}, members: () => {} };
    const app = createApp({ service: fake, projectService: fixture().projects, internalKey: key });
    await request(app).get(`/internal/workspaces/${w}/projects`).expect(403);
    await request(app).get(`/internal/workspaces/${w}/projects`).set('x-forgeflow-internal-key', key).expect(401);
    await request(app).post(`/internal/workspaces/${w}/projects`).set(identity(owner)).send({ name: '' }).expect(400);
  });
});
