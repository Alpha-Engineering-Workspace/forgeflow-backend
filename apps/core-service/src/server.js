import { loadServiceConfig } from '../../../shared/config.js';
import { startServer } from '../../../shared/start-server.js';
import { logger } from '../../../shared/logger.js';
import { createCorePool } from './db/pool.js';
import { createWorkspaceRepository } from './modules/workspaces/workspace.repository.js';
import { createWorkspaceService } from './modules/workspaces/workspace.service.js';
import { createApp } from './app.js';
import { createProjectRepository } from './modules/projects/project.repository.js';
import { createProjectService } from './modules/projects/project.service.js';
import { createInvitationRepository } from './modules/invitations/invitation.repository.js';
import { createInvitationService } from './modules/invitations/invitation.service.js';
import { createInvitationMailer } from './modules/invitations/invitation-mail.js';

const config = loadServiceConfig({ portVariable: 'CORE_PORT', defaultPort: 3003 });
const pool = createCorePool();
const service = createWorkspaceService(createWorkspaceRepository(pool));
const projectService = createProjectService(createProjectRepository(pool), service);
const invitationService = createInvitationService(createInvitationRepository(pool), service, createInvitationMailer());
const server = startServer(createApp({ service, projectService, invitationService,
  internalKey: process.env.CORE_INTERNAL_KEY }), config, 'core-service');
server.on('close', () => pool.end().catch((error) => {
  logger.error({ errorType: error.name }, 'Core database pool shutdown failed');
}));
