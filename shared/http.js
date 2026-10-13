import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import express from "express";
import helmet from "helmet";
import { logger } from "./logger.js";

/**
 * Process skeleton only. Real readiness dependencies and authenticated
 * API routes arrive in subsequent milestones.
 */
export function createHttpApp(serviceName) {
  const app = express();
  app.disable("x-powered-by");
  // Never trust arbitrary X-Forwarded-* headers. Verified ingress policy follows.
  app.set("trust proxy", false);

  app.use(helmet());
  app.use((req, res, next) => {
    const startedAt = performance.now();
    const requestId = randomUUID();
    req.requestId = requestId;
    res.setHeader("X-Request-ID", requestId);
    res.on("finish", () => {
      logger.info({
        requestId,
        service: serviceName,
        method: req.method,
        // Log the declared route template, not raw URLs containing possible secrets.
        route: req.route?.path ?? "unmatched",
        statusCode: res.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
      }, "http request");
    });
    next();
  });

  app.use(express.json({ limit: "64kb" }));

  app.get("/health/live", (_req, res) => {
    res.json({ service: serviceName, status: "alive" });
  });
  app.get("/health/ready", (_req, res) => {
    // Only process readiness now; 2B adds PostgreSQL/Redis dependency checks.
    res.json({ service: serviceName, status: "ready", checks: "process-only" });
  });

  // Explicit 404 response after all currently registered routes.
  app.use((req, res) => {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Route not found" },
      requestId: req.requestId,
    });
  });

  // Express error middleware must have four parameters.
  app.use((error, req, res, _next) => {
    void _next;
    let status = 500;
    let code = "INTERNAL_ERROR";
    let message = "Internal server error";

    if (error?.type === "entity.too.large") {
      status = 413;
      code = "PAYLOAD_TOO_LARGE";
      message = "Request body is too large";
    } else if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
      status = 400;
      code = "INVALID_JSON";
      message = "Malformed JSON request body";
    }

    if (status === 500) {
      logger.error({ requestId: req.requestId, errorType: error?.name }, "request failed");
    }

    res.status(status).json({ error: { code, message }, requestId: req.requestId });
  });

  return app;
}
