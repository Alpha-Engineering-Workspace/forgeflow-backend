import { createHttpApp } from '../../../shared/http.js';
import { createWorkspaceRoutes } from './modules/workspaces/workspace.routes.js';
import { WorkspaceError } from './modules/workspaces/workspace.errors.js';

export function createApp(options = {}) {
  return createHttpApp('core-service', (app) => {
    if (!options.service) return;
    app.use('/internal/workspaces', createWorkspaceRoutes(options));
    app.use((error, req, res, next) => {
      if (!(error instanceof WorkspaceError)) return next(error);
      res.status(error.status).json({ error: { code: error.code, message: error.message }, requestId: req.requestId });
    });
  });
}
