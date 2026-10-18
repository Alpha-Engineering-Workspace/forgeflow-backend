
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { createAuthPool } from "../../apps/auth-service/src/db/pool.js";
import { createCorePool } from "../../apps/core-service/src/db/pool.js";

const authPool = createAuthPool();
const corePool = createCorePool();

// Each test gets a unique email address.
function makeUser(overrides = {}) {
  return {
    name: "Test User",
    email: `${randomUUID()}@example.test`,
    passwordHash: "database-test-placeholder-hash",
    ...overrides,
  };
}

// Insert using parameterized SQL.
function insertUser(client, user) {
  return client.query(
    `
      INSERT INTO auth.users (
        name,
        email,
        password_hash
      )
      VALUES ($1, $2, $3)
      RETURNING
        id,
        name,
        email,
        created_at,
        updated_at
    `,
    [user.name, user.email, user.passwordHash]
  );
}

// Roll back every test so no test users remain.
async function withRollback(callback) {
  const client = await authPool.connect();

  try {
    await client.query("BEGIN");
    return await callback(client);
  } finally {
    try {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  }
}

afterAll(async () => {
  await Promise.all([
    authPool.end(),
    corePool.end(),
  ]);
});

describe("3A Auth users database", () => {
  it("inserts a valid user", async () => {
    await withRollback(async (client) => {
      const user = makeUser();

      const result = await insertUser(client, user);
      const savedUser = result.rows[0];

      expect(savedUser.id).toBeDefined();
      expect(savedUser.name).toBe(user.name);
      expect(savedUser.email).toBe(user.email);
      expect(savedUser.created_at).toBeInstanceOf(Date);
      expect(savedUser.updated_at).toBeInstanceOf(Date);
    });
  });

  it("rejects duplicate emails", async () => {
    await withRollback(async (client) => {
      const user = makeUser();

      await insertUser(client, user);

      await expect(
        insertUser(client, user)
      ).rejects.toMatchObject({
        code: "23505",
      });
    });
  });

  it("rejects a blank name", async () => {
    await withRollback(async (client) => {
      const user = makeUser({
        name: "   ",
      });

      await expect(
        insertUser(client, user)
      ).rejects.toMatchObject({
        code: "23514",
      });
    });
  });

  it("rejects a blank password hash", async () => {
    await withRollback(async (client) => {
      const user = makeUser({
        passwordHash: "   ",
      });

      await expect(
        insertUser(client, user)
      ).rejects.toMatchObject({
        code: "23514",
      });
    });
  });

  it("rejects non-canonical uppercase emails", async () => {
    await withRollback(async (client) => {
      const user = makeUser({
        email: "TestUser@Example.com",
      });

      await expect(
        insertUser(client, user)
      ).rejects.toMatchObject({
        code: "23514",
      });
    });
  });

  it("prevents Core Service from reading Auth users", async () => {
    await expect(
      corePool.query(
        "SELECT id FROM auth.users LIMIT 1"
      )
    ).rejects.toMatchObject({
      code: "42501",
    });
  });
});


