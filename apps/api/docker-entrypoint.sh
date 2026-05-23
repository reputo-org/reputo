#!/bin/sh
# Container entrypoint for the @reputo/api production image.
#
# Runs pending TypeORM migrations against DATABASE_URL, then exec's the
# CMD. Migration failure exits non-zero so the orchestrator (Komodo / docker
# compose) sees a failed start and the API never serves traffic against an
# out-of-date schema.
set -e

echo "[entrypoint] Running TypeORM migrations..."
pnpm typeorm:run:prod
echo "[entrypoint] Migrations complete. Starting API..."

exec "$@"
