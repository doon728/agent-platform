#!/usr/bin/env bash
set -euo pipefail

echo "Starting postgres + tool gateway..."
docker compose up -d --build --force-recreate

echo "Bootstrapping structured data..."
poetry run python bootstrap_structured.py

echo "Bootstrapping KB data inside gateway container..."
docker exec -i tool-gateway-tool-gateway-1 sh -lc '
  cd /app && \
  KB_PG_HOST=postgres \
  KB_PG_PORT=5432 \
  KB_PG_DB=agentdb \
  KB_PG_USER=postgres \
  KB_PG_PASSWORD=postgres \
  poetry run python bootstrap_kb.py
'

echo "Verifying KB row count..."
KB_COUNT=$(docker exec tool-gateway-postgres-1 psql -U postgres -d agentdb -t -c "select count(*) from kb_documents;" | xargs)

if [ -z "${KB_COUNT}" ] || [ "${KB_COUNT}" = "0" ]; then
  echo "ERROR: kb_documents is empty after bootstrap"
  exit 1
fi

echo "Bootstrap complete."
echo "Gateway:  http://localhost:8080"
echo "Postgres: internal docker service"
echo "KB rows: ${KB_COUNT}"