import { Router } from 'express';
import { createHttpApp } from '../../../shared/http.js';
import { fixedTimeEqual, bearerToken, verifyAccessToken } from '../../../shared/auth-security.js';
import { createAuthLimiter } from './middleware/auth-limits.js';
import { createAuthProxy } from './clients/auth-client.js';
import { createCoreProxy } from './clients/core-client.js';
import { createInvitationLimiter } from './middleware/invitation-limits.js';

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
    router.post('/register', limiter, proxy);
    router.post('/email/verify', limiter, proxy);
    router.post('/email/resend', limiter, proxy);
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

    if (options.coreUrl) {
      const coreProxy = createCoreProxy(options);
      const workspaceRouter = Router();
      workspaceRouter.use((req, res, next) => {
        if (!fixedTimeEqual(req.get('x-forgeflow-bff-key'), options.bffKey)) {
          return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Forbidden' }, requestId: req.requestId });
        }
        let verified;
        try { verified = verifyAccessToken(bearerToken(req.get('authorization')), options.jwt); } catch {
          return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid access token' }, requestId: req.requestId });
        }
        req.userId = verified.userId; // ignore forged x-forgeflow-user-id from caller
        // Accepting an invite needs a *fresh verified email* from Auth, not browser JSON.
        if (req.path !== '/invitations/accept') return next();
        if (!options.internalKey || options.internalKey.length < 32) {
          return res.status(503).json({ error: { code: 'IDENTITY_UNAVAILABLE', message: 'Identity unavailable' } });
        }
        (async () => {
          try {
            const response = await (options.fetchImpl ?? fetch)(new URL('/internal/auth/me', options.authUrl), {
              method: 'GET', headers: { 'x-forgeflow-internal-key': options.internalKey,
                authorization: req.get('authorization') }, signal: AbortSignal.timeout(5000),
            });
            if (!response.ok) return res.status(503).json({ error: { code: 'IDENTITY_UNAVAILABLE', message: 'Identity unavailable' } });
            const data = await response.json();
            const u = data?.user;
            if (u?.id !== req.userId || !u?.email_verified_at || typeof u.email !== 'string' ||
                !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email) || u.email.length > 254) {
              return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Verified email required' } });
            }
            req.verifiedEmail = u.email.trim().toLowerCase();
            next();
          } catch { return res.status(503).json({ error: { code: 'IDENTITY_UNAVAILABLE', message: 'Identity unavailable' } }); }
        })();
      });
      workspaceRouter.use(createInvitationLimiter(options.redis));
      workspaceRouter.use(coreProxy);
      app.use('/api/workspaces', workspaceRouter);
    }
  });
}
