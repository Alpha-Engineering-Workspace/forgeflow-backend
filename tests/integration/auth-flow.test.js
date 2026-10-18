import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createAuthPool } from '../../apps/auth-service/src/db/pool.js';
import { createAuthRepository } from '../../apps/auth-service/src/modules/auth/auth.repository.js';
import { createAuthService } from '../../apps/auth-service/src/modules/auth/auth.service.js';
import { verifyAccessToken } from '../../shared/auth-security.js';

const pool = createAuthPool();
const repository = createAuthRepository(pool);
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwt = { issuer: 'test-auth', audience: 'test-api', publicKey, privateKey };
const delivered = [];
const service = createAuthService({ repository, jwt, sendReset: async (mail) => delivered.push(mail) });
const email = `${randomUUID()}@example.test`;
const password = 'Strong-test-password-123';

// Test writes are scoped to a unique email. Other existing users are untouched.
afterAll(async () => {
  await pool.query('DELETE FROM auth.users WHERE email = $1', [email]);
  await pool.end();
});

describe('3B-F real Auth/PostgreSQL integration', () => {
  it('registers a user without exposing its password hash', async () => {
    const user = await service.register({ name: 'Ada Example', email, password });
    expect(user).toMatchObject({ name: 'Ada Example', email });
    expect(user.password_hash).toBeUndefined();
    await expect(service.register({ name: 'Duplicate', email, password })).rejects.toMatchObject({ status: 409, code: 'EMAIL_TAKEN' });
  });
  it('rejects invalid credentials and issues a signed JWT and rotating refresh tokens', async () => {
    await expect(service.login({ email, password: 'wrong' })).rejects.toMatchObject({ status: 401 });
    const first = await service.login({ email, password });
    expect(verifyAccessToken(first.accessToken, jwt).userId).toEqual(first.user.id);
    expect((await service.currentUser(first.accessToken)).email).toEqual(email);
    const second = await service.refresh({ refreshToken: first.refreshToken });
    expect(second.refreshToken).not.toEqual(first.refreshToken);
    await expect(service.refresh({ refreshToken: first.refreshToken })).rejects.toMatchObject({ status: 401 });
    // Reuse of old token revoked the active session family as well.
    await expect(service.refresh({ refreshToken: second.refreshToken })).rejects.toMatchObject({ status: 401 });
  });
  it('revokes refresh family on logout', async () => {
    const session = await service.login({ email, password });
    await service.logout({ refreshToken: session.refreshToken });
    await expect(service.refresh({ refreshToken: session.refreshToken })).rejects.toMatchObject({ status: 401 });
  });
  it('resets a password with a single-use token and revokes all sessions', async () => {
    const previous = await service.login({ email, password });
    await service.forgotPassword({ email });
    const token = delivered.at(-1)?.token;
    expect(token).toBeTruthy();
    await service.resetPassword({ token, password: 'Replacement-password-456' });
    await expect(service.resetPassword({ token, password: 'Replacement-password-789' })).rejects.toMatchObject({ status: 400 });
    await expect(service.refresh({ refreshToken: previous.refreshToken })).rejects.toMatchObject({ status: 401 });
    await expect(service.login({ email, password })).rejects.toMatchObject({ status: 401 });
    expect((await service.login({ email, password: 'Replacement-password-456' })).user.email).toEqual(email);
  });
});
