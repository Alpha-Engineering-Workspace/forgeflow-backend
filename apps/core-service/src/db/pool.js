import pg from "pg";
import { readDbConfig } from "../../../../shared/db-config.js";

export function createCorePool(environment = process.env) {
  const config = readDbConfig("core", environment);
  return new pg.Pool({ ...config, max: 5, idleTimeoutMillis: 10000 });
}
