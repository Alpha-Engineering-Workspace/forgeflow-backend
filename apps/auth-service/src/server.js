import { loadServiceConfig } from '../../../shared/config.js';
import { startServer } from '../../../shared/start-server.js';
import { logger } from '../../../shared/logger.js';
import { makeJwtConfig } from '../../../shared/auth-security.js';
import { createAuthPool } from './db/pool.js';
import { createAuthRepository } from './modules/auth/auth.repository.js';
import { createAuthService } from './modules/auth/auth.service.js';
import { createResetSender } from './modules/auth/reset-mail.js';
import { createVerificationSender } from './modules/auth/verification-mail.js';
import { createApp } from './app.js';

const config = loadServiceConfig({ portVariable: 'AUTH_PORT', defaultPort: 3002 });
const pool = createAuthPool();
const service = createAuthService({
  repository: createAuthRepository(pool),
  jwt: makeJwtConfig(process.env, true),
  sendReset: createResetSender(),
  sendVerification: createVerificationSender(),
});
const server = startServer(createApp({ service, internalKey: process.env.AUTH_INTERNAL_KEY }), config, 'auth-service');
server.on('close', () => pool.end().catch((error) => {
  logger.error({ errorType: error.name }, 'Auth database pool shutdown failed');
}));
