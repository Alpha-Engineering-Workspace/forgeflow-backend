import { WorkspaceError } from '../workspaces/workspace.errors.js';
import { workspaceIdSchema } from '../workspaces/workspace.schema.js';
import { inviteCreate, invitationId, inviteAccept, roleUpdate } from './invitation.schema.js';
const parse = (schema, input) => {
  const result = schema.safeParse(input);
  if (!result.success) throw new WorkspaceError(400, 'VALIDATION_ERROR', 'Invalid invitation or member request');
  return result.data;
};
export function createInvitationController(service) {
  const ids = (req) => ({ w: parse(workspaceIdSchema, req.params.workspaceId),
    id: req.params.invitationId ? parse(invitationId, req.params.invitationId) : null });
  return {
    create: async (req, res) => {
      const { w } = ids(req);
      res.status(202).json({ invitation: await service.create(req.userId, w, parse(inviteCreate, req.body)) });
    },
    list: async (req, res) => {
      const { w } = ids(req);
      res.json({ invitations: await service.list(req.userId, w) });
    },
    resend: async (req, res) => {
      const { w, id } = ids(req);
      res.status(202).json({ invitation: await service.resend(req.userId, w, id) });
    },
    cancel: async (req, res) => {
      const { w, id } = ids(req);
      res.json({ invitation: await service.cancel(req.userId, w, id) });
    },
    accept: async (req, res) => {
      const { token } = parse(inviteAccept, req.body);
      res.json({ membership: await service.accept(req.userId, req.verifiedEmail, token) });
    },
    role: async (req, res) => {
      const w = parse(workspaceIdSchema, req.params.workspaceId);
      const target = parse(workspaceIdSchema, req.params.memberId);
      res.json({ member: await service.changeRole(req.userId, w, target, parse(roleUpdate, req.body).role) });
    },
    remove: async (req, res) => {
      const w = parse(workspaceIdSchema, req.params.workspaceId);
      const target = parse(workspaceIdSchema, req.params.memberId);
      await service.remove(req.userId, w, target);
      res.status(204).end();
    },
  };
}
