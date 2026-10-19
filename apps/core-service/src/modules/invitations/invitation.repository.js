export function createInvitationRepository(pool) {
  const transaction = async (fn) => {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const result = await fn(db);
      await db.query('COMMIT');
      return result;
    } catch (e) { await db.query('ROLLBACK'); throw e; }
    finally { db.release(); }
  };
  const allowed = `EXISTS (SELECT 1 FROM core.workspace_members m
    WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.role IN ('OWNER','ADMIN'))`;
  return {
    transaction,
    async create(workspaceId, actor, { email, role, tokenHash, expiresAt }) {
      return transaction(async (db) => {
        const { rows } = await db.query(`
          INSERT INTO core.workspace_invitations(workspace_id,email,role,token_hash,expires_at,created_by)
          SELECT $1,$3,$4,$5,$6,$2 WHERE ${allowed}
          ON CONFLICT (workspace_id,email) WHERE status='PENDING' DO NOTHING
          RETURNING id, workspace_id AS "workspaceId", email, role, status,
            delivery_status AS "deliveryStatus", expires_at AS "expiresAt", created_at AS "createdAt"
        `, [workspaceId, actor, email, role, tokenHash, expiresAt]);
        return rows[0] ?? null;
      });
    },
    async list(workspaceId, actor) {
      const { rows } = await pool.query(`
        SELECT id, email, role, status, delivery_status AS "deliveryStatus",
          expires_at AS "expiresAt", created_at AS "createdAt"
        FROM core.workspace_invitations WHERE workspace_id=$1 AND ${allowed}
        ORDER BY created_at DESC, id DESC LIMIT 100
      `, [workspaceId, actor]);
      return rows;
    },
    async getPending(workspaceId, actor, id) {
      const { rows } = await pool.query(`
        SELECT id,email,role,status FROM core.workspace_invitations
        WHERE workspace_id=$1 AND id=$3 AND status='PENDING' AND ${allowed}
      `, [workspaceId, actor, id]);
      return rows[0] ?? null;
    },
    async resend(workspaceId, actor, id, tokenHash, expiresAt) {
      const { rows } = await pool.query(`
        UPDATE core.workspace_invitations SET token_hash=$4, expires_at=$5,
          delivery_status='PENDING', updated_at=NOW()
        WHERE workspace_id=$1 AND id=$3 AND status='PENDING' AND ${allowed}
        RETURNING id,email,role,status,delivery_status AS "deliveryStatus", expires_at AS "expiresAt"
      `, [workspaceId, actor, id, tokenHash, expiresAt]);
      return rows[0] ?? null;
    },
    async cancel(workspaceId, actor, id) {
      const { rows } = await pool.query(`
        UPDATE core.workspace_invitations SET status='CANCELED',updated_at=NOW()
        WHERE workspace_id=$1 AND id=$3 AND status='PENDING' AND ${allowed}
        RETURNING id, email, role, status
      `, [workspaceId, actor, id]);
      return rows[0] ?? null;
    },
    async delivery(id, state) {
      await pool.query(`UPDATE core.workspace_invitations SET delivery_status=$2,updated_at=NOW()
        WHERE id=$1 AND status='PENDING'`, [id, state]);
    },
    async accept(hash, userId, email) {
      return transaction(async (db) => {
        const { rows } = await db.query(`
          SELECT id,workspace_id,email,role,status,expires_at FROM core.workspace_invitations
          WHERE token_hash=$1 FOR UPDATE
        `, [hash]);
        const invite = rows[0];
        if (!invite || invite.status !== 'PENDING' || invite.email !== email || new Date(invite.expires_at) <= new Date()) {
          return { kind: 'INVALID' };
        }
        const inserted = await db.query(`
          INSERT INTO core.workspace_members(workspace_id,user_id,role)
          VALUES($1,$2,$3) ON CONFLICT (workspace_id,user_id) DO NOTHING
          RETURNING user_id AS "userId", role
        `, [invite.workspace_id, userId, invite.role]);
        if (!inserted.rowCount) return { kind: 'ALREADY_MEMBER' };
        await db.query(`UPDATE core.workspace_invitations SET status='ACCEPTED',accepted_by=$2,
          accepted_at=NOW(),updated_at=NOW() WHERE id=$1`, [invite.id, userId]);
        return { kind: 'ACCEPTED', workspaceId: invite.workspace_id, role: invite.role };
      });
    },
    async changeRole(workspaceId, actor, memberId, role) {
      return transaction(async (db) => {
        const { rows } = await db.query(`
          UPDATE core.workspace_members m SET role=$4
          WHERE m.workspace_id=$1 AND m.user_id=$3 AND m.role IN ('ADMIN','MEMBER')
            AND m.user_id<>$2 AND ${allowed}
          RETURNING user_id AS "userId",role,created_at AS "joinedAt"
        `, [workspaceId, actor, memberId, role]);
        if (rows[0] && role === 'MEMBER') {
          // Demoting an inviter revokes all still-pending invitations they issued.
          await db.query(`UPDATE core.workspace_invitations SET status='CANCELED',updated_at=NOW()
            WHERE workspace_id=$1 AND created_by=$2 AND status='PENDING'`, [workspaceId, memberId]);
        }
        return rows[0] ?? null;
      });
    },
    async remove(workspaceId, actor, memberId) {
      return transaction(async (db) => {
        const { rows } = await db.query(`
          DELETE FROM core.workspace_members m WHERE m.workspace_id=$1 AND m.user_id=$3
            AND m.role IN ('ADMIN','MEMBER') AND m.user_id<>$2 AND ${allowed}
          RETURNING user_id AS "userId",role
        `, [workspaceId, actor, memberId]);
        if (rows[0]) {
          await db.query(`UPDATE core.workspace_invitations SET status='CANCELED',updated_at=NOW()
            WHERE workspace_id=$1 AND created_by=$2 AND status='PENDING'`, [workspaceId, memberId]);
        }
        return rows[0] ?? null;
      });
    },
  };
}
