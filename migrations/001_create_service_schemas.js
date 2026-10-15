// A migration runs with forgeflow_migrator, never a runtime service account.
// Domain tables (users, workspaces, projects) arrive in later milestones.
export const up = (pgm) => {
  pgm.createSchema("auth");
  pgm.createSchema("core");

  // Each app can only USE its own schema. It cannot CREATE or DROP tables.
  pgm.sql("GRANT USAGE ON SCHEMA auth TO forgeflow_auth");
  pgm.sql("GRANT USAGE ON SCHEMA core TO forgeflow_core");

  // Permissions automatically apply to FUTURE tables created by migrator.
  pgm.sql(`
    ALTER DEFAULT PRIVILEGES FOR ROLE forgeflow_migrator IN SCHEMA auth
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO forgeflow_auth
  `);
  pgm.sql(`
    ALTER DEFAULT PRIVILEGES FOR ROLE forgeflow_migrator IN SCHEMA core
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO forgeflow_core
  `);
  pgm.sql(`
    ALTER DEFAULT PRIVILEGES FOR ROLE forgeflow_migrator IN SCHEMA auth
    GRANT USAGE, SELECT ON SEQUENCES TO forgeflow_auth
  `);
  pgm.sql(`
    ALTER DEFAULT PRIVILEGES FOR ROLE forgeflow_migrator IN SCHEMA core
    GRANT USAGE, SELECT ON SEQUENCES TO forgeflow_core
  `);
};

export const down = (pgm) => {
  // No CASCADE: rollback must refuse to drop schemas holding feature tables.
  pgm.sql(`
    ALTER DEFAULT PRIVILEGES FOR ROLE forgeflow_migrator IN SCHEMA core
    REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM forgeflow_core
  `);
  pgm.sql(`
    ALTER DEFAULT PRIVILEGES FOR ROLE forgeflow_migrator IN SCHEMA auth
    REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM forgeflow_auth
  `);
  pgm.sql(`
    ALTER DEFAULT PRIVILEGES FOR ROLE forgeflow_migrator IN SCHEMA core
    REVOKE USAGE, SELECT ON SEQUENCES FROM forgeflow_core
  `);
  pgm.sql(`
    ALTER DEFAULT PRIVILEGES FOR ROLE forgeflow_migrator IN SCHEMA auth
    REVOKE USAGE, SELECT ON SEQUENCES FROM forgeflow_auth
  `);
  pgm.sql("REVOKE USAGE ON SCHEMA auth FROM forgeflow_auth");
  pgm.sql("REVOKE USAGE ON SCHEMA core FROM forgeflow_core");
  pgm.dropSchema("core");
  pgm.dropSchema("auth");
};
