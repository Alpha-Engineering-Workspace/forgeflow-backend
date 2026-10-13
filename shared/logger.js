import pino from "pino";

/** Do not put credentials, raw tokens, or request bodies in logs. */
export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers.set-cookie",
  ],
});
