#!/usr/bin/env bash
# CI: arma una base de prueba desde cero (bootstrap + esquema base + todas
# las migraciones). Requiere DATABASE_URL apuntando a una base VACÍA.
set -euo pipefail
cd "$(dirname "$0")/../.."
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f scripts/ci/bootstrap.sql
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f src/lib/schema.postgres.sql
node scripts/run-migrations.mjs
