import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp as createCoreApp } from '../apps/core-service/src/app.js';
import { createApp as createGatewayApp } from '../apps/api-gateway/src/app.js';
import { createWorkspaceService } from '../apps/core-service/src/modules/workspaces/workspace.service.js';
import { issueAccessToken } from '../shared/auth-security.js';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwt = { issuer: 'test-issuer', audience: 'test-audience', publicKey, privateKey };
const bffKey = '1234567890abcdefghijklmnopqrstuvw';
const internalKey = 'abcdefghijklmnopqrstuvwxyz123456';
const userA = randomUUID();
const userB = randomUUID();

function fakeRepo() {
  const records = new Map();
  const members = new Map();
  let failOwner = false;
  return {
    setFailOwner(value) { failOwner = value; },
    async transaction(fn) {
      // Test double verifies rollback of the business operation.
      const prevRecords = new Map(records);
      const prevMembers = new Map(members);
      try { return await fn({}); } catch (error) {
        records.clear(); members.clear();
        for (const [k, v] of prevRecords) records.set(k, v);
        for (const [k, v] of prevMembers) members.set(k, v);
        throw error;
      }
    },
    async create(_client, userId, name) {
      void _client;
      void userId;
      const row = { id: randomUUID(), name, createdAt: new Date(), updatedAt: new Date() };
      records.set(row.id, row);
      return row;
    },
    async createOwner(_client, id, userId) {
      void _client;
      if (failOwner) throw Error('simulated owner insert failure');
      members.set(`${id}:${userId}`, 'OWNER');
    },
    async list(userId, limit, offset) {
      const allowed = [...records.values()].filter((record) => members.has(`${record.id}:${userId}`));
      return { workspaces: allowed.slice(offset, offset + limit).map((record) => ({ ...record, role: members.get(`${record.id}:${userId}`) })), total: allowed.length };
    },
    async getMember(id, userId) {
      const record = records.get(id);
      const role = members.get(`${id}:${userId}`);
      return record && role ? { ...record, role } : null;
    },
    async rename(id, _userId, name) {
      const updated = { ...records.get(id), name };
      records.set(id, updated);
      return updated;
    },
    async members(id) { return [...members.entries()].filter(([key]) => key.startsWith(`${id}:`)).map(([key, role]) => ({ userId: key.split(':')[1], role })); },
    seedMember(id, userId, role) { members.set(`${id}:${userId}`, role); },
    size() { return records.size; },
  };
}

function core(repo) { return createCoreApp({ service: createWorkspaceService(repo), internalKey }); }
const headers = (uid) => ({ 'x-forgeflow-internal-key': internalKey, 'x-forgeflow-user-id': uid });

describe('Workspace RBAC and tenant scope', () => {
  it('requires private internal auth and verified identity', async () => {
    const app = core(fakeRepo());
    await request(app).get('/internal/workspaces').expect(403);
    await request(app).get('/internal/workspaces').set('x-forgeflow-internal-key', internalKey).expect(401);
  });
  it('creates owner and isolates two workspaces/users', async () => {
    const app = core(fakeRepo());
    const a = await request(app).post('/internal/workspaces').set(headers(userA)).send({ name: '   Alpha   ' }).expect(201);
    const b = await request(app).post('/internal/workspaces').set(headers(userB)).send({ name: 'Beta' }).expect(201);
    expect(a.body.workspace).toMatchObject({ name: 'Alpha', role: 'OWNER' });
    expect((await request(app).get('/internal/workspaces').set(headers(userA)).expect(200)).body.workspaces).toHaveLength(1);
    await request(app).get(`/internal/workspaces/${b.body.workspace.id}`).set(headers(userA)).expect(404);
    await request(app).patch(`/internal/workspaces/${b.body.workspace.id}`).set(headers(userA)).send({ name: 'Stolen' }).expect(404);
    await request(app).get(`/internal/workspaces/${a.body.workspace.id}/members`).set(headers(userB)).expect(404);
  });
  it('allows Owner/Admin to rename, not Member', async () => {
    const repo = fakeRepo(); const app = core(repo);
    const id = (await request(app).post('/internal/workspaces').set(headers(userA)).send({ name: 'Team' }).expect(201)).body.workspace.id;
    repo.seedMember(id, userB, 'MEMBER');
    await request(app).patch(`/internal/workspaces/${id}`).set(headers(userB)).send({ name: 'Nope' }).expect(403);
    repo.seedMember(id, userB, 'ADMIN');
    await request(app).patch(`/internal/workspaces/${id}`).set(headers(userB)).send({ name: 'Renamed' }).expect(200);
    await request(app).post('/internal/workspaces').set(headers(userA)).send({ name: '' }).expect(400);
    await request(app).get('/internal/workspaces/not-a-uuid').set(headers(userA)).expect(400);
  });
  it('rolls back workspace when owner membership insert fails', async () => {
    const repo = fakeRepo(); repo.setFailOwner(true);
    await expect(createWorkspaceService(repo).create(userA, 'Acme')).rejects.toThrow();
    expect(repo.size()).toBe(0);
  });
});

describe('Gateway workspace trust boundary', () => {
  it('rejects missing/forged JWT and forwards user identity from signed token only', async () => {
    const fetchImpl = vi.fn(async () => ({ status: 200, ok: true, json: async () => ({ workspaces: [], pagination: { page: 1, limit: 20, total: 0 } }) }));
    const app = createGatewayApp({ authUrl: 'http://auth:3002', coreUrl: 'http://core:3003', coreInternalKey: internalKey, internalKey, bffKey, jwt, redis: {}, fetchImpl });
    await request(app).get('/api/workspaces').expect(403);
    await request(app).get('/api/workspaces').set('x-forgeflow-bff-key', bffKey).expect(401);
    const access = issueAccessToken(userA, jwt);
    await request(app).get('/api/workspaces').set('x-forgeflow-bff-key', bffKey).set('authorization', `Bearer ${access}`)
      .set('x-forgeflow-user-id', userB).expect(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1].headers['x-forgeflow-user-id']).toBe(userA);
    await request(app).get('/api/workspaces').set('x-forgeflow-bff-key', bffKey)
      .set('authorization', `Bearer ${access}tamper`).expect(401);
    await request(app).post('/api/workspaces/anything/members').set('x-forgeflow-bff-key', bffKey)
      .set('authorization', `Bearer ${access}`).expect(404);
  });
});
