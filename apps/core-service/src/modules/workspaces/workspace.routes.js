import { Router } from 'express';
import { fixedTimeEqual } from '../../../../../shared/auth-security.js';
import { WorkspaceError } from './workspace.errors.js';
import { createWorkspaceController } from './workspace.controller.js';

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

export function createWorkspaceRoutes({ service, internalKey }) {
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
    next();
  });
  const controller = createWorkspaceController(service);
  router.post('/', asyncRoute(controller.create));
  router.get('/', asyncRoute(controller.list));
  router.get('/:workspaceId', asyncRoute(controller.get));
  router.patch('/:workspaceId', asyncRoute(controller.rename));
  router.get('/:workspaceId/members', asyncRoute(controller.members));
  return router;
}
