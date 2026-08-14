#!/bin/sh
# Creates the low-privilege application role `licita_app` on first database
# init (docker-entrypoint-initdb.d). The role gets CONNECT + DML on all
# current AND future tables created by the admin user — but NO DDL.
# Migrations keep running as the admin user (POSTGRES_USER).
#
# LICITA_APP_PASSWORD must be set in the db container's environment.
set -eu

: "${LICITA_APP_PASSWORD:?LICITA_APP_PASSWORD is required to create the licita_app role}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
  CREATE ROLE licita_app LOGIN PASSWORD '${LICITA_APP_PASSWORD}';
  GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO licita_app;
  GRANT USAGE ON SCHEMA public TO licita_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO licita_app;
  -- Tables created later by migrations (run as ${POSTGRES_USER}) inherit DML grants.
  ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO licita_app;
SQL
