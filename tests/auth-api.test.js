import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp as createAuthApp } from '../apps/auth-service/src/app.js';
import { createApp as createGatewayApp } from '../apps/api-gateway/src/app.js';
import { issueAccessToken, verifyAccessToken } from '../shared/auth-security.js';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwt = { issuer: 'test-auth', audience: 'test-api', publicKey, privateKey };
const internalKey = 'test_internal_key_32_characters_long_123';
const bffKey = 'test_bff_key_32_characters_long_123456';

function fakeService() {
  return {
    register: vi.fn(async ({ name, email }) => ({ id: randomUUID(), name, email })),
    login: vi.fn(async () => ({ accessToken: 'server-only-token', refreshToken: 'opaque', expiresIn: 600 })),
    refresh: vi.fn(async () => ({ accessToken: 'server-only-token', refreshToken: 'new-opaque', expiresIn: 600 })),
    logout: vi.fn(async () => {}),
    currentUser: vi.fn(async () => ({ id: randomUUID(), name: 'A Test', email: 'a@test.example' })),
    forgotPassword: vi.fn(async () => {}),
    resetPassword: vi.fn(async () => {}),
  };
}

describe('Auth Service HTTP contract', () => {
  it('keeps private service routes behind an internal secret', async () => {
    await request(createAuthApp({ service: fakeService(), internalKey }))
      .post('/internal/auth/register').send({ name: 'A', email: 'a@example.test', password: 'my-long-password123' })
      .expect(403);
  });
  it('validates registration and returns safe user data', async () => {
    const app = createAuthApp({ service: fakeService(), internalKey });
    const result = await request(app).post('/internal/auth/register')
      .set('x-forgeflow-internal-key', internalKey)
      .send({ name: '  Ada  ', email: 'ADA@EXAMPLE.TEST', password: 'my-long-password123' })
      .expect(201);
    expect(result.body.user).toMatchObject({ name: 'Ada', email: 'ada@example.test' });
    expect(JSON.stringify(result.body)).not.toMatch(/password|hash/i);
    await request(app).post('/internal/auth/register')
      .set('x-forgeflow-internal-key', internalKey)
      .send({ name: '', email: 'bad', password: 'short' })
      .expect(400);
  });
  it('requires an access token to read /me', async () => {
    await request(createAuthApp({ service: fakeService(), internalKey }))
      .get('/internal/auth/me').set('x-forgeflow-internal-key', internalKey).expect(401);
  });
});

describe('JWT authentication', () => {
  it('accepts signed tokens and rejects tampering, wrong audience and expiration', () => {
    const id = randomUUID();
    const token = issueAccessToken(id, jwt, 1000);
    expect(verifyAccessToken(token, jwt, 1200).userId).toBe(id);
    expect(() => verifyAccessToken(token + 'x', jwt, 1200)).toThrow();
    expect(() => verifyAccessToken(token, { ...jwt, audience: 'another' }, 1200)).toThrow();
    expect(() => verifyAccessToken(token, jwt, 1600)).toThrow();
  });
});

describe('Gateway /api/auth routes', () => {
  function gateway({ failingRedis = false } = {}) {
    const redis = { eval: vi.fn(async () => {
      if (failingRedis) throw new Error('Redis unavailable');
      return [1, 900000];
    }) };
    const fetchImpl = vi.fn(async () => ({
      ok: true, status: 201,
      json: async () => ({ user: { id: randomUUID(), email: 'ada@example.test' } }),
    }));
    return { app: createGatewayApp({ authUrl: 'http://auth:3002', internalKey, bffKey, redis, jwt, fetchImpl }), fetchImpl };
  }
  it('accepts requests only from an authenticated BFF and forwards only allowlisted paths', async () => {
    const { app, fetchImpl } = gateway();
    await request(app).post('/api/auth/register').send({}).expect(403);
    await request(app).post('/api/auth/register').set('x-forgeflow-bff-key', bffKey)
      .send({ name: 'Ada', email: 'ada@example.test', password: 'my-long-password123' }).expect(201);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0].toString()).toBe('http://auth:3002/internal/auth/register');
    await request(app).post('/api/auth/unknown').set('x-forgeflow-bff-key', bffKey).expect(404);
  });
  it('fails closed when Redis is offline for login', async () => {
    const { app, fetchImpl } = gateway({ failingRedis: true });
    await request(app).post('/api/auth/login').set('x-forgeflow-bff-key', bffKey)
      .send({ email: 'ada@example.test', password: 'my-long-password123' }).expect(503);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('rejects invalid JWT before contacting Auth on protected routes', async () => {
    const { app, fetchImpl } = gateway();
    await request(app).get('/api/auth/me').set('x-forgeflow-bff-key', bffKey)
      .set('authorization', 'Bearer fake').expect(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
