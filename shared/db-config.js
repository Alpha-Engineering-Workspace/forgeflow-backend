import { z } from "zod";

// Fixed usernames: services cannot silently escalate to the migration account.
const accounts = {
  auth: { username: "forgeflow_auth", passwordKey: "AUTH_DB_PASSWORD" },
  core: { username: "forgeflow_core", passwordKey: "CORE_DB_PASSWORD" },
  migrator: { username: "forgeflow_migrator", passwordKey: "MIGRATOR_DB_PASSWORD" },
};

export function readDbConfig(accountName, environment = process.env) {
  const account = accounts[accountName];

  if (!account) {
    throw new Error("Unknown database account");
  }

  const schema = z.object({
    DB_HOST: z.string().min(1).default("127.0.0.1"),
    DB_PORT: z.coerce.number().int().min(1).max(65535).default(5433),
    DB_NAME: z.string().min(1).default("forgeflow_dev"),
    [account.passwordKey]: z.string().min(16),
  });

  const result = schema.safeParse(environment);
  if (!result.success) {
    // Never include environment values (which might contain passwords) in errors.
    throw new Error(`Invalid ${accountName} database configuration. Check .env.`);
  }

  return {
    host: result.data.DB_HOST,
    port: result.data.DB_PORT,
    database: result.data.DB_NAME,
    user: account.username,
    password: result.data[account.passwordKey],
    connectionTimeoutMillis: 3000,
  };
}
