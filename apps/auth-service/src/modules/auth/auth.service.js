import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import { opaqueToken, tokenHash, issueAccessToken, verifyAccessToken } from '../../../../../shared/auth-security.js';
import { AuthError, invalidCredentials, invalidSession } from './auth.errors.js';
import { logger } from '../../../../../shared/logger.js';

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 15 * 60 * 1000;
export const VERIFICATION_TTL_MS = 12 * 60 * 60 * 1000;

export function createAuthService({ repository, jwt, sendReset, sendVerification,
  hashPassword = (password) => bcrypt.hash(password, 12),
  checkPassword = (password, hash) => bcrypt.compare(password, hash) }) {
  let dummyHashPromise;

  function requireMail() {
    if (typeof sendVerification !== 'function' || sendVerification.configured === false) {
      throw new AuthError(503, 'EMAIL_DELIVERY_UNAVAILABLE', 'Email verification temporarily unavailable');
    }
  }
  async function sendAfterCommit(email, token) {
    try { await sendVerification({ email, token }); }
    catch (error) { logger.error({ errorType: error.name }, 'Verification email delivery failed'); }
  }

  return {
    async register({ name, email, password }) {
      requireMail();
      const hash = await hashPassword(password);
      const token = opaqueToken();
      let user;
      try {
        user = await repository.transaction(async (db) => {
          const created = await repository.createUser({ name, email, passwordHash: hash }, db);
          await repository.createVerification(db, { userId: created.id, hash: tokenHash(token),
            expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS) });
          return created;
        });
      } catch (error) {
        if (error.code === '23505') throw new AuthError(409, 'EMAIL_TAKEN', 'Email is already registered');
        throw error;
      }
      await sendAfterCommit(user.email, token);
      return user;
    },
    async resendEmail({ email }) {
      requireMail();
      const existing = await repository.findByEmail(email);
      if (!existing || existing.email_verified_at) return; // Generic 202 regardless of existence.
      const token = opaqueToken();
      const to = await repository.transaction(async (db) => {
        const user = await repository.lockUserVerification(db, existing.id);
        if (!user || user.email_verified_at) return null;
        await repository.invalidateVerifications(db, user.id);
        await repository.createVerification(db, { userId: user.id, hash: tokenHash(token),
          expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS) });
        return user.email;
      });
      if (to) await sendAfterCommit(to, token);
    },
    async verifyEmail({ token }) {
      const hash = tokenHash(token);
      const verified = await repository.transaction(async (db) => {
        // Lock user BEFORE token, matching resend's lock order.
        const userId = await repository.findVerificationUserId(db, hash);
        if (!userId) return false;
        const user = await repository.lockUserVerification(db, userId);
        if (!user || user.email_verified_at) return false;
        const record = await repository.lockVerification(db, hash);
        if (!record || record.used_at || new Date(record.expires_at) <= new Date()) return false;
        await repository.markVerified(db, userId);
        await repository.invalidateVerifications(db, userId);
        return true;
      });
      if (!verified) throw new AuthError(400, 'INVALID_VERIFICATION_TOKEN', 'Verification link invalid or expired');
    },
    async login({ email, password }) {
      const user = await repository.findByEmail(email);
      const hash = user?.password_hash ?? await (dummyHashPromise ??= hashPassword('nonexistent-user-dummy-password'));
      const matches = await checkPassword(password, hash);
      if (!user || !matches) throw invalidCredentials();
      if (!user.email_verified_at) throw new AuthError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email before signing in');
      const refreshToken = opaqueToken();
      await repository.transaction(async (db) => {
        await repository.createSession(db, { userId: user.id, familyId: randomUUID(),
          tokenHash: tokenHash(refreshToken), expiresAt: new Date(Date.now() + REFRESH_TTL_MS) });
      });
      return { accessToken: issueAccessToken(user.id, jwt), refreshToken, expiresIn: 600, tokenType: 'Bearer',
        user: { id: user.id, name: user.name, email: user.email } };
    },
    async refresh({ refreshToken }) {
      const nextToken = opaqueToken();
      const result = await repository.transaction(async (db) => {
        const session = await repository.lockSession(db, tokenHash(refreshToken));
        if (!session) return null;
        if (session.rotated_at) { await repository.revokeFamily(db, session.family_id); return null; }
        if (session.revoked_at || new Date(session.expires_at) <= new Date()) return null;
        const user = await repository.findById(session.user_id, db);
        if (!user?.email_verified_at) { await repository.revokeFamily(db, session.family_id); return null; }
        const nextId = await repository.createSession(db, { userId: session.user_id, familyId: session.family_id,
          tokenHash: tokenHash(nextToken), expiresAt: new Date(Date.now() + REFRESH_TTL_MS) });
        await repository.rotateSession(db, session.id, nextId);
        return { userId: session.user_id };
      });
      if (!result) throw invalidSession();
      return { accessToken: issueAccessToken(result.userId, jwt), refreshToken: nextToken,
        expiresIn: 600, tokenType: 'Bearer' };
    },
    async logout({ refreshToken }) {
      await repository.transaction(async (db) => {
        const session = await repository.lockSession(db, tokenHash(refreshToken));
        if (session) await repository.revokeFamily(db, session.family_id);
      });
    },
    async currentUser(accessToken) {
      let identity;
      try { identity = verifyAccessToken(accessToken, jwt); } catch { throw invalidSession(); }
      const user = await repository.findById(identity.userId);
      if (!user?.email_verified_at) throw invalidSession();
      return user;
    },
    async forgotPassword({ email }) {
      const user = await repository.findByEmail(email);
      if (!user) return;
      const token = opaqueToken();
      await repository.transaction(async (db) => {
        await repository.createReset(db, { userId: user.id, hash: tokenHash(token),
          expiresAt: new Date(Date.now() + RESET_TTL_MS) });
      });
      try { await sendReset({ email: user.email, token }); }
      catch (error) { logger.error({ errorType: error.name }, 'Password reset delivery failed'); }
    },
    async resetPassword({ token, password }) {
      const hash = await hashPassword(password);
      const done = await repository.transaction(async (db) => {
        const reset = await repository.lockReset(db, tokenHash(token));
        if (!reset || reset.used_at || new Date(reset.expires_at) <= new Date()) return false;
        await repository.updatePasswordAndRevokeSessions(db, reset.user_id, hash);
        return true;
      });
      if (!done) throw new AuthError(400, 'INVALID_RESET_TOKEN', 'Reset token is invalid or expired');
    },
  };
}
