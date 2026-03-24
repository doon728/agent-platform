# Platform Components

Deep dive into every component of the agent runtime — what it does, where it lives, and how it connects to everything else.

See: `diagrams/agent-request-flow.png`

---

## Component Map

```
HTTP Request
    ↓
app.py              ← FastAPI entry point — routes, health, HITL endpoints
    ↓
usecase_contract.py ← execute() — wires context → graph → response
    ↓
context.py          ← builds request context dict from payload
    ↓
langgraph_runner.py ← runs graph, handles memory before/after, records traces
    ↓
graph/build_graph.py ← dispatcher: loads overlay graph by AGENT_TYPE
    ↓
overlays/{agent_type}/orchestration/build_graph.py  ← actual graph definition
    ↓
  ┌──────────┐      ┌──────────┐      ┌──────────────┐
  │ planner  │  →   │ executor │  →   │  responder   │
  └──────────┘      └──────────┘      └──────────────┘
       ↓                 ↓                   ↓
  llm_planner.py    tool_gateway_client.py  responder.py
  planner.py        validation.py          (calls OpenAI)
  (rules fallback)  registry.py
```

---

## 1. FastAPI App (`app.py`)

**Path:** `src/platform/app.py`

The HTTP server. Exposes all endpoints.

| Endpoint | Method | What it does |
|----------|--------|--------------|
| `/invocations` | POST | Main chat endpoint — runs the agent graph |
| `/health` | GET | Returns `{status: ok}` — used by Docker health checks |
| `/traces` | GET | Returns last N execution traces |
| `/hitl/requests` | GET | Lists pending approval requests |
| `/hitl/decide` | POST | Submit approval decision (approved/rejected) |
| `/tools/specs` | GET | Returns specs of all loaded tools (debug) |

**Startup sequence:**
1. Load `base.yaml` + env vars → `Config` dataclass
2. Call `load_agent_config(agent_type)` → load `agent.yaml`, `memory.yaml` from overlay
3. Call tool discovery → hit tool gateway `/tools/specs`, register all tools
4. Start FastAPI

---

## 2. Config Loader (`config.py`)

**Path:** `src/platform/config.py`

Reads `config/base.yaml` (and `dev.yaml`/`prod.yaml` overrides) + environment variables into a typed `Config` dataclass.

**Key fields:**
```python
cfg.app.capability_name          # e.g., "care-management"
cfg.prompt_service.agent_type    # e.g., "chat_agent" — drives overlay selection
cfg.prompt_service.usecase_name  # e.g., "UC_PreCall_Assess"
cfg.tool_gateway.url             # e.g., "http://healthcare-tool-gateway:8080"
```

**Precedence:** env vars > dev.yaml > base.yaml > code defaults.

---

## 3. Agent Config Loader (`usecase_config_loader.py`)

**Path:** `src/platform/usecase_config_loader.py`

Loads the overlay-specific config for the active agent type.

```python
def load_agent_config(agent_type: str) -> Dict[str, Any]:
    config_dir = f"/app/overlays/{agent_type}/config/"
    # Loads: agent.yaml, memory.yaml, prompt-defaults.yaml, workflow-rules.yaml
```

Returns merged dict with:
- `tools.allowed` — list of tool names the agent may call
- `tools.mode` — `selected` or `auto`
- `risk.approval_required` — whether HITL is enabled
- `features.*` — memory, rag, hitl, observability flags
- `retrieval.*` — default tool, fallback behavior
- `memory.*` — all memory write/retrieval policies

---

## 4. Request Context Builder (`context.py`)

**Path:** `src/platform/context.py`

Converts the raw HTTP payload into a structured context dict that flows through the entire graph.

**Input (HTTP payload):**
```json
{
  "prompt": "What are the tasks for this assessment?",
  "thread_id": "thread-abc",
  "tenant_id": "t1",
  "assessment_id": "A001",
  "case_id": "C001",
  "member_id": "M001",
  "agent_id": "nurse-1"
}
```

**Output (context dict):**
```python
{
    "prompt": "What are the tasks...",
    "thread_id": "thread-abc",
    "tenant_id": "t1",
    "assessment_id": "A001",
    "case_id": "C001",
    "member_id": "M001",
    "agent_id": "nurse-1",
    "allowed_tools": ["search_kb", "get_member", ...],   # from agent.yaml
    "tool_mode": "selected",
    "approval_required": True,
}
```

---

## 5. LangGraph Runner (`langgraph_runner.py`)

**Path:** `src/platform/langgraph_runner.py`

Orchestrates the full request lifecycle. The most important file in the platform.

**What it does, in order:**
1. Resolve memory scopes (which assessment/case/member IDs apply)
2. Read memory — short-term turns + episodic memories → inject into context
3. Build and run the LangGraph graph (planner → executor → responder)
4. Write short-term memory (every turn)
5. Write episodic memory (if tool was called successfully)
6. Trigger summary compression (every N turns)
7. Record trace

**Memory boundary rule:** Memory read/write happens in `langgraph_runner.py`, NOT inside graph nodes. Nodes only receive context and produce outputs.

---

## 6. Graph Dispatcher (`graph/build_graph.py`)

**Path:** `src/graph/build_graph.py`

Reads `AGENT_TYPE` and dynamically imports the correct overlay's graph builder.

```python
agent_type = cfg.prompt_service.agent_type   # e.g., "chat_agent"
module = importlib.import_module(
    f"overlays.{agent_type}.orchestration.build_graph"
)
graph = module.build_graph(config)
```

This is why adding a new agent type requires no platform code changes — just add a new overlay folder.

---

## 7. Manifest Loader (`manifest_loader.py`)

**Path:** `src/platform/manifest_loader.py`

Reads `overlays/{agent_type}/agent_manifest.yaml` to discover what the overlay declares.

```yaml
agent_type: chat_agent
components: [planner, responder, executor]
features:
  memory: true
  observability: true
entrypoint:
  orchestration_graph: orchestration/build_graph.py
```

Used to validate that all declared components exist and to enable/disable features at startup.

---

## 8. Planner Nodes

### LLM Planner (`overlays/chat_agent/agents/llm_planner.py`)

The primary planner. Two routing modes:

**HARD_ROUTE** — deterministic, no LLM call:
```python
task_phrases = ["task", "what do i need to do", "action items"]
if active_assessment_id and any(x in lower_p for x in task_phrases):
    if "get_assessment_tasks" in allowed_tools:
        return (["get_assessment_tasks: A001"], {"route_type": "HARD_ROUTE"})
```

**LLM_ROUTE** — calls OpenAI to decide which tool to call:
```python
# Sends tool descriptions + conversation history to LLM
# LLM returns: "get_member_summary: M001"
```

Returns: `(tool_calls: List[str], metadata: Dict)`

### Rules Planner (`overlays/chat_agent/agents/planner.py`)

Keyword-based fallback. Used when `planner_mode: rules` in config. No LLM call — pure string matching.

---

## 9. Executor (`overlays/chat_agent/agents/executor.py`)

Calls the tool gateway and handles HITL.

**Flow:**
1. Parse tool call string `"get_member_summary: M001"` → tool name + input
2. Check if tool requires approval (`risk.approval_required` + tool tags)
3. If approval required → save `ApprovalRequest`, return `PENDING` immediately
4. If not required → call tool gateway `POST /tools/invoke`
5. Return tool result to responder

**HITL check:**
```python
if requires_approval(tool_name, usecase_cfg):
    approval_id = save_approval_request(tool_name, tool_input, ctx)
    return GraphState(answer="[PENDING APPROVAL]", pending_approval_id=approval_id)
```

---

## 10. Tool Gateway Client (`tool_gateway_client.py`)

**Path:** `src/platform/tool_gateway_client.py`

HTTP client that calls the tool gateway service.

```python
def invoke_tool(tool_name: str, tool_input: dict) -> dict:
    response = requests.post(
        f"{TOOL_GATEWAY_URL}/tools/invoke",
        json={"tool": tool_name, "input": tool_input}
    )
    return response.json()
```

---

## 11. Tool Discovery (`tools/discovery.py`)

**Path:** `src/platform/tools/discovery.py`

Called at app startup. Hits `/tools/specs` on the tool gateway and registers all available tools in the local registry.

```python
def discover_tools(gateway_url: str, allowed_tools: List[str]):
    specs = requests.get(f"{gateway_url}/tools/specs").json()
    for spec in specs:
        if spec["name"] in allowed_tools:
            registry.register(spec)
```

This is why you must restart agent-runtime after rebuilding tool-gateway — it only discovers tools at startup.

---

## 12. Tool Registry (`tools/registry.py`)

**Path:** `src/platform/tools/registry.py`

In-memory dict of all discovered tools. Also contains `invoke_approved()` which validates + calls the tool gateway.

```python
TOOL_REGISTRY: Dict[str, ToolSpec] = {}

def invoke_approved(tool_name: str, tool_input: dict) -> dict:
    spec = TOOL_REGISTRY[tool_name]
    validated = spec.input_model(**tool_input)
    return tool_gateway_client.invoke_tool(tool_name, validated.dict())
```

---

## 13. Responder (`llm/responder.py`)

**Path:** `src/platform/llm/responder.py`

Calls OpenAI to generate the final natural language answer.

**Input to OpenAI:**
- System prompt (from `prompt-defaults.yaml` or built-in default)
- Conversation history (from short-term memory)
- Memory context (episodic memories from case/assessment scope)
- Tool result (what the tool returned)
- Current user message

**Output:** Natural language answer string.

---

## 14. Memory System

**Path:** `src/platform/memory/`

Six files, each with a distinct responsibility:

| File | What it does |
|------|-------------|
| `memory_store.py` | CRUD for all memory types + scope index management |
| `file_memory.py` | Low-level JSON file read/write operations |
| `scope_resolver.py` | Resolves which scope IDs apply to this request |
| `context_builder.py` | Assembles memories into prompt-ready context string |
| `write_engine.py` | Writes episodic/semantic memories after tool calls |
| `summary_engine.py` | Compresses old conversation turns into summaries |
| `config_loader.py` | Reads memory config from `memory.yaml` |

**Memory types:**

| Type | When written | When read | Scope |
|------|-------------|-----------|-------|
| Short-term | Every turn | Every request | Conversation |
| Episodic | After tool_success | On demand | Assessment, Case |
| Semantic | Manually triggered | On demand | Member |
| Summary | Every N turns | Every request | Conversation |

**Scope rollup:** Reading case memories automatically includes all child assessment memories. Reading member memories includes all child case memories.

---

## 15. Observability (`observability/tracer.py`)

**Path:** `src/platform/observability/tracer.py`

Records a structured trace for every graph run.

**Trace structure:**
```json
{
  "run_id": "...",
  "thread_id": "...",
  "steps": [
    {"node": "planner", "input": "...", "output": "get_member: M001", "route_type": "HARD_ROUTE"},
    {"node": "executor", "tool": "get_member", "result": {...}, "duration_ms": 120},
    {"node": "responder", "tokens_used": 340, "duration_ms": 890}
  ],
  "total_duration_ms": 1010
}
```

Traces are stored in memory and served at `GET /traces`. The UI renders them as an execution graph (`TraceGraph.tsx`).

---

## 16. Authentication (`auth.py`, `authorization.py`)

**Path:** `src/platform/auth.py`, `src/platform/authorization.py`

- `auth.py` — validates bearer tokens. In `AUTH_MODE=OPTIONAL` (dev), all requests pass through.
- `authorization.py` — enforces tenant isolation. Every query is scoped to `tenant_id` extracted from the request. No cross-tenant data leakage.

---

## Tool Gateway Components

**Location:** `shared-infra/industry-tool-gateway-healthcare/services/tool-gateway/src/`

| File | What it does |
|------|-------------|
| `app.py` | FastAPI: `/tools/invoke`, `/tools/specs`, `/members`, `/cases`, `/assessments` |
| `tools/registry.py` | `TOOL_REGISTRY` — all tools with input/output schema + handler function |
| `data/pg_store.py` | All PostgreSQL queries — members, assessments, cases, tasks, notes |
| `rag/retriever.py` | pgvector similarity search for `search_kb` tool |
| `rag/ingest.py` | Ingests policy documents into pgvector (run once at bootstrap) |

**Tool registration pattern:**
```python
TOOL_REGISTRY["get_member"] = ToolSpec(
    name="get_member",
    description="Fetch member demographics and plan info.",
    input_model=GetMemberInput,
    output_model=GetMemberOutput,
    handler=get_member_handler,
    primary_arg="member_id",
    mode="read",              # read | write
    tags=["care_management"],
)
```

The `mode` field drives HITL — write tools require approval when `approval_required: true`.
