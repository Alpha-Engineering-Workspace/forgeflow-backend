
import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createClient } from "redis";
import { createAuthPool } from "../../apps/auth-service/src/db/pool.js";
import { createCorePool } from "../../apps/core-service/src/db/pool.js";
import { readDbConfig } from "../../shared/db-config.js";

const authPool = createAuthPool();
const corePool = createCorePool();

const migratorPool = new pg.Pool({
  ...readDbConfig("migrator"),
  max: 1,
});

const redisClient = createClient({
  url: process.env.REDIS_URL || "redis://127.0.0.1:6380",
  socket: {
    connectTimeout: 3000,
    reconnectStrategy: false,
  },
});

redisClient.on("error", () => {});

// Close database connections and Redis after all tests.
afterAll(async () => {
  await Promise.all([
    authPool.end(),
    corePool.end(),
    migratorPool.end(),
    redisClient.isOpen
      ? redisClient.quit()
      : Promise.resolve(),
  ]);
});

describe("Database and Redis infrastructure", () => {
  it("has required migrations and two owned schemas", async () => {
    // Read applied migration names instead of counting them.
    const history = await migratorPool.query(`
      SELECT name
      FROM public.pgmigrations
    `);

    const appliedMigrations = history.rows.map(
      (row) => row.name
    );

    // Future migrations should not break this test.
    expect(appliedMigrations).toEqual(
      expect.arrayContaining([
        "001_create_service_schemas",
        "002_create_auth_users",
      ])
    );

    // Verify that both service schemas exist.
    const result = await migratorPool.query(`
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name IN ('auth', 'core')
      ORDER BY schema_name
    `);

    expect(
      result.rows.map((row) => row.schema_name)
    ).toEqual(["auth", "core"]);
  });

  it("uses a restricted Auth role which cannot use Core schema", async () => {
    const result = await authPool.query(`
      SELECT
        current_user AS username,
        has_schema_privilege(
          current_user, 'auth', 'USAGE'
        ) AS own_schema,
        has_schema_privilege(
          current_user, 'core', 'USAGE'
        ) AS other_schema,
        has_schema_privilege(
          current_user, 'auth', 'CREATE'
        ) AS can_create
    `);

    expect(result.rows[0]).toEqual({
      username: "forgeflow_auth",
      own_schema: true,
      other_schema: false,
      can_create: false,
    });
  });

  it("uses a restricted Core role which cannot use Auth schema", async () => {
    const result = await corePool.query(`
      SELECT
        current_user AS username,
        has_schema_privilege(
          current_user, 'core', 'USAGE'
        ) AS own_schema,
        has_schema_privilege(
          current_user, 'auth', 'USAGE'
        ) AS other_schema,
        has_schema_privilege(
          current_user, 'core', 'CREATE'
        ) AS can_create
    `);

    expect(result.rows[0]).toEqual({
      username: "forgeflow_core",
      own_schema: true,
      other_schema: false,
      can_create: false,
    });
  });

  it("connects to Redis", async () => {
    await redisClient.connect();

    const response = await redisClient.ping();

    expect(response).toBe("PONG");
  });
});
