import { Router } from 'express';
import { createBoardController } from './board.controller.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
export function createBoardRoutes(service) {
  const router = Router({ mergeParams: true });
  const c = createBoardController(service);
  router.get('/', wrap(c.get));
  router.post('/moves', wrap(c.move));
  return router;
}
