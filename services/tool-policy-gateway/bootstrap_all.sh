#!/usr/bin/env bash
set -euo pipefail

# Bootstrap script for the tool-policy-gateway + rag service stack.
# Brings up postgres, rag, and tool-gateway containers; ingests structured
# CSV data into postgres (gateway side) and KB documents into postgres (rag side).

echo "Starting postgres + rag + tool-policy-gateway..."
docker compose up -d --build --force-recreate

echo "Bootstrapping structured data (gateway side)..."
poetry run python bootstrap_structured.py

echo "Bootstrapping KB data inside rag container..."
docker exec -i tool-policy-gateway-rag-1 sh -lc '
  cd /app && \
  KB_PG_HOST=postgres \
  KB_PG_PORT=5432 \
  KB_PG_DB=agentdb \
  KB_PG_USER=postgres \
  KB_PG_PASSWORD=postgres \
  poetry run python bootstrap_kb.py
'

echo "Verifying KB row count..."
KB_COUNT=$(docker exec tool-policy-gateway-postgres-1 psql -U postgres -d agentdb -t -c "select count(*) from kb_documents;" | xargs)

if [ -z "${KB_COUNT}" ] || [ "${KB_COUNT}" = "0" ]; then
  echo "ERROR: kb_documents is empty after bootstrap"
  exit 1
fi

echo "Bootstrap complete."
echo "Gateway:  http://localhost:8080"
echo "RAG:      http://localhost:8082"
echo "Postgres: internal docker service"
echo "KB rows:  ${KB_COUNT}"
