import { loadServiceConfig } from '../../../shared/config.js';
import { startServer } from '../../../shared/start-server.js';
import { logger } from '../../../shared/logger.js';
import { createCorePool } from './db/pool.js';
import { createWorkspaceRepository } from './modules/workspaces/workspace.repository.js';
import { createWorkspaceService } from './modules/workspaces/workspace.service.js';
import { createApp } from './app.js';

const config = loadServiceConfig({ portVariable: 'CORE_PORT', defaultPort: 3003 });
const pool = createCorePool();
const service = createWorkspaceService(createWorkspaceRepository(pool));
const server = startServer(createApp({ service, internalKey: process.env.CORE_INTERNAL_KEY }), config, 'core-service');
server.on('close', () => pool.end().catch((error) => {
  logger.error({ errorType: error.name }, 'Core database pool shutdown failed');
}));
