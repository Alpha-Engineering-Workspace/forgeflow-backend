import { createClient } from 'redis';
import { loadServiceConfig } from '../../../shared/config.js';
import { startServer } from '../../../shared/start-server.js';
import { logger } from '../../../shared/logger.js';
import { makeJwtConfig } from '../../../shared/auth-security.js';
import { createApp } from './app.js';

const config = loadServiceConfig({ portVariable: 'GATEWAY_PORT', defaultPort: 3001 });
const redis = createClient({ url: process.env.REDIS_URL || 'redis://127.0.0.1:6380',
  socket: { connectTimeout: 3000, reconnectStrategy: false },
});
redis.on('error', (error) => logger.warn({ errorType: error.name }, 'Redis connectivity failed'));
try { await redis.connect(); } catch { logger.warn('Redis offline: guarded Auth endpoints return 503'); }
const app = createApp({
  authUrl: process.env.AUTH_SERVICE_URL,
  internalKey: process.env.AUTH_INTERNAL_KEY,
  bffKey: process.env.GATEWAY_BFF_KEY,
  redis, jwt: makeJwtConfig(),
});
const server = startServer(app, config, 'api-gateway');
server.on('close', () => redis.quit().catch(() => redis.disconnect()));
