import { Router } from 'express';
import { createProjectController } from './project.controller.js';
const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
export function createProjectRoutes(service) {
  const router = Router({ mergeParams: true });
  const c = createProjectController(service);
  router.get('/', wrap(c.list));
  router.post('/', wrap(c.create));
  router.get('/:projectId', wrap(c.get));
  router.patch('/:projectId', wrap(c.update));
  router.post('/:projectId/archive', wrap(c.archive));
  return router;
}
