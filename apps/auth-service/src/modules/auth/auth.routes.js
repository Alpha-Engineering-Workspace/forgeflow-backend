import { Router } from 'express';
import { fixedTimeEqual } from '../../../../../shared/auth-security.js';
import { AuthError } from './auth.errors.js';
import { createAuthController } from './auth.controller.js';

export function createAuthRoutes({ service, internalKey }) {
  if (!internalKey || internalKey.length < 32) throw new Error('AUTH_INTERNAL_KEY must be >=32 characters');
  const router = Router();
  router.use((req, _res, next) => {
    if (!fixedTimeEqual(req.get('x-forgeflow-internal-key'), internalKey)) {
      return next(new AuthError(403, 'FORBIDDEN', 'Forbidden'));
    }
    next();
  });
  const controller = createAuthController(service);
  router.post('/register', controller.register);
  router.post('/login', controller.login);
  router.post('/email/verify', controller.verifyEmail);
  router.post('/email/resend', controller.resendEmail);
  router.post('/refresh', controller.refresh);
  router.post('/logout', controller.logout);
  router.get('/me', controller.me);
  router.post('/password/forgot', controller.forgot);
  router.post('/password/reset', controller.reset);
  return router;
}
