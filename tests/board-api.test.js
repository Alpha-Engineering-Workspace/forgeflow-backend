import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../apps/core-service/src/app.js';
import { workspaceCorePath } from '../apps/api-gateway/src/clients/core-client.js';

const w = randomUUID(), p = randomUUID(), i = randomUUID(), user = randomUUID();
const key = '0123456789abcdef0123456789abcdef';
const path = `/internal/workspaces/${w}/projects/${p}/board`;
const publicPath = `/${w}/projects/${p}/board`;
const auth = { 'x-forgeflow-internal-key': key, 'x-forgeflow-user-id': user };
const move = { issueId: i, toStatus: 'DONE', targetIndex: 0,
  expectedBoardVersion: 1, expectedIssueVersion: 2 };

const wsStub = { create: vi.fn(), list: vi.fn(), get: vi.fn(), rename: vi.fn(), members: vi.fn() };
const projectStub = { create: vi.fn(), list: vi.fn(), get: vi.fn(), update: vi.fn(), archive: vi.fn() };

function server() {
  const boardService = {
    get: vi.fn(async () => ({ boardVersion: 1, projectStatus: 'ACTIVE', issues: [] })),
    move: vi.fn(async () => ({ boardVersion: 2, issue: { id: i, version: 3, status: 'DONE' } })),
  };
  return { app: createApp({ service: wsStub, projectService: projectStub,
    boardService, internalKey: key }), boardService };
}

describe('M8 board route boundaries', () => {
  it('Gateway allowlists only GET board and POST move; rejects other methods/paths', () => {
    expect(workspaceCorePath('GET', publicPath)).toBe(path);
    expect(workspaceCorePath('POST', `${publicPath}/moves`)).toBe(`${path}/moves`);
    expect(workspaceCorePath('DELETE', publicPath)).toBeNull();
    expect(workspaceCorePath('PATCH', `${publicPath}/moves`)).toBeNull();
    expect(workspaceCorePath('GET', `/${w}/projects/${p}/board/fake`)).toBeNull();
  });
  it('requires internal gateway identity and rejects malformed move DTOs', async () => {
    const { app, boardService } = server();
    await request(app).get(path).expect(403);
    await request(app).get(path).set('x-forgeflow-internal-key', key).expect(401);
    await request(app).post(`${path}/moves`).set(auth).send({ ...move, targetIndex: -1 }).expect(400);
    await request(app).post(`${path}/moves`).set(auth).send({ ...move, extraRole: 'OWNER' }).expect(400);
    await request(app).post(`${path}/moves`).set(auth).send({ ...move, toStatus: 'BLOCKED' }).expect(400);
    expect(boardService.move).not.toHaveBeenCalled();
  });
  it('returns project board and forwarded canonical move DTO', async () => {
    const { app, boardService } = server();
    const found = await request(app).get(path).set(auth).expect(200);
    expect(found.body).toMatchObject({ boardVersion: 1, projectStatus: 'ACTIVE', issues: [] });
    const changed = await request(app).post(`${path}/moves`).set(auth).send(move).expect(200);
    expect(changed.body).toMatchObject({ boardVersion: 2, issue: { id: i, version: 3 } });
    expect(boardService.move).toHaveBeenCalledWith(user, w, p, move);
  });
});
