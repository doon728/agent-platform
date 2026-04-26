# Platform Overview

## What Is This Platform?

An enterprise AI agent platform for building healthcare care management assistants. It is:

- **Template-driven** — new usecases and agents are created by scaffolding from templates, not by writing code from scratch
- **Configuration-driven** — agent behavior (tools, memory, risk, prompts) is controlled entirely via YAML config files
- **Overlay-based** — different agent types (chat, summary, multi-agent) are swappable plugins with no platform code changes
- **Memory-aware** — hierarchical scoped memory at conversation, assessment, case, and member level with rollup
- **Observable** — every planner decision, tool call, and memory write is visible in the UI in real time
- **HITL-ready** — high-risk tool calls require human approval before execution (async, nurse not blocked)

---

## High-Level Architecture

See: `diagrams/platform-architecture.png`

Three runtime services + one database:

| Service | Port | What it does |
|---------|------|-------------|
| UI | 3000 | React app — nurse workflow, chat, memory panel, approval console |
| Agent Runtime | 8081 | FastAPI — LangGraph orchestration, memory, planning, tool execution |
| Tool Gateway | 8080 | FastAPI — exposes healthcare data tools + knowledge base search |
| PostgreSQL | 5433 | Structured data (members, assessments, cases, tasks) + pgvector (KB) |

---

## Request Flow (one nurse message)

See: `diagrams/agent-request-flow.png`

```
Nurse types message
    → UI POST /invocations to Agent Runtime
    → Agent Runtime builds context (memory, assessment_id, thread)
    → LangGraph graph starts
    → Planner node: decides which tool to call (HARD_ROUTE or LLM_ROUTE)
    → Router: converts planner output to tool call input
    → Executor: calls Tool Gateway POST /tools/invoke
    → Tool Gateway: hits PostgreSQL or pgvector, returns result
    → Responder: calls OpenAI with context + tool result → generates answer
    → Memory write: short-term turn written, episodic if tool_success
    → Trace recorded
    → Response returned to UI
    → Memory Panel + Execution Graph updated in UI
```

---

## Key Concepts

### Capability
A business domain. Example: `care-management`, `appeals-management`, `payment-integrity`.
Each capability has its own tool gateway, data, and UI.

### Usecase
A specific AI workflow inside a capability. Example: `UC_PreCall_Assess`, `UC_PostCall_Document`.
Each usecase gets its own agent repo and its own running container.

### Agent Type (Overlay)
The AI reasoning pattern. Example: `chat_agent`, `summary_agent`, `multi_agent_supervisor`.
Each agent type is a self-contained overlay folder — manifest, config, graph, nodes.

### Overlay
The agent-specific code and config. Lives at `overlays/{agent_type}/` in the repo.
Contains: `agent_manifest.yaml`, `config/agent.yaml`, `agents/`, `graph/`, `orchestration/`.

### Tool Gateway
A separate FastAPI service that owns all data access. Agent runtime calls it via HTTP.
Tools are registered in a registry, discovered at startup, called via `/tools/invoke`.

### Memory
File-based scoped memory at 4 levels: conversation → assessment → case → member.
Upper scopes automatically roll up child memories on read.
4 memory types: short-term (recent turns), episodic (events), semantic (facts), summary (compressed).

### HITL
Human-in-the-Loop. High-risk tools (write_case_note) require approval before execution.
Approval is async — nurse can continue chatting while waiting.
Decision (approved/rejected + reason) is written to episodic memory.

---

## Template-First Rule

All code lives in templates. Generated repos are copies.

> **ALWAYS edit template files first, then copy to generated repo.**
> Never edit the generated repo directly.

```
templates/overlay-templates/    ← edit here
templates/capability-ui-template/    ← edit here

generated-repos/care-management/     ← copy to here
```
