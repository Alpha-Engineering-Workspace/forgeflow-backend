import { createHash, randomBytes } from 'node:crypto';
import { WorkspaceError } from '../workspaces/workspace.errors.js';
const TOKEN_TTL = 7 * 24 * 60 * 60 * 1000;
const hashToken = (token) => createHash('sha256').update(token).digest('hex');
const publicInvite = (i) => ({ id:i.id, email:i.email, role:i.role, status:i.status,
  deliveryStatus:i.deliveryStatus, expiresAt:i.expiresAt, createdAt:i.createdAt });
function error(status, code, message) { throw new WorkspaceError(status, code, message); }
function newToken() { return randomBytes(32).toString('base64url'); }

export function createInvitationService(repository, workspaces, mailer) {
  const auth = (actor, id) => workspaces.authorize(actor, id, ['OWNER', 'ADMIN']);
  async function send(record, token, workspaceName) {
    let state = 'SENT';
    try { await mailer.send({ email: record.email, token, workspaceName }); }
    catch { state = 'FAILED'; }
    await repository.delivery(record.id, state);
    return publicInvite({ ...record, deliveryStatus: state });
  }
  return {
    async create(actor, workspaceId, input) {
      const workspace = await auth(actor, workspaceId);
      if (!mailer.ready()) error(503, 'EMAIL_UNAVAILABLE', 'Invitations cannot be delivered right now');
      const token = newToken();
      const row = await repository.create(workspaceId, actor, {
        ...input, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + TOKEN_TTL),
      });
      if (!row) error(409, 'INVITE_CONFLICT', 'A pending invitation exists for that email');
      return send(row, token, workspace.name);
    },
    async list(actor, workspaceId) {
      await auth(actor, workspaceId);
      return repository.list(workspaceId, actor);
    },
    async resend(actor, workspaceId, id) {
      const workspace = await auth(actor, workspaceId);
      if (!mailer.ready()) error(503, 'EMAIL_UNAVAILABLE', 'Invitations cannot be delivered right now');
      const token = newToken();
      const record = await repository.resend(workspaceId, actor, id, hashToken(token), new Date(Date.now() + TOKEN_TTL));
      if (!record) error(404, 'INVITATION_NOT_FOUND', 'Invitation not found');
      return send(record, token, workspace.name);
    },
    async cancel(actor, workspaceId, id) {
      await auth(actor, workspaceId);
      return (await repository.cancel(workspaceId, actor, id)) ?? error(404, 'INVITATION_NOT_FOUND', 'Invitation not found');
    },
    async accept(userId, verifiedEmail, token) {
      // The verified email MUST be resolved by Gateway from Auth /me, never from request body.
      if (!verifiedEmail || typeof verifiedEmail !== 'string') error(401, 'UNAUTHORIZED', 'Verified identity required');
      const result = await repository.accept(hashToken(token), userId, verifiedEmail.trim().toLowerCase());
      if (result.kind === 'INVALID') error(400, 'INVALID_INVITATION', 'Invitation expired, used, or not for this account');
      if (result.kind === 'ALREADY_MEMBER') error(409, 'ALREADY_MEMBER', 'Already a workspace member');
      return { workspaceId: result.workspaceId, role: result.role };
    },
    async changeRole(actor, workspaceId, target, role) {
      await auth(actor, workspaceId);
      if (actor === target) error(403, 'SELF_ROLE_CHANGE', 'Cannot change your own role');
      return (await repository.changeRole(workspaceId, actor, target, role)) ?? error(403, 'MEMBER_PROTECTED', 'Member cannot be changed');
    },
    async remove(actor, workspaceId, target) {
      await auth(actor, workspaceId);
      if (actor === target) error(403, 'SELF_REMOVE', 'Cannot remove yourself');
      return (await repository.remove(workspaceId, actor, target)) ?? error(403, 'MEMBER_PROTECTED', 'Member cannot be removed');
    },
  };
}
