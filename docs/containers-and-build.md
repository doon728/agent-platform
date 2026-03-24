# Containers and Build Guide

Every service runs in Docker. This guide covers what containers exist, how to build them, and how to start/stop them.

See: `diagrams/platform-architecture.png`

---

## Containers at a Glance

| Container | Image | Port | Repo Location |
|-----------|-------|------|---------------|
| `ui` | Node 20 Alpine | 3000 | `cm-hero-fl-app/` |
| `agent-runtime` | Python 3.11 slim | 8081 | `cm-chat-buddy-assess/` |
| `healthcare-tool-gateway` | Python 3.11 slim | 8080 | `shared-infra/industry-tool-gateway-healthcare/` |
| `postgres` | postgres:15 + pgvector | 5433 | `shared-infra/industry-tool-gateway-healthcare/` |

---

## 1. Tool Gateway + PostgreSQL

**Location:** `shared-infra/industry-tool-gateway-healthcare/`

Shared across all usecases in the healthcare capability. Run once.

```bash
cd shared-infra/industry-tool-gateway-healthcare

# First run: start both services
PATH=$PATH:/Applications/Docker.app/Contents/Resources/bin \
  docker compose up -d --build

# After any change to registry.py, pg_store.py, or app.py:
PATH=$PATH:/Applications/Docker.app/Contents/Resources/bin \
  docker compose up -d --build healthcare-tool-gateway

# Seed the database (first run only):
docker exec -it healthcare-tool-gateway python bootstrap_structured.py
docker exec -it healthcare-tool-gateway python bootstrap_kb.py
```

**What gets built:**
- `healthcare-tool-gateway` — FastAPI service with all registered tools
- `postgres` — PostgreSQL 15 with pgvector extension

**When to rebuild:** Any time you add/modify a tool in `src/tools/registry.py` or a query in `src/data/pg_store.py`.

---

## 2. Agent Runtime

**Location:** `generated-repos/care-management/usecases/UC_PreCall_Assess/cm-chat-buddy-assess/`

One container per usecase. Each usecase repo has its own docker-compose.

```bash
cd generated-repos/care-management/usecases/UC_PreCall_Assess/cm-chat-buddy-assess

# First run or after code changes:
PATH=$PATH:/Applications/Docker.app/Contents/Resources/bin \
  docker compose up -d --build

# After overlay config change only (agent.yaml, memory.yaml — no code change):
PATH=$PATH:/Applications/Docker.app/Contents/Resources/bin \
  docker compose restart agent-runtime

# View logs:
docker logs cm-chat-buddy-assess-agent-runtime-1 -f

# After tool-gateway was rebuilt (re-discover tools):
docker compose restart agent-runtime
```

**What gets built:**
- `agent-runtime` — FastAPI + LangGraph orchestration service

**When to rebuild:** Any Python code change in `services/agent-runtime/src/` or `overlays/`.

**When to restart (no rebuild):** Config-only changes to `overlays/chat_agent/config/*.yaml`.

---

## 3. UI

**Location:** `generated-repos/care-management/cm-hero-fl-app/`

```bash
cd generated-repos/care-management/cm-hero-fl-app

# Start (Vite hot-reload — no rebuild needed for UI changes):
PATH=$PATH:/Applications/Docker.app/Contents/Resources/bin \
  docker compose up -d

# UI changes hot-reload automatically. No restart needed.

# After package.json changes (new npm dependencies only):
PATH=$PATH:/Applications/Docker.app/Contents/Resources/bin \
  docker compose up -d --build
```

**What gets built:**
- `ui` — Vite dev server serving React app on port 3000

**When to rebuild:** Only when `package.json` dependencies change.

---

## Start Everything (Fresh)

Run these in order — tool-gateway must be up before agent-runtime starts (it calls `/tools/specs` at startup).

```bash
# 1. Tool Gateway + DB
cd shared-infra/industry-tool-gateway-healthcare
PATH=$PATH:/Applications/Docker.app/Contents/Resources/bin docker compose up -d --build

# Wait ~10s for postgres to be ready, then seed (first run only):
docker exec -it healthcare-tool-gateway python bootstrap_structured.py
docker exec -it healthcare-tool-gateway python bootstrap_kb.py

# 2. Agent Runtime
cd generated-repos/care-management/usecases/UC_PreCall_Assess/cm-chat-buddy-assess
PATH=$PATH:/Applications/Docker.app/Contents/Resources/bin docker compose up -d --build

# 3. UI
cd generated-repos/care-management/cm-hero-fl-app
PATH=$PATH:/Applications/Docker.app/Contents/Resources/bin docker compose up -d

# Open: http://localhost:3000
```

---

## Stop Everything

```bash
# Stop agent runtime
cd cm-chat-buddy-assess && docker compose down

# Stop UI
cd cm-hero-fl-app && docker compose down

# Stop tool-gateway (keep postgres running to preserve data)
cd shared-infra/industry-tool-gateway-healthcare && docker compose stop healthcare-tool-gateway

# Or stop everything including postgres:
docker compose down
```

---

## Environment Variables (.env)

Each repo has its own `.env` file. Never commit this file.

**Tool Gateway** (`shared-infra/industry-tool-gateway-healthcare/.env`):
```bash
POSTGRES_USER=healthcare_user
POSTGRES_PASSWORD=healthcare_pass
POSTGRES_DB=healthcare_db
OPENAI_API_KEY=sk-...      # needed for bootstrap_kb.py (embeddings)
```

**Agent Runtime** (`cm-chat-buddy-assess/.env`):
```bash
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
TOOL_GATEWAY_URL=http://host.docker.internal:8080
AGENT_RUNTIME_PORT=8081
AGENT_TYPE=chat_agent
CAPABILITY_NAME=care-management
USECASE_NAME=UC_PreCall_Assess
AUTH_MODE=OPTIONAL
```

**UI** (`cm-hero-fl-app/.env`):
```bash
VITE_API_PROXY_TARGET=http://host.docker.internal:8081
```

---

## Dockerfile Locations

| Service | Dockerfile |
|---------|-----------|
| Agent Runtime | `services/agent-runtime/Dockerfile` |
| Tool Gateway | `services/tool-gateway/Dockerfile` |
| UI | `services/ui/Dockerfile` |

**Agent Runtime Dockerfile key steps:**
```dockerfile
FROM python:3.11-slim
WORKDIR /app

# Install dependencies
COPY services/agent-runtime/pyproject.toml .
RUN pip install poetry && poetry install --no-dev

# Copy platform code
COPY services/agent-runtime/src/ /app/src/

# Copy overlays (agent-specific code + config)
COPY overlays/ /app/overlays/

# Copy runtime config (base.yaml, dev.yaml)
COPY services/agent-runtime/config/ /app/config/

CMD ["uvicorn", "src.platform.app:app", "--host", "0.0.0.0", "--port", "8080"]
```

---

## Troubleshooting

**"Unknown tool: get_assessment_tasks"**
Tool gateway was rebuilt but agent-runtime didn't re-discover tools. Fix:
```bash
docker compose restart agent-runtime
```

**"docker-credential-desktop not found"**
Docker Desktop binary not in PATH. Fix:
```bash
PATH=$PATH:/Applications/Docker.app/Contents/Resources/bin docker compose up -d --build
```

**"Connection refused: localhost:8080"**
Tool gateway not running. Start it first (step 1 above).

**Database seed data missing**
Bootstrap scripts not run. Fix:
```bash
docker exec -it healthcare-tool-gateway python bootstrap_structured.py
docker exec -it healthcare-tool-gateway python bootstrap_kb.py
```

**Agent-runtime won't start — "cannot find overlay"**
`AGENT_TYPE` env var doesn't match an overlay folder name. Check:
```bash
docker exec agent-runtime ls /app/overlays/
```
The folder name must match `AGENT_TYPE` exactly (e.g., `chat_agent`).
