import { Router } from 'express';
import { fixedTimeEqual } from '../../../../../shared/auth-security.js';
import { z } from 'zod';
import { WorkspaceError } from './workspace.errors.js';
import { createWorkspaceController } from './workspace.controller.js';
import { createProjectRoutes } from '../projects/project.routes.js';
import { createInvitationController } from '../invitations/invitation.controller.js';

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

export function createWorkspaceRoutes({ service, projectService, invitationService, issueService, boardService, summaryService, internalKey }) {
  if (!internalKey || internalKey.length < 32) throw new Error('CORE_INTERNAL_KEY must be >= 32 characters');
  const router = Router();
  router.use((req, _res, next) => {
    if (!fixedTimeEqual(req.get('x-forgeflow-internal-key'), internalKey)) {
      return next(new WorkspaceError(403, 'FORBIDDEN', 'Forbidden'));
    }
    const id = req.get('x-forgeflow-user-id');
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return next(new WorkspaceError(401, 'UNAUTHORIZED', 'Authentication required'));
    }
    req.userId = id;
    // Only Gateway has the internal key and may forward the Auth-verified identity.
    req.verifiedEmail = req.get('x-forgeflow-verified-email') || null;
    next();
  });
  const controller = createWorkspaceController(service);
  const invitation = invitationService ? createInvitationController(invitationService) : null;
  if (invitation) router.post('/invitations/accept', asyncRoute(invitation.accept));
  router.post('/', asyncRoute(controller.create));
  router.get('/', asyncRoute(controller.list));
  router.get('/:workspaceId', asyncRoute(controller.get));
  router.patch('/:workspaceId', asyncRoute(controller.rename));
  router.get('/:workspaceId/members', asyncRoute(controller.members));
  if (summaryService) router.get('/:workspaceId/summary', asyncRoute(async (req, res) => {
    const parsed = z.uuid().safeParse(req.params.workspaceId);
    if (!parsed.success) throw new WorkspaceError(400, 'VALIDATION_ERROR', 'Invalid workspace');
    res.set('Cache-Control', 'no-store');
    res.json(await summaryService.get(req.userId, parsed.data));
  }));
  if (projectService) router.use('/:workspaceId/projects', createProjectRoutes(projectService, issueService, boardService));
  if (invitation) {
    router.get('/:workspaceId/invitations', asyncRoute(invitation.list));
    router.post('/:workspaceId/invitations', asyncRoute(invitation.create));
    router.post('/:workspaceId/invitations/:invitationId/resend', asyncRoute(invitation.resend));
    router.post('/:workspaceId/invitations/:invitationId/cancel', asyncRoute(invitation.cancel));
    router.patch('/:workspaceId/members/:memberId', asyncRoute(invitation.role));
    router.delete('/:workspaceId/members/:memberId', asyncRoute(invitation.remove));
  }
  return router;
}
