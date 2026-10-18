import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import { opaqueToken, tokenHash, issueAccessToken, verifyAccessToken } from '../../../../../shared/auth-security.js';
import { AuthError, invalidCredentials, invalidSession } from './auth.errors.js';
import { logger } from '../../../../../shared/logger.js';

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 15 * 60 * 1000;

export function createAuthService({ repository, jwt, sendReset, hashPassword = (password) => bcrypt.hash(password, 12),
  checkPassword = (password, hash) => bcrypt.compare(password, hash) }) {
  let dummyHashPromise;
  return {
    async register({ name, email, password }) {
      const passwordHash = await hashPassword(password);
      try {
        return await repository.createUser({ name, email, passwordHash });
      } catch (error) {
        if (error.code === '23505') throw new AuthError(409, 'EMAIL_TAKEN', 'Email is already registered');
        throw error;
      }
    },
    async login({ email, password }) {
      const user = await repository.findByEmail(email);
      // Keep an expensive password verification even for unknown emails.
      const hash = user?.password_hash ?? await (dummyHashPromise ??= hashPassword('nonexistent-user-dummy-password'));
      const matches = await checkPassword(password, hash);
      if (!user || !matches) throw invalidCredentials();
      const refreshToken = opaqueToken();
      await repository.transaction(async (db) => {
        await repository.createSession(db, {
          userId: user.id, familyId: randomUUID(), tokenHash: tokenHash(refreshToken),
          expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        });
      });
      const accessToken = issueAccessToken(user.id, jwt);
      return { accessToken, refreshToken, expiresIn: 600, tokenType: 'Bearer',
        user: { id: user.id, name: user.name, email: user.email } };
    },
    async refresh({ refreshToken }) {
      const newRefreshToken = opaqueToken();
      const outcome = await repository.transaction(async (db) => {
        const session = await repository.lockSession(db, tokenHash(refreshToken));
        if (!session) return null;
        if (session.rotated_at) {
          // Detected replay: revoke ALL tokens in this login family.
          await repository.revokeFamily(db, session.family_id);
          return null;
        }
        if (session.revoked_at || new Date(session.expires_at) <= new Date()) return null;
        const nextId = await repository.createSession(db, {
          userId: session.user_id, familyId: session.family_id, tokenHash: tokenHash(newRefreshToken),
          expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        });
        await repository.rotateSession(db, session.id, nextId);
        return { userId: session.user_id };
      });
      if (!outcome) throw invalidSession();
      return { accessToken: issueAccessToken(outcome.userId, jwt),
        refreshToken: newRefreshToken, expiresIn: 600, tokenType: 'Bearer' };
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
      if (!user) throw invalidSession();
      return user;
    },
    async forgotPassword({ email }) {
      const user = await repository.findByEmail(email);
      if (!user) return;
      const token = opaqueToken();
      await repository.transaction(async (db) => {
        await repository.createReset(db, {
          userId: user.id, hash: tokenHash(token), expiresAt: new Date(Date.now() + RESET_TTL_MS),
        });
      });
      // Local/test mail transport only; never return recovery tokens to the caller.
      try {
        await sendReset({ email: user.email, token });
      } catch (error) {
        // Do not reveal registered emails through different HTTP statuses.
        logger.error({ errorType: error.name }, 'Password reset delivery failed');
      }
    },
    async resetPassword({ token, password }) {
      const hash = await hashPassword(password);
      const didReset = await repository.transaction(async (db) => {
        const reset = await repository.lockReset(db, tokenHash(token));
        if (!reset || reset.used_at || new Date(reset.expires_at) <= new Date()) return false;
        await repository.updatePasswordAndRevokeSessions(db, reset.user_id, hash);
        return true;
      });
      if (!didReset) throw new AuthError(400, 'INVALID_RESET_TOKEN', 'Reset token is invalid or expired');
    },
  };
}
