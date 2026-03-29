# Section 6 — Tool Design & Tool Gateway

## The Core Principle

> **The Tool Gateway is a pure router. It has no business logic. Every tool is an endpoint URL.**

The gateway receives a tool invocation request, looks up the tool's endpoint URL from the registry, calls that URL with the input, and returns the output. That's all it does. Whether the tool handler is a Lambda, a microservice, an internal API, or anything else — the gateway doesn't know and doesn't care. It just calls a URL.

This is the design that makes the platform truly extensible:
- Adding a new tool = registering a name + URL + schema in the DB. No code change in the gateway.
- Swapping a tool's backend (PostgreSQL → Epic → Lambda) = changing the URL in the registry. No code change anywhere else.
- Scaling tool execution = scale the service behind the URL. Gateway is stateless and untouched.

---

## Industry Gateway Design

The Tool Gateway is not one global service — it is deployed per industry. The current instance is named `industry-tool-gateway-healthcare`. A financial services deployment would have its own `industry-tool-gateway-financial`, and so on.

All capabilities and usecases within an industry share one gateway. This is the sharing boundary: one gateway per industry, not one gateway for the whole platform.

### Tool Bucketing — Industry / LOB / Region

Within an industry gateway, tools are further organized into buckets. The intent is a flexible multi-level taxonomy that an admin defines at runtime — not a hardcoded hierarchy in code.

**Tags are flat on the tool:**
```
tags: ["healthcare", "care_management", "florida", "member", "read"]
```

**Buckets are a config layer on top** — an admin defines bucket nodes and maps them to tag combinations. The hierarchy is whatever makes sense for the organization:

```
Example org A:
  Healthcare
    └── Care Management
          ├── Florida
          └── Texas
    └── Utilization Management
          └── National

Example org B — same tools, different hierarchy:
  Region: Southeast
    └── Product: Medicare Advantage
          └── Function: Case Management
```

The tags on the tools don't change. The bucket hierarchy is defined at runtime by the admin — it's a config layer, not a code layer.

**At agent configuration time:** the agent is assigned to one or more buckets. The tool schema shown to the LLM is filtered to tools matching those buckets. A Florida care management agent sees only Florida care management tools.

| | Today | Roadmap |
|---|---|---|
| Industry separation | ✅ — separate gateway per industry | — |
| Tool tags | ✅ — flat tag list on each tool | — |
| Bucket hierarchy | ❌ — not built | Admin defines buckets + hierarchy in Tool Admin UI |
| Agent bucket assignment | ❌ — not built | Agent Registry UI: pick industry gateway + buckets |
| Runtime tool filtering by bucket | ❌ — not built | Filter tool schema by agent's assigned buckets at query time |

---

## What the Tool Gateway Does

The gateway serves two distinct purposes:

**1. Tool Execution (`POST /tools/invoke`)**
Called by Agent Runtimes during graph execution. The agent sends a tool name + arguments, the gateway looks up the tool's endpoint URL, validates the input against the tool's schema, calls the URL, and returns the result.

**2. Domain Data REST API**
Called directly by the UI — not through an agent. Endpoints like `GET /members`, `GET /cases/{id}`, `GET /assessments/{id}` serve structured data to populate UI screens. These are not AI tool calls — they are regular REST calls for page rendering.

Both live in the same gateway service, but they serve different callers and serve different purposes.

---

## Anatomy of a Tool

Every tool in the registry is a record stored in PostgreSQL with these fields:

```
Tool Registry Record (tools table)
├── name              ← tool identifier — must match agent.yaml allowed list
├── description       ← shown to LLM in the tool schema — must be precise
├── endpoint_url      ← where the gateway POSTs the invocation payload
├── input_schema      ← JSON Schema — gateway validates all incoming args against this
├── output_schema     ← JSON Schema — contract for what the tool returns
├── primary_arg       ← which input field is the "main" arg (for planner hints)
├── mode              ← "read" or "write" — used for HITL risk classification
├── tags              ← used for filtering, UI display, bucket assignment
├── status            ← "draft" | "active" | "disabled" — controls agent visibility
├── enabled           ← soft on/off toggle
├── db_type           ← "vector_db" | "relational" | "graph_db" (retrieval tools only)
└── strategy          ← "semantic" | "hybrid" | "keyword" (retrieval tools only)
```

The `description` field is critical — it is what the LLM reads to decide whether to call this tool. It must be precise enough that the LLM picks the right tool for the right intent.

The `endpoint_url` is the only thing that connects the tool definition to its execution. Change the URL and you change where execution happens. Nothing else in the platform needs to know.

The `status` field controls whether agents can see and invoke the tool at all — see the Tool Lifecycle section below.

---

## Tool Lifecycle — Draft → Active → Disabled

Every tool goes through a lifecycle. Status controls visibility to agents at every stage.

```
Admin defines tool in Tool Admin UI
     │
     ▼  status = draft
     │  Tool is in DB with schema + endpoint URL
     │  NOT returned by GET /tools/specs
     │  Agents cannot invoke it — invisible to agent runtimes
     │
     ▼  Developer writes handler + mounts route + restarts gateway
     │
     ▼  Admin clicks "Activate" in Tool Admin UI
     │  status = active
     │  Tool appears in GET /tools/specs
     │  Admin can now assign it to agents in Agent Registry UI
     │
     ▼  Agent runtime picks up the tool on next startup
     │  Agents can now invoke it
     │
     ▼  (optional) Admin clicks Disable
        status = disabled
        Tool disappears from GET /tools/specs
        Agents can no longer invoke it — without deleting the tool record
```

**Why this matters:**
- `draft` enforces that schema is defined before code is written — contract first, implementation second
- `active` is the gate that only opens once a developer confirms the handler is deployed
- `disabled` lets admins turn a tool off without deleting it — useful for maintenance or staged rollouts
- Agents only ever see `active` + `enabled` tools — nothing else leaks through

---

## How a Tool Call Flows

```
Agent Runtime
     │
     │  POST /tools/invoke
     │  {
     │    "tool_name": "write_case_note",
     │    "input": { "case_id": "case-001", "note": "Patient called..." },
     │    "contract_version": "v1",
     │    "tenant_id": "tenant-abc"
     │  }
     ▼
Tool Gateway
     │
     │  1. Look up tool_name in registry → get endpoint_url + input_schema
     │  2. Validate input against input_schema (JSON Schema)
     │     └── if invalid → return ok: false, INPUT_VALIDATION_ERROR
     │  3. POST endpoint_url with input payload
     │     └── if HTTP error → return ok: false, TOOL_HTTP_ERROR
     │  4. Return output to Agent Runtime
     ▼
Tool endpoint (Lambda / microservice / internal API / dev handler)
     │
     │  executes against the backend
     │  (Epic, PostgreSQL, Pega, S3, etc.)
     ▼
Tool Gateway returns to Agent Runtime:
     {
       "ok": true,
       "tool_name": "write_case_note",
       "output": { "written": true, "note_id": "note-1234" },
       "error": null
     }
```

If the tool name is not found, input validation fails, or the endpoint returns an error — the gateway returns `ok: false` with an error code. It never crashes the agent runtime.

---

## How to Add a New Tool — End to End

This is the complete flow today. Schema is defined first, code follows.

### Step 1 — Admin defines the tool in Tool Admin UI (`localhost:5200`)

Open Tool Admin UI → Add Tool. Fill in:
- **Name** — tool identifier, must be unique (e.g. `get_care_plan`)
- **Description** — what the LLM reads to decide to call this tool — be precise
- **Endpoint URL** — where gateway sends the invocation. For dev: `http://localhost:8080/internal/tools/get_care_plan`
- **Mode** — `read` or `write`
- **Tags** — comma separated (e.g. `care_plan, member, care_management`)
- **Input Schema** — JSON Schema defining what arguments this tool accepts
- **Output Schema** — JSON Schema defining what this tool returns

Save. Tool is created with `status = draft`. It is NOT visible to agents yet.

**The UI shows a developer reminder checklist** — what the developer must do next.

### Step 2 — Developer writes the handler

```python
# registry.py — add input/output models
class GetCarePlanInput(BaseModel):
    care_plan_id: str = Field(..., description="Care plan ID like cp-000001")

class GetCarePlanOutput(BaseModel):
    found: bool
    care_plan_id: str
    data: Optional[dict] = None

# Write the handler function
def get_care_plan_handler(inp: GetCarePlanInput) -> GetCarePlanOutput:
    result = store().get_care_plan(inp.care_plan_id)
    return GetCarePlanOutput(found=result.get("found", False), care_plan_id=inp.care_plan_id, data=result)
```

```python
# app.py — mount the internal route
@app.post("/internal/tools/get_care_plan")
def _internal_get_care_plan(payload: dict):
    out = get_care_plan_handler(GetCarePlanInput(**payload))
    return out.model_dump()
```

Then restart the gateway:
```bash
docker compose restart tool-gateway
```

### Step 3 — Admin activates the tool in Tool Admin UI

In the Tool Registry table, find `get_care_plan` (status: `draft`). Click **Activate**.

Status changes to `active`. Tool now appears in `GET /tools/specs`. Agents can invoke it.

### Step 4 — Admin assigns the tool to an agent in Agent Registry UI (`localhost:5173`)

Open Agent Registry → select the agent → Tools tab → add `get_care_plan` to the allowed list → save.

Agent runtime picks it up on next restart. Done.

---

**In production (no dev handlers):**
- Steps 2 and 3 collapse to: deploy the real backend service, update the endpoint URL in Tool Admin UI to the real URL, activate
- No Python, no code change in the gateway at all

---

## Swapping a Tool's Backend

Because the gateway only knows the endpoint URL, swapping the backend requires exactly one change: update the URL in Tool Admin UI.

**Dev:** `write_case_note` → `http://localhost:8080/internal/tools/write_case_note`

**Production:** `write_case_note` → `https://epic.example.com/fhir/DocumentReference`

No code change. No gateway restart. No agent changes. The input/output schema stays the same — that is the stable contract. Only the URL changes.

| Backend | Status | endpoint_url example |
|---|---|---|
| Local dev handler | Today | `http://localhost:8080/internal/tools/<name>` |
| PostgreSQL service | Swap URL | `http://data-service:8001/tools/<name>` |
| AWS Lambda | Swap URL | `https://lambda.us-east-1.amazonaws.com/...` |
| Epic FHIR API | Swap URL | `https://epic.example.com/fhir/...` |
| Pega REST | Swap URL | `https://pega.example.com/api/v1/...` |
| ServiceNow | Swap URL | `https://instance.service-now.com/api/...` |
| Any REST service | Swap URL | any HTTPS endpoint |

---

## Dev Handler Pattern

In dev there is no Epic, no Lambda, no real backend. The Python handler functions in `registry.py` are mock implementations — they read/write against local PostgreSQL and serve as stand-ins for real backends.

To keep the gateway as a pure router even in dev, the handlers are mounted as internal HTTP routes on the same service:

```python
# app.py — dev-only internal routes
# The gateway calls these URLs just like it would call a real backend
@app.post("/internal/tools/write_case_note")
def _internal_write_case_note(payload: dict):
    out = write_case_note_handler(WriteCaseNoteInput(**payload))
    return out.model_dump()
```

The tool registry in the DB points at these internal routes:
```
name: write_case_note
endpoint_url: http://localhost:8080/internal/tools/write_case_note
```

So the gateway calls its own internal route. It's the same URL-dispatch pattern as production — just the URL happens to be on the same service.

In production these internal routes don't exist. The URL in the DB points at the real backend, and the Python handlers are gone entirely.

---

## Two UIs — Different Responsibilities

The platform has two separate admin UIs for tools. They serve different purposes and different users.

### Tool Admin UI — `localhost:5200` (shared-infra)

Gateway operator's UI. Manages what tools **exist** in the gateway.

- View all tools — name, description, mode, tags, endpoint URL, schema, status
- Add a new tool — define schema + URL (this is the contract)
- Edit a tool — update description, URL, tags, schema
- Activate / disable a tool
- Delete a tool

**Who uses it:** gateway operator / platform engineer

### Agent Registry UI — `localhost:5173` (agent-factory-ui)

Agent admin's UI. Manages what tools each **agent is allowed to use**.

- In Agent Registry → Tools tab: pick from active tools in the gateway
- Add tool name to agent's `allowed` list
- Agent runtime sees only the tools in its allowed list

**Who uses it:** agent admin / capability owner

### The relationship

```
Tool Admin UI          →     Agent Registry UI
Register tool (active) →     Assign to agent's allowed list
define schema + URL    →     agent can now invoke it
```

Tool Admin UI controls what exists. Agent Registry UI controls what each agent can see. A tool can exist in the gateway but be invisible to every agent — until an admin explicitly assigns it.

---

## Knowledge Base Management

The Tool Admin UI includes a **Knowledge Base** section (`/kb`) for managing documents indexed in the vector store. This is what the `search_kb` retrieval tool searches against.

### What it shows

- All documents currently indexed in the vector store
- Per document: title, doc ID, chunk count, ingestion date
- Stats bar: total documents, total chunks, embedding model in use

### Upload a document

Click **Upload Document** — accepts `.txt`, `.pdf`, `.md`. The gateway:
1. Reads the file content
2. Splits into overlapping chunks (500 chars, 100 char overlap)
3. Embeds each chunk via OpenAI `text-embedding-3-small`
4. Stores in `kb_documents` table with pgvector

The UI shows a progress bar during ingestion and a success message with chunk count when done.

### Delete a document

Click the delete icon on any document. Confirmation shows the chunk count — all chunks for that document are removed from the vector store. The `search_kb` tool will no longer return content from it.

### KB API endpoints

| Endpoint | What it does |
|---|---|
| `GET /kb/documents` | List all indexed documents with chunk count + ingestion date |
| `GET /kb/stats` | Total docs, total chunks, embedding model |
| `POST /kb/ingest` | Upload file → split → embed → store in vector DB |
| `DELETE /kb/documents/{doc_id}` | Remove document + all its chunks from vector store |

### Roadmap — KB improvements

| Gap | What's needed |
|---|---|
| Re-embed a document | Change embedding model → re-embed without re-uploading the file |
| Multiple KBs | Each retrieval tool has its own KB — admin picks which KB a tool searches |
| KB per tool assignment | Tool Admin UI: assign a KB to a retrieval tool, not just one global KB |
| Chunk preview | View individual chunks for a document — useful for debugging retrieval quality |

---

## How the LLM Sees Tools

At agent runtime startup, the runtime calls `GET /tools/specs` on the gateway. The gateway returns only `active` + `enabled` tools with name, description, input schema, mode, and tags.

The runtime builds an LLM-compatible tool schema from this — the JSON schema that OpenAI function calling expects.

The planner then filters this schema before sending it to the LLM. Two filters apply today:

1. `tools.allowed` in `agent.yaml` — static config, same for every request
2. Context availability — tools that require a field not present in `ctx` (e.g. `assessment_id`) are stripped out

```
Tool Gateway: GET /tools/specs  (active tools only)
     │
     ▼ full active registry
Agent Runtime: filter 1 — agent.yaml allowed list
     │
     ▼ filter 2 — context availability (remove tools missing required ctx fields)
     │
     ▼ filtered schema sent to LLM
LLM sees: prompt + memory context + RAG chunks + filtered tool schema
     │
     ▼ LLM picks tool (or decides no tool needed)
```

### Semantic Tool Filtering — Roadmap

As the tool registry grows, passing all allowed tools to the LLM every turn reduces planner accuracy. The next evolution is **RAG over the tool registry**:

- At startup: embed all tool descriptions into a vector store
- At query time: embed the user prompt, retrieve the top-k most semantically relevant tools
- Pass only those tools to the LLM

```
Future flow:
Filter 1 — agent.yaml allowed list
     ↓
Filter 2 — context availability
     ↓
Filter 3 — semantic search over tool descriptions (embed prompt → top-k most relevant)
     ↓
small, highly relevant tool list → LLM
```

Note: AgentCore (AWS) does semantic tool search out of the box. If the platform moves to AgentCore, this filter is handled natively — no custom build needed. See the AgentCore section below.

No throwaway work — the `description`, `tags`, `mode`, and `primary_arg` fields are already in the DB and are exactly what you'd embed. The only change is one step in the planner filter function.

---

## Current State vs Roadmap

### What's built today

| Capability | Status |
|---|---|
| DB-backed tool registry (PostgreSQL) | ✅ built |
| URL-based dispatch (gateway calls endpoint URL) | ✅ built |
| Input schema validation before dispatch | ✅ built |
| Input + output schema stored in DB | ✅ built |
| Tool lifecycle — draft / active / disabled | ✅ built |
| Tool Admin UI — view, add, edit, delete, activate | ✅ built (`localhost:5200`) |
| KB management UI — upload, list, delete documents | ✅ built (`localhost:5200/kb`) |
| Dev handler pattern — internal routes on gateway | ✅ built |
| Developer reminder checklist on tool save | ✅ built |
| `GET/POST/PATCH/DELETE /tools` management API | ✅ built |
| `GET/POST/DELETE /kb/documents` + `/kb/stats` API | ✅ built |
| Industry separation — gateway per industry | ✅ built |
| Tool tags | ✅ built |

### Roadmap

| Gap | What's needed | Priority |
|---|---|---|
| Auto-register handler to DB on startup | Gateway reads Python handlers at startup and upserts to DB automatically — no manual seed step | Near |
| Bucket hierarchy | Admin defines named hierarchy (Industry → LOB → Region) in Tool Admin UI, maps buckets to tag combinations | Medium |
| Agent bucket assignment | Agent Registry UI: assign agent to bucket — auto-filters tool schema at query time | Medium |
| Semantic tool filtering | RAG over tool descriptions at planner time — embed descriptions at startup, retrieve top-k at query time | Medium |
| Multiple KBs | Each retrieval tool has its own KB — admin assigns KB to tool in Tool Admin UI | Medium |
| Re-embed document | Change embedding model → re-embed without re-uploading | Medium |
| Tool versioning | Version history per tool spec, staged rollout, rollback | Later |
| Config-driven adapter auth | Tool record includes auth config (bearer token, API key, mTLS) — gateway handles auth per tool | Later |
| Tool usage visibility | Tool Admin UI shows which agents are using each tool | Later |
| Output schema validation | Gateway validates tool response against output_schema before returning to agent | Later |
| Chunk preview in KB UI | View individual chunks per document — for debugging retrieval quality | Later |

---

## AgentCore & Enterprise Gateway Patterns

In an enterprise setup, the Tool Gateway described here may not be the only option. AgentCore (AWS) offers its own tool routing and execution layer, including native semantic tool search. Two options:

- **Option 1** — AgentCore as the tool gateway: replace our gateway with AgentCore's native tool routing and semantic search
- **Option 2** — Our gateway sits behind AgentCore as an adapter: AgentCore calls our gateway for tool execution; our gateway handles domain-specific validation and dev handler routing

Both have meaningful tradeoffs depending on where the team is on the build-vs-buy spectrum. See Section 15 (AgentCore / Gateway Pattern) for the full comparison.

The URL-based dispatch design described in this section maps cleanly to either option — whether AgentCore calls our gateway or replaces it, the tool endpoint URL model works in both cases. The DB-backed registry is compatible with AgentCore's tool registration model.
