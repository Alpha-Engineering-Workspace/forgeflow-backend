import { Router } from 'express';
import { createIssueController } from './issue.controller.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
export function createIssueRoutes(service) {
  const router = Router({ mergeParams: true });
  const c = createIssueController(service);
  router.get('/', wrap(c.list));
  router.post('/', wrap(c.create));
  router.get('/:issueId', wrap(c.get));
  router.patch('/:issueId', wrap(c.update));
  router.delete('/:issueId', wrap(c.remove));
  return router;
}
