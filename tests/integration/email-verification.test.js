import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createAuthPool } from '../../apps/auth-service/src/db/pool.js';
import { createAuthRepository } from '../../apps/auth-service/src/modules/auth/auth.repository.js';
import { createAuthService, VERIFICATION_TTL_MS } from '../../apps/auth-service/src/modules/auth/auth.service.js';
import { opaqueToken, tokenHash, issueAccessToken } from '../../shared/auth-security.js';

const pool = createAuthPool();
const repository = createAuthRepository(pool);
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwt = { issuer: 'test', audience: 'test', publicKey, privateKey };
const mail = [];
const emails = [];
const service = createAuthService({ repository, jwt, sendReset: async () => {},
  sendVerification: async (m) => mail.push(m) });
const password = 'A-strong-test-password-123';
async function createUnverified() {
  const email = `${randomUUID()}@personal-domain.example`;
  emails.push(email);
  const user = await service.register({ name: 'Test User', email, password });
  return { user, email, token: mail.at(-1).token };
}
afterAll(async () => {
  for (const email of emails) await pool.query('DELETE FROM auth.users WHERE email = $1', [email]);
  await pool.end();
});

describe('Email verification integration', () => {
  it('stores only hashed 12-hour tokens, blocks login, then verifies once', async () => {
    const { user, email, token } = await createUnverified();
    expect(user.email_verified_at).toBeNull();
    expect(VERIFICATION_TTL_MS).toBe(12 * 3600000);
    const db = await pool.query(`SELECT token_hash, created_at, expires_at
      FROM auth.email_verification_tokens WHERE user_id = $1`, [user.id]);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].token_hash.trim()).toBe(tokenHash(token));
    expect(db.rows[0].expires_at - db.rows[0].created_at).toBeGreaterThan(VERIFICATION_TTL_MS - 15000);
    await expect(service.login({ email, password })).rejects.toMatchObject({ status: 403, code: 'EMAIL_NOT_VERIFIED' });
    await service.verifyEmail({ token });
    expect((await service.login({ email, password })).user.email).toBe(email);
    await expect(service.verifyEmail({ token })).rejects.toMatchObject({ status: 400 });
  });
  it('rejects expired tokens', async () => {
    const { user, token } = await createUnverified();
    await pool.query(`UPDATE auth.email_verification_tokens
      SET created_at = NOW() - INTERVAL '13 hours', expires_at = NOW() - INTERVAL '1 hour'
      WHERE user_id = $1`, [user.id]);
    await expect(service.verifyEmail({ token })).rejects.toMatchObject({ status: 400 });
  });
  it('invalidates old tokens on resend and returns no mail for unknown accounts', async () => {
    const { email, token } = await createUnverified();
    await service.resendEmail({ email });
    const newToken = mail.at(-1).token;
    expect(newToken).not.toBe(token);
    await expect(service.verifyEmail({ token })).rejects.toMatchObject({ status: 400 });
    await service.verifyEmail({ token: newToken });
    const count = mail.length;
    await service.resendEmail({ email });
    await service.resendEmail({ email: `unknown-${randomUUID()}@example.test` });
    expect(mail).toHaveLength(count);
  });
  it('rejects old unverified refresh sessions and access tokens', async () => {
    const { user } = await createUnverified();
    const refreshToken = opaqueToken();
    await repository.transaction(async (db) => repository.createSession(db, {
      userId: user.id, familyId: randomUUID(), tokenHash: tokenHash(refreshToken),
      expiresAt: new Date(Date.now() + 86400000),
    }));
    await expect(service.refresh({ refreshToken })).rejects.toMatchObject({ status: 401 });
    await expect(service.currentUser(issueAccessToken(user.id, jwt))).rejects.toMatchObject({ status: 401 });
  });
});
