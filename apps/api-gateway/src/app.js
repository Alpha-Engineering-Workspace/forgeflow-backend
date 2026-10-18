import { Router } from 'express';
import { createHttpApp } from '../../../shared/http.js';
import { fixedTimeEqual, bearerToken, verifyAccessToken } from '../../../shared/auth-security.js';
import { createAuthLimiter } from './middleware/auth-limits.js';
import { createAuthProxy } from './clients/auth-client.js';

export function createApp(options = {}) {
  return createHttpApp('api-gateway', (app) => {
    if (!options.authUrl) return;
    if (!options.bffKey || options.bffKey.length < 32) throw new Error('GATEWAY_BFF_KEY must be >=32 characters');
    const router = Router();
    const limiter = createAuthLimiter(options.redis);
    const proxy = createAuthProxy(options);
    router.use((req, res, next) => {
      if (!fixedTimeEqual(req.get('x-forgeflow-bff-key'), options.bffKey)) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Forbidden' }, requestId: req.requestId });
      }
      next();
    });
    router.post('/register', proxy);
    router.post('/login', limiter, proxy);
    router.post('/refresh', proxy);
    router.post('/logout', proxy);
    router.post('/password/forgot', limiter, proxy);
    router.post('/password/reset', limiter, proxy);
    router.get('/me', (req, res, next) => {
      const token = bearerToken(req.get('authorization'));
      try { verifyAccessToken(token, options.jwt); } catch {
        return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid access token' }, requestId: req.requestId });
      }
      next();
    }, proxy);
    app.use('/api/auth', router);
  });
}
