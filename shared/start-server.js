import { logger } from "./logger.js";

/**
 * Basic signal handling for local dev. Full draining/readiness coordination
 * will be implemented and tested alongside container deployment (2C).
 */
export function startServer(app, config, serviceName) {
  const server = app.listen(config.port, config.host, () => {
    logger.info({ service: serviceName, host: config.host, port: config.port }, "service started");
  });

  const shutdown = (signal) => {
    logger.info({ service: serviceName, signal }, "shutdown requested");
    server.close((error) => {
      if (error) {
        logger.error({ service: serviceName, errorType: error.name }, "shutdown error");
        process.exitCode = 1;
      }
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return server;
}
