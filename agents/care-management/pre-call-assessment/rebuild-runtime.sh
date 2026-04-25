#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "Building image..."
docker build --no-cache -t agent-runtime:local -f services/agent-runtime/Dockerfile .

echo "Removing old container..."
docker rm -f cm-chat-buddy-assess-agent-runtime-1 2>/dev/null || true

echo "Starting new container..."
docker run -d \
  --name cm-chat-buddy-assess-agent-runtime-1 \
  -p 8081:8080 \
  --add-host host.docker.internal:host-gateway \
  --env-file "$SCRIPT_DIR/.env" \
  -e CONTRACT_VERSION=v1 \
  -e TOOL_GATEWAY_URL=http://host.docker.internal:8080 \
  -e AUTH_MODE=OPTIONAL \
  -e AGENT_ENV=dev \
  -e OPENAI_MODEL=gpt-4o-mini \
  -v "$SCRIPT_DIR/data:/app/data" \
  -v "$SCRIPT_DIR/state:/app/state" \
  agent-runtime:local

echo "Done. Container status:"
docker ps --filter name=cm-chat-buddy-assess-agent-runtime-1 --format "table {{.Names}}\t{{.Status}}"

# Keep platform registry in sync with actual container port
WORKSPACE_STATE="/Users/tgaba/agent-platform/services/agent-factory-support-api/data/workspace_state.json"
if [ -f "$WORKSPACE_STATE" ]; then
  python3 -c "
import json
with open('$WORKSPACE_STATE','r') as f: d=json.load(f)
d['resolved_runtime_port']=8081
d['agent_runtime_url']='http://localhost:8081'
d['status']='running'
with open('$WORKSPACE_STATE','w') as f: json.dump(d,f,indent=2)
print('[rebuild] workspace_state.json updated -> port 8081')
"
fi
