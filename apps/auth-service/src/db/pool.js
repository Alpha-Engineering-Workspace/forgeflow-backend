import pg from "pg";
import { readDbConfig } from "../../../../shared/db-config.js";

// An Auth process uses one small pool, not a new connection for every request.
export function createAuthPool(environment = process.env) {
  const config = readDbConfig("auth", environment);
  return new pg.Pool({ ...config, max: 5, idleTimeoutMillis: 10000 });
}
