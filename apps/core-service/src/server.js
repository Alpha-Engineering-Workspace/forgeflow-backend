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
import { createIssueRepository } from './modules/issues/issue.repository.js';
import { createIssueService } from './modules/issues/issue.service.js';
import { createBoardRepository } from './modules/boards/board.repository.js';
import { createBoardService } from './modules/boards/board.service.js';

const config = loadServiceConfig({ portVariable: 'CORE_PORT', defaultPort: 3003 });
const pool = createCorePool();
const service = createWorkspaceService(createWorkspaceRepository(pool));
const projectService = createProjectService(createProjectRepository(pool), service);
const issueRepository = createIssueRepository(pool);
const issueService = createIssueService(issueRepository, service, projectService);
const boardService = createBoardService(createBoardRepository(pool), issueRepository, service, projectService);
const invitationService = createInvitationService(createInvitationRepository(pool), service, createInvitationMailer());
const server = startServer(createApp({ service, projectService, invitationService, issueService, boardService,
  internalKey: process.env.CORE_INTERNAL_KEY }), config, 'core-service');
server.on('close', () => pool.end().catch((error) => {
  logger.error({ errorType: error.name }, 'Core database pool shutdown failed');
}));
