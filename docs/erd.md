# ForgeFlow database ownership — Milestone 2B

```text
PostgreSQL database: forgeflow_dev
  ├── auth schema          owned by forgeflow_migrator
  │   └── Auth-owned domain tables arrive in Phase 3
  ├── core schema          owned by forgeflow_migrator
  │   └── Core-owned domain tables arrive in Phase 4+
  └── public schema        migration history only (pgmigrations)
```

Auth/Core each connect as restricted roles that may use only their own schema. The migrator role owns the schemas and applies versioned migrations. One database remains a shared failure/migration coupling point. No domain tables or ER relationships exist in 2B.
