#!/bin/bash
docker run -d \
  --name cm-chat-buddy-assess-agent-runtime-1 \
  -p 8081:8080 \
  --add-host host.docker.internal:host-gateway \
  --env-file .env \
  -e CONTRACT_VERSION=v1 \
  -e TOOL_GATEWAY_URL=http://host.docker.internal:8080 \
  -e AUTH_MODE=OPTIONAL \
  -e AGENT_ENV=dev \
  -e OPENAI_MODEL=gpt-4o-mini \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/state:/app/state \
  agent-runtime:local
