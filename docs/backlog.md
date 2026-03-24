# Platform Backlog

Items agreed to build but not yet implemented. Prioritize as needed.

---

## RAG Config — Wire YAML Parameters to Retriever

**What:** `agent.yaml` retrieval section should drive actual RAG behavior. Right now `top_k`, similarity threshold, embedding model, and strategy are hardcoded in `retriever.py` as env var defaults and never read from YAML.

**What needs to be built:**
1. Expand `agent.yaml` retrieval section — add `top_k`, `similarity_threshold`, `strategy`, `rerank`, `sources`
2. Executor passes retrieval params in tool invocation input when calling `search_kb`
3. `retriever.py` honors `top_k` and `threshold` from tool input (function signature already accepts `top_k`)
4. Tool registry `search_kb` input model — add `top_k` and `threshold` as optional fields

**Current gap:** YAML config → `ctx["retrieval"]` is injected correctly but the actual retriever ignores it and uses env var defaults.

**Files to touch:**
- `overlays/chat_agent/config/agent.yaml` — expand retrieval section
- `overlays/chat_agent/agents/executor.py` — pass retrieval params when invoking search_kb
- `shared-infra/.../src/rag/retriever.py` — accept threshold param
- `shared-infra/.../src/tools/registry.py` — add optional fields to search_kb input model

---

## Multi-RAG Pattern Support

**What:** An agent should be able to configure multiple RAG patterns (vector, graph, hybrid, self-corrective) per usecase, with routing between them. See `docs/backlog.md` RAG patterns design note below.

**What needs to be built:**
1. `agent.yaml` retrieval section supports multiple named strategies with per-strategy params
2. Retrieval sub-graph or retrieval router node — planner routes to correct RAG pattern based on query type
3. Each pattern is a separate tool or sub-node: `search_kb_vector`, `search_kb_graph`, `search_kb_hybrid`
4. CRAG (self-corrective): retrieval → grade relevance → re-retrieve or web search if poor

**Design note:** See RAG patterns section below.

**RAG routing decision (how the system picks which pattern):**
The strategy is NOT selected from the UI at agent creation. It is determined at runtime based on the query/prompt. Three mechanisms, used in combination:
1. **HARD_ROUTE rules** — keyword patterns in prompt trigger specific retrieval tool deterministically (e.g. "ICD-10" → keyword search, "linked to" → graph search). Zero LLM cost.
2. **LLM routing** — planner reads tool descriptions and picks the right retrieval tool based on query semantics. Works automatically if tools have distinct descriptions.
3. **Quality-based escalation (CRAG)** — start with vector, grade relevance, re-retrieve with hybrid if poor. Runs as retrieval sub-graph, main planner doesn't know about it.

**UI RAG config at agent creation (what IS configured upfront):**
- RAG on/off toggle — universal, every agent type
- When on: knowledge base sources (multi-select), strategy options enabled (which patterns are available), top_k, self-correction on/off, fallback behavior
- Options shown adapt to agent type: `chat_agent` shows all options; `summary_agent` shows sources + top_k only; `multi_agent` shows nothing (RAG lives on sub-agents)
- UI does NOT expose: similarity threshold (hidden behind precision slider), embedding model (platform default), hard route rules (agent code)
- Requires: `GET /knowledge-bases` endpoint on tool gateway + `source` param on `search_kb` tool

---

## UI-Driven Agent Config (agent.yaml from UI)

**What:** `agent.yaml` is currently a static file baked into the container. UI needs to read and write it so agent behavior (tools, RAG params, memory, risk) can be configured without touching files.

**What needs to be built:**
1. Mount `overlays/{agent_type}/config/` as a Docker volume so it's writable at runtime (not baked in)
2. `GET /config` endpoint on agent-runtime — returns current agent.yaml as JSON
3. `PATCH /config` endpoint — accepts partial update, writes to agent.yaml on disk, takes effect on next request (no restart needed — `load_agent_config()` is already called per-request)
4. Agent config page in UI — form with tools, RAG params (top_k, threshold, strategy, self-correction), memory toggles, risk/HITL flag. Calls `PATCH /config` on save.

**Why no restart needed:** `langgraph_runner.py` calls `load_agent_config()` on every `/invocations` request — config is always read fresh from disk.

**Flow:**
```
UI config page → PATCH /config → agent.yaml updated on volume → next request picks it up automatically
```

---

## HITL — Build Async Approval System

**What:** Full async HITL implementation per `docs/hitl-design-spec.md`

**What needs to be built:**
- PostgreSQL `approval_requests` table
- `POST /hitl/request` — save approval request, return PENDING to nurse
- `POST /hitl/decide` — supervisor submits approved/rejected + reason
- `GET /hitl/requests` — list pending requests for Approval Console UI
- Resume flow — on approval, execute the tool and return result to nurse
- Write decision to episodic memory
- Nurse UI: pending banner while waiting
- Supervisor UI: Approval Console page

---

## AgentCore — Memory Backend Swap

**What:** Replace `file_memory.py` with AgentCore Memory API call. One file change. All memory concepts, config, and UI unchanged.

---

## AgentCore — Emit Agent Traces to CloudWatch

**What:** Add CloudWatch Logs emit to `tracer.py` alongside existing in-memory store. Agent-level traces (planner decisions, tool calls, memory events) become searchable in CloudWatch Logs Insights.

---

## Summary Agent Overlay

**What:** New `summary_agent` overlay — batch summarizer for post-call documentation. New graph with different nodes (no planner, direct summarizer → writer flow).

---

## Case-Level and Member-Level Chat Panels

**What:** Chat panels at case and member level (not just assessment level) with full 3-column layout — Memory Panel + Execution Graph. Currently only `AssessmentView` has the full layout.

---

## Merge taxonomy-refactor-v1 → main

**What:** Current branch has all refactor work (capability-packs removal, config moved to overlays, usecase.yaml → agent.yaml rename) plus all documentation. Needs to be merged to main before other work continues.

---

## Fresh Repo Generation Test

**What:** Delete generated repo, scaffold fresh from template, verify end-to-end. Confirm template-first workflow produces a working repo with no manual fixups needed.

---

## PowerPoint Generation

**What:** Use `python-pptx` to generate a platform overview deck from the docs. Slides covering: architecture, request flow, memory hierarchy, HITL flow, AgentCore compatibility, config guide, how-to-extend.

---

---

# Design Notes

## RAG Patterns — Multi-Strategy Design

An agent can have more than one RAG pattern active simultaneously. LangGraph makes this natural because each pattern is a node or sub-graph.

### The RAG Patterns

| Pattern | What it does | When to use |
|---|---|---|
| **Vector / Semantic** | Embed query → cosine similarity against pgvector | General knowledge base search (what we have now) |
| **Keyword / BM25** | Traditional keyword match | Exact term search, codes, IDs, structured fields |
| **Hybrid** | Vector + keyword with score fusion (RRF) | Best of both — relevance + precision |
| **Graph RAG** | Traverse entity-relationship graph | "Which cases are related to member M001?" — relationship queries |
| **Self-Corrective (CRAG)** | Retrieve → grade relevance → re-retrieve if poor | High-stakes queries where bad retrieval = bad answer |
| **HyDE** | Generate hypothetical answer → embed that → retrieve | When query phrasing differs from document phrasing |
| **Multi-hop** | Multiple retrieval steps, each informed by previous | Complex questions requiring synthesis across docs |
| **Agentic RAG** | LLM decides when/what to retrieve, multiple rounds | Open-ended research questions |

### How Multiple Patterns Work in One Agent

**Option A — Source routing (different patterns for different data sources)**
```yaml
retrieval:
  sources:
    - name: clinical_kb
      tool: search_kb
      strategy: semantic
      top_k: 5
      threshold: 0.40
    - name: member_docs
      tool: search_member_docs
      strategy: hybrid
      top_k: 3
    - name: entity_graph
      tool: search_graph
      strategy: graph
```
Planner picks which source based on query type. Each source has its own strategy and parameters.

**Option B — Sequential pipeline (CRAG style)**
```yaml
retrieval:
  pipeline:
    - step: retrieve
      strategy: semantic
      top_k: 5
    - step: grade           # LLM grades retrieved chunks for relevance
      threshold: 0.7        # if avg relevance < 0.7, go to next step
    - step: re_retrieve     # re-retrieve with refined query
      strategy: hybrid
    - step: fallback        # if still poor, web search or escalate
      action: allow_no_results_response
```

**Option C — Query routing (different patterns for different question types)**
```yaml
retrieval:
  router:
    factual_questions: semantic          # "what is the coverage for X"
    relationship_questions: graph        # "what cases relate to this member"
    exact_term_questions: keyword        # "find ICD-10 code Z87.891"
    complex_questions: agentic           # "summarize all prior auth denials for M001"
```
Planner classifies query type, routes to correct retrieval strategy.

### Design implication for our platform

Each strategy maps to a tool (or a retrieval sub-graph). The `retrieval` section in `agent.yaml` grows to describe which strategies are active, with params per strategy. The planner uses `ctx["retrieval"]` to decide which to invoke. The LangGraph overlay can have a `retrieval_subgraph` node that handles the multi-step pipeline internally, keeping the main graph clean.
