import { createHttpApp } from '../../../shared/http.js';
import { createAuthRoutes } from './modules/auth/auth.routes.js';
import { AuthError } from './modules/auth/auth.errors.js';

// No DB or secrets needed for health-only tests. Runtime injects dependencies.
export function createApp(options = {}) {
  return createHttpApp('auth-service', (app) => {
    if (!options.service) return;
    app.use('/internal/auth', createAuthRoutes(options));
    app.use((error, req, res, next) => {
      if (!(error instanceof AuthError)) return next(error);
      res.status(error.status).json({ error: { code: error.code, message: error.message }, requestId: req.requestId });
    });
  });
}
