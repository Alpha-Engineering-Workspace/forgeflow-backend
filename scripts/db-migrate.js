import { runner } from "node-pg-migrate";
import { fileURLToPath } from "node:url";
import { readDbConfig } from "../shared/db-config.js";

const config = readDbConfig("migrator");
const migrationsDirectory = fileURLToPath(new URL("../migrations/", import.meta.url));

// Only this command runs migrations. They do NOT run in each API replica.
try {
  await runner({
    databaseUrl: config,
    dir: migrationsDirectory,
    migrationsTable: "pgmigrations",
    direction: "up",
    singleTransaction: true,
    checkOrder: true,
    verbose: false,
  });

  console.log("Database migrations applied successfully.");
} catch (error) {
  console.error("Database migration failed:", error.message);
  process.exitCode = 1;
}
