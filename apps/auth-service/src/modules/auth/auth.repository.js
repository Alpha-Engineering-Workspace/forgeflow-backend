// No SQL outside repositories. A transaction uses exactly one checked-out pg client.
const safeUserFields = 'id, name, email, email_verified_at, created_at, updated_at';

export function createAuthRepository(pool) {
  return {
    async findByEmail(email, db = pool) {
      const result = await db.query('SELECT id, name, email, password_hash, email_verified_at FROM auth.users WHERE email = $1', [email]);
      return result.rows[0] || null;
    },
    async findById(id, db = pool) {
      const result = await db.query(`SELECT ${safeUserFields} FROM auth.users WHERE id = $1`, [id]);
      return result.rows[0] || null;
    },
    async createUser({ name, email, passwordHash }, db = pool) {
      const result = await db.query(
        `INSERT INTO auth.users (name, email, password_hash) VALUES ($1, $2, $3)
         RETURNING ${safeUserFields}`,
        [name, email, passwordHash]
      );
      return result.rows[0];
    },
    async transaction(callback) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async lockUserVerification(db, userId) {
      const result = await db.query('SELECT id, email, email_verified_at FROM auth.users WHERE id = $1 FOR UPDATE', [userId]);
      return result.rows[0] ?? null;
    },
    async createVerification(db, { userId, hash, expiresAt }) {
      await db.query(`INSERT INTO auth.email_verification_tokens (user_id, token_hash, expires_at)
        VALUES ($1,$2,$3)`, [userId, hash, expiresAt]);
    },
    async invalidateVerifications(db, userId) {
      await db.query(`UPDATE auth.email_verification_tokens SET used_at = COALESCE(used_at, NOW())
        WHERE user_id = $1 AND used_at IS NULL`, [userId]);
    },
    async findVerificationUserId(db, hash) {
      const result = await db.query('SELECT user_id FROM auth.email_verification_tokens WHERE token_hash = $1', [hash]);
      return result.rows[0]?.user_id ?? null;
    },
    async lockVerification(db, hash) {
      const result = await db.query('SELECT * FROM auth.email_verification_tokens WHERE token_hash = $1 FOR UPDATE', [hash]);
      return result.rows[0] ?? null;
    },
    async markVerified(db, userId) {
      await db.query('UPDATE auth.users SET email_verified_at = NOW(), updated_at = NOW() WHERE id = $1 AND email_verified_at IS NULL', [userId]);
    },
    async createSession(db, { userId, familyId, tokenHash, expiresAt }) {
      const result = await db.query(
        `INSERT INTO auth.refresh_sessions (user_id, family_id, token_hash, expires_at)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [userId, familyId, tokenHash, expiresAt]
      );
      return result.rows[0].id;
    },
    async lockSession(db, hash) {
      const result = await db.query('SELECT * FROM auth.refresh_sessions WHERE token_hash = $1 FOR UPDATE', [hash]);
      return result.rows[0] ?? null;
    },
    async rotateSession(db, oldId, newId) {
      await db.query('UPDATE auth.refresh_sessions SET rotated_at = NOW(), replaced_by = $2 WHERE id = $1', [oldId, newId]);
    },
    async revokeFamily(db, familyId) {
      await db.query('UPDATE auth.refresh_sessions SET revoked_at = COALESCE(revoked_at, NOW()) WHERE family_id = $1', [familyId]);
    },
    async createReset(db, { userId, hash, expiresAt }) {
      await db.query(
        'INSERT INTO auth.password_resets (user_id, token_hash, expires_at) VALUES ($1,$2,$3)',
        [userId, hash, expiresAt]
      );
    },
    async lockReset(db, hash) {
      const result = await db.query('SELECT * FROM auth.password_resets WHERE token_hash = $1 FOR UPDATE', [hash]);
      return result.rows[0] ?? null;
    },
    async updatePasswordAndRevokeSessions(db, userId, hash) {
      await db.query('UPDATE auth.users SET password_hash = $2, updated_at = NOW() WHERE id = $1', [userId, hash]);
      await db.query('UPDATE auth.refresh_sessions SET revoked_at = COALESCE(revoked_at, NOW()) WHERE user_id = $1', [userId]);
      await db.query('UPDATE auth.password_resets SET used_at = COALESCE(used_at, NOW()) WHERE user_id = $1 AND used_at IS NULL', [userId]);
    },
  };
}
