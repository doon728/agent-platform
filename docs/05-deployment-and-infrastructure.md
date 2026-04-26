# Section 5 — Deployment & Runtime Infrastructure

## What Runs Where

The platform is made up of five independent services plus one external dependency (the LLM API). Each service runs in its own process (or container) and communicates over HTTP.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  PLATFORM TOOLS  (shared across all usecases)                           │
│                                                                         │
│   Agent Factory UI          localhost:5173   React (Vite dev server)    │
│   Agent Factory Support API localhost:8000   FastAPI (Python)           │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  SHARED INFRA  (shared across all usecases in one capability)           │
│                                                                         │
│   Tool Gateway              localhost:8080   FastAPI (Python)           │
│   PostgreSQL + pgvector     localhost:5433   Vector DB + structured data│
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  PER-USECASE  (one set per deployed agent)                              │
│                                                                         │
│   Agent Runtime             localhost:8081   FastAPI + LangGraph        │
│   UI (care management app)  localhost:3000   React (Vite dev server)    │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  EXTERNAL  (not hosted by the platform)                                 │
│                                                                         │
│   LLM API (OpenAI / Azure OpenAI)   api.openai.com   HTTPS             │
│   Called by Agent Runtime only — no other service talks to the LLM     │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Who Calls the LLM and When

Only the **Agent Runtime** calls the LLM. No other service does. It calls it in three places:

| Where | Node | What it asks the LLM to do |
|---|---|---|
| Inside graph | Planner (`llm_planner.py`) | Decide which tool to call and with what arguments, or return LLM_ROUTE if no tool needed |
| Inside graph | Responder (`chat_responder.py`) | Format the tool output into a human-readable response using the persona and prompt rules |
| Post-graph (if enabled) | Semantic memory write engine | Extract key facts from the exchange to store as semantic memory entries |

The model and API key are configured per agent via environment variables:

```bash
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4o-mini   # default, overridable per agent
```

The Tool Gateway, PostgreSQL, UI, and Agent Factory services never call the LLM directly.

---

## The Five Services

### 1. Agent Factory UI — `localhost:5173`

**What it is:** The admin panel for the platform. Used by developers and platform engineers — not end users.

**What it does:**
- Agent Registry — view all agents, their status, config tabs (Tools, HITL, Memory, RAG, Prompts)
- Workspaces — start, stop, restart agent runtime containers
- Prompt Governance — view and manage prompt versions

**Where it lives:** `/services/agent-factory-ui/`

**How it runs:** Vite dev server. Not containerized — runs directly on the host.

```bash
cd services/agent-factory-ui
npm run dev   # starts on :5173
```

---

### 2. Agent Factory Support API — `localhost:8000`

**What it is:** The backend for the Agent Factory UI. A lightweight FastAPI service.

**What it does:**
- Reads `usecase_registry.json` to serve agent metadata to the UI
- Proxies Docker commands — start/stop/restart containers on behalf of the UI
- Serves agent config (agent.yaml, memory.yaml) to the UI tabs
- Provides `/registry/agent-status` — live container status + locked_features per agent

**Where it lives:** `/services/agent-factory-support-api/`

**How it runs:** Python FastAPI. Not containerized — runs directly on the host.

```bash
cd services/agent-factory-support-api
uvicorn app:app --port 8000 --reload
```

---

### 3. Tool Gateway — `localhost:8080`

**What it is:** The single execution point for all tool calls. Shared across all usecases in the capability.

**What it does:**
- Hosts the tool registry — all available tools with their schemas, adapters, and metadata
- Validates incoming tool calls from agent runtimes
- Routes tool calls to the right adapter: local Python function, REST endpoint, Lambda, vector DB query
- Serves the full tool schema to agent runtimes on startup (used to build the LLM tool schema)

**Where it lives:** `/services/tool-policy-gateway/`

**How it runs:** Containerized. One instance per capability, shared by all usecase agents.

```bash
cd services/tool-policy-gateway
docker compose up
```

---

### 4. PostgreSQL + pgvector — `localhost:5433`

**What it is:** The database backing the Tool Gateway. Runs as a sidecar container alongside the Tool Gateway.

**What it stores:**
- Vector embeddings for KB retrieval (via pgvector extension)
- Structured data used by tools (member records, case data, assessments in local/dev mode)

**How it runs:** Docker container, started automatically with the Tool Gateway compose file.

> Note: port 5433 (not 5432) to avoid conflicts with any local PostgreSQL instance.

---

### 5. Agent Runtime — `localhost:8081`

**What it is:** The per-usecase AI agent. One container per deployed usecase agent.

**What it does:**
- Receives `POST /invoke` from the UI
- Runs the full pre-graph → LangGraph → post-graph flow
- Calls the Tool Gateway for tool execution
- Reads/writes memory to the file-based memory store (`./data/`)
- Stores HITL approval requests in SQLite (`./state/`)

**Where it lives:** `/generated-repos/{capability}/usecases/{usecase}/{agent-repo}/`

**How it runs:** Containerized. Each usecase agent has its own `docker-compose.yml`.

```bash
cd generated-repos/care-management/usecases/UC_PreCall_Assess/cm-chat-buddy-assess
docker compose up
```

---

### 6. Care Management UI — `localhost:3000`

**What it is:** The end-user application. The nurse/care manager's working environment.

**What it does:**
- Member search, case view, assessment view, care plan view
- Embedded chat panel (connects to the agent runtime)
- Memory debug panel and trace graph (for dev/demo mode)

**Where it lives:** `/generated-repos/{capability}/cm-hero-fl-app/services/ui/`

**How it runs:** Vite dev server inside Docker (node:20-alpine container).

```bash
cd generated-repos/care-management/cm-hero-fl-app
docker compose up
```

---

## Shared vs Isolated

| Service | Shared or Per-Usecase | Notes |
|---|---|---|
| Agent Factory UI | Shared — one for the whole platform | Admin tool, not per usecase |
| Agent Factory Support API | Shared — one for the whole platform | Reads registry, talks to Docker |
| Tool Gateway | Shared — one per capability | All agents in the capability call the same gateway |
| PostgreSQL + pgvector | Shared — one per capability | Same DB, separate tables/schemas per tool |
| Agent Runtime | **Per-usecase** | One container per agent deployment |
| Care Management UI | Shared — one per capability app | One UI, switches context per usecase |

The Tool Gateway being shared is an important design choice. All agents in the same capability (e.g. all care management agents) share one gateway and one vector DB. This means:
- A tool registered in the gateway is available to any agent that lists it in `tools.allowed`
- KB documents indexed once are searchable by all agents
- A new agent in the same capability gets access to all tools immediately — no gateway changes needed

---

## Port Map

| Service | Default Port | Configurable via |
|---|---|---|
| Agent Factory UI | 5173 | Vite config |
| Agent Factory Support API | 8000 | uvicorn arg |
| Tool Gateway | 8080 | `TOOL_GATEWAY_PORT` env var |
| PostgreSQL | 5433 | docker-compose.yml |
| Agent Runtime | 8081 | `AGENT_RUNTIME_PORT` env var |
| Care Management UI | 3000 | `APP_UI_PORT` env var |

---

## How Services Talk to Each Other

```
Care Management UI  (3000)
        │  POST /invoke
        │◄─────────────────── answer / approval status
        ▼
Agent Runtime  (8081) ──── Planner: which tool + args? ────► LLM API (OpenAI)
        │                   Responder: format answer    ◄────
        │
        │  POST /invoke/{tool}
        │◄─────────────────── tool result
        ▼
Tool Gateway  (8080)
        │  query / write
        │◄─────────────────── rows / vectors
        ▼
PostgreSQL  (5433)


Agent Factory UI  (5173)
        │  REST API calls
        │◄─────────────────── agent status / config / registry
        ▼
Agent Factory Support API  (8000)
        │  Docker SDK + file reads
        │◄─────────────────── container state / file contents
        ▼
Agent Runtime containers  (managed via Docker)
```

The Agent Runtime talks to the Tool Gateway using `host.docker.internal` — this resolves to the host machine's IP from inside a Docker container, allowing the containerized runtime to reach the Tool Gateway running on the same machine.

---

## Persistent Storage

| What | Where | Type |
|---|---|---|
| Memory (short-term, episodic, semantic, summary) | `./data/` in agent repo | File-based JSON (FileMemoryStore) |
| HITL approval requests | `./state/approvals.db` in agent repo | SQLite |
| KB embeddings | PostgreSQL pgvector | Vector DB |
| Agent config | `overlays/` in agent repo | YAML files (baked into container image) |
| Usecase registry | `services/agent-factory-support-api/data/usecase_registry.json` | JSON file |

The `./data/` and `./state/` directories are mounted as Docker volumes — they persist across container restarts.

---

## Starting Everything Locally

Order matters. Start in this sequence:

```bash
# 1. Tool Gateway + PostgreSQL (shared infra)
cd services/tool-policy-gateway
docker compose up -d

# 2. Agent Runtime (per usecase)
cd generated-repos/care-management/usecases/UC_PreCall_Assess/cm-chat-buddy-assess
docker compose up -d

# 3. Care Management UI
cd generated-repos/care-management/cm-hero-fl-app
docker compose up -d

# 4. Agent Factory Support API (platform tools)
cd services/agent-factory-support-api
uvicorn app:app --port 8000 --reload &

# 5. Agent Factory UI (platform tools)
cd services/agent-factory-ui
npm run dev
```

The Tool Gateway must be running before the Agent Runtime starts — the runtime calls the gateway at startup to load the tool schema.
