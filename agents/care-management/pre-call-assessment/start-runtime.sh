#!/bin/bash
# Start both Container 1 (agent-runtime) and Container 2 (platform-services) for local dev.
# Uses docker-compose so both services start together with the correct wiring.
#
# Usage:
#   ./start-runtime.sh          # build + start
#   ./start-runtime.sh --no-build  # start without rebuilding

set -e

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

if [[ "$1" == "--no-build" ]]; then
  docker compose -f "$REPO_ROOT/agents/care-management/pre-call-assessment/docker-compose.yml" \
    --env-file "$REPO_ROOT/agents/care-management/pre-call-assessment/.env" \
    up -d
else
  docker compose -f "$REPO_ROOT/agents/care-management/pre-call-assessment/docker-compose.yml" \
    --env-file "$REPO_ROOT/agents/care-management/pre-call-assessment/.env" \
    up --build -d
fi

echo ""
echo "Services started:"
echo "  Container 2 — platform-services : http://localhost:8002/health"
echo "  Container 1 — agent-runtime     : http://localhost:8001/health"
echo ""
echo "Logs: docker compose logs -f"
