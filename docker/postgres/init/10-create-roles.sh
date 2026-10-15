#!/bin/sh
# Executes ONCE when PostgreSQL initializes an EMPTY data volume.
set -eu

: "${POSTGRES_USER:?}"
: "${POSTGRES_DB:?}"
: "${AUTH_DB_PASSWORD:?}"
: "${CORE_DB_PASSWORD:?}"
: "${MIGRATOR_DB_PASSWORD:?}"

# psql variables quote password values as SQL string literals safely.
psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=db_name="$POSTGRES_DB" \
  --set=auth_password="$AUTH_DB_PASSWORD" \
  --set=core_password="$CORE_DB_PASSWORD" \
  --set=migrator_password="$MIGRATOR_DB_PASSWORD" <<'SQL'
CREATE ROLE forgeflow_migrator LOGIN PASSWORD :'migrator_password';
CREATE ROLE forgeflow_auth LOGIN PASSWORD :'auth_password';
CREATE ROLE forgeflow_core LOGIN PASSWORD :'core_password';

-- Only the migration role may create objects in the migration-history schema.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO forgeflow_migrator;

-- Each runtime connects with its own restricted DB role.
REVOKE CONNECT ON DATABASE :"db_name" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db_name" TO forgeflow_migrator, forgeflow_auth, forgeflow_core;
GRANT CREATE ON DATABASE :"db_name" TO forgeflow_migrator;
SQL