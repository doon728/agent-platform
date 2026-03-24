# AWS AgentCore Compatibility

## Overview

This platform is fully compatible with Amazon Bedrock AgentCore. The architecture was deliberately designed with swappable backends — meaning AgentCore becomes the managed infrastructure layer underneath an unchanged platform design.

See: `diagrams/agentcore-layers.png`

**Nothing built so far is throwaway.** The overlay pattern, memory architecture, LangGraph graph design, config-driven approach, and HITL design are all cloud-agnostic. AgentCore replaces storage and hosting — not the reasoning, memory model, or agent behavior.

---

## What AgentCore Provides

Amazon Bedrock AgentCore (announced AWS re:Invent 2024) is a managed platform with six services:

| AgentCore Service | What it is |
|---|---|
| **AgentCore Runtime** | Managed container hosting for agent services |
| **AgentCore Memory** | Managed memory API (replaces file-based storage) |
| **AgentCore Observability** | Infrastructure-level metrics + CloudWatch/X-Ray tracing |
| **AgentCore Tool Gateway** | Managed tool catalog + invocation endpoint |
| **AgentCore Identity** | IAM / Cognito-based auth for agents |
| **AgentCore HITL** | Managed human-in-the-loop approval flow |

---

## Observability: Two Levels (Critical Distinction)

This is the most important architectural point when integrating with AgentCore.

### Level 1 — Infrastructure Observability (AgentCore provides this)

AgentCore observability covers the **runtime and infrastructure layer**:

- Container health and uptime
- API invocation counts and latency (`/invocations` endpoint)
- HTTP error rates (4xx, 5xx)
- Tool gateway call counts and latency
- Memory API read/write counts
- CloudWatch metrics dashboards
- X-Ray distributed traces (service-to-service calls)

**What it does NOT see:** anything that happens inside the agent's reasoning loop.

### Level 2 — Agent Observability (our platform provides this)

Our `tracer.py` and `TraceGraph.tsx` UI capture what happens **inside a single agent turn**:

| What we trace | Why it matters |
|---|---|
| Planner decision: `HARD_ROUTE` vs `LLM_ROUTE` | Understand why a tool was or wasn't called |
| Which tool was selected and why | Audit trail for every agent decision |
| Tool input + output payload | Debug wrong tool calls or bad data |
| Memory reads: which scopes, how many items | Understand what context the agent had |
| Memory writes: type (episodic/summary), scope | Track what the agent learned |
| HITL: approval requested, decision received | Full async approval audit trail |
| Token usage per step (planner, responder) | Cost attribution |
| Step-by-step timing (planner/executor/responder) | Find latency bottlenecks inside the agent |

**AgentCore cannot see any of this.** It sees one HTTP call to `/invocations`. What happens between request received and response sent is a black box to AgentCore.

### The Gap — Why Our Tracer Is Not Throwaway

```
AgentCore sees:
  POST /invocations → 200 OK (1.2s)

Our tracer sees:
  planner     → HARD_ROUTE: get_assessment_tasks (12ms)
  executor    → tool call: get_assessment_tasks:A001 → {tasks: [...]} (340ms)
  memory read → 5 episodic items from case scope (8ms)
  responder   → 412 tokens, answer generated (850ms)
  memory write → short-term turn written, episodic skipped (no tool_success flag) (5ms)
```

This agent-level observability is what makes the platform debuggable and auditable. It is a core platform feature — not replaceable by AgentCore's infrastructure metrics.

### Integration Path: Both Layers Together

On AgentCore, we run both:

```
AgentCore Observability  →  infra metrics (CloudWatch dashboards, alerts)
Our Tracer               →  agent traces (in-memory + UI, optionally emitted to CloudWatch Logs)
```

To emit agent traces to CloudWatch Logs (structured JSON) alongside AgentCore metrics:

```python
# tracer.py — add CloudWatch emit alongside existing in-memory store
import boto3
logs_client = boto3.client("logs")

def record_trace(trace: dict):
    _in_memory_store.append(trace)          # existing — feeds UI TraceGraph
    _emit_to_cloudwatch(trace)              # new — feeds CloudWatch Logs Insights

def _emit_to_cloudwatch(trace: dict):
    logs_client.put_log_events(
        logGroupName="/agentplatform/agent-traces",
        logStreamName=trace["thread_id"],
        logEvents=[{"timestamp": now_ms(), "message": json.dumps(trace)}]
    )
```

This gives you agent-level traces searchable in CloudWatch Logs Insights, without losing the real-time UI trace panel.

---

## Component-by-Component Mapping

### Memory

| Our Component | AgentCore Swap | What stays unchanged |
|---|---|---|
| `file_memory.py` | AgentCore Memory API | `context_builder.py`, `write_engine.py`, `scope_resolver.py`, `memory.yaml` config |
| `/state/memory/` folder | AgentCore managed storage | All memory concepts (short-term, episodic, semantic, summary, scope hierarchy) |

The memory model — scoped hierarchy (conversation → assessment → case → member), rollup, write policies — is our design. AgentCore Memory is a storage backend, not a memory architecture. Our memory architecture is the differentiator.

**Swap point:** `file_memory.py` only. One file. Everything above it unchanged.

```python
# file_memory.py — current
def write_memory(tenant_id, scope, scope_id, entry):
    path = f"/app/state/memory/{tenant_id}/{scope}/{scope_id}.json"
    _write_json(path, entry)

# file_memory.py — AgentCore version
def write_memory(tenant_id, scope, scope_id, entry):
    agentcore_memory.put(
        namespace=f"{tenant_id}/{scope}/{scope_id}",
        entry=entry
    )
```

---

### HITL

| Our Component | AgentCore Swap | What stays unchanged |
|---|---|---|
| `InternalHITLAdapter` | `AgentCoreHITLAdapter` | `HITLAdapter` interface, executor logic, episodic memory write on decision |

HITL was explicitly designed with Option C (pluggable adapter). The swap is a one-line change in adapter initialization.

```python
# Before (internal adapter, works on laptop)
hitl_adapter = InternalHITLAdapter()

# After (AgentCore managed HITL)
hitl_adapter = AgentCoreHITLAdapter(region="us-east-1")
```

---

### Tool Gateway

Two migration paths — choose based on scale:

**Path A — Lift and Shift (zero code change)**
Deploy existing tool-gateway container to ECS. Register the ECS endpoint in AgentCore's tool catalog. No changes to `registry.py`, `pg_store.py`, or any tool handler.

**Path B — Native AgentCore Tools**
Migrate tool handlers to AgentCore Tool Gateway format. The registration pattern is similar — name, description, input schema, handler. Tools with PostgreSQL queries can reuse `pg_store.py` as-is.

Start with Path A. Migrate to Path B tool-by-tool if needed.

---

### Auth

| Our Component | AgentCore Swap |
|---|---|
| `auth.py` (OPTIONAL mode, JWT) | IAM role-based auth or Cognito token validation |
| `authorization.py` (tenant isolation) | Unchanged — tenant isolation is our logic, not AgentCore's |

---

### Runtime / Deployment

| Local | AgentCore |
|---|---|
| `docker compose up` | `agentcore deploy` or ECS task definition |
| `docker-compose.yml` | ECS task def + ALB routing |
| `.env` file | AWS Secrets Manager + Parameter Store |
| Volume mounts for memory | AgentCore Memory (managed) |

The container itself (Dockerfile, Python code, overlay structure) is unchanged.

---

## Migration Path (Incremental — No Big Bang)

Each phase is independent and reversible. Run in local Docker throughout.

```
Phase 1 — Host on AWS (no code change)
  └─ Deploy containers to ECS/Fargate
  └─ RDS instead of local postgres
  └─ Secrets Manager instead of .env
  └─ Result: same code, managed infra

Phase 2 — Swap Memory Backend
  └─ Replace file_memory.py → AgentCore Memory API
  └─ One file change
  └─ All memory concepts, config, UI unchanged

Phase 3 — Add Agent Traces to CloudWatch
  └─ Add CloudWatch emit to tracer.py
  └─ In-memory store + UI TraceGraph still works
  └─ Now searchable in CloudWatch Logs Insights too

Phase 4 — Swap HITL Adapter
  └─ Replace InternalHITLAdapter → AgentCoreHITLAdapter
  └─ One line change
  └─ Approval Console UI unchanged

Phase 5 — Register Tools in AgentCore Tool Gateway
  └─ Register existing tool-gateway ECS endpoint (Path A)
  └─ Or migrate tools natively (Path B, optional)

Phase 6 — Auth (prod only)
  └─ Replace OPTIONAL auth mode → Cognito/IAM validation
```

---

## What Never Changes Regardless of AgentCore

These are the platform's durable assets — they work locally, on ECS, on AgentCore, or any other runtime:

- **Overlay pattern** — agent types as self-contained folders (`overlays/{agent_type}/`)
- **LangGraph graph structure** — planner → executor → responder node wiring
- **Agent-level observability model** — trace schema, step types, what we capture
- **Memory architecture** — scope hierarchy, rollup model, 4 memory types, `memory.yaml` config
- **Config-driven design** — `agent.yaml`, `memory.yaml`, overlay manifests
- **Template-first workflow** — template → generated repo scaffolding
- **HITL adapter interface** — `HITLAdapter` abstract class, pluggable implementations
- **Tool registry pattern** — ToolSpec, input/output schema, handler function
- **Tenant isolation** — `authorization.py`, all queries scoped to `tenant_id`

---

## Summary

| | Throwaway? | Notes |
|---|---|---|
| LangGraph overlays | No | AgentCore Runtime runs containers as-is |
| Memory architecture | No | Concepts map directly; only storage backend swaps |
| Agent-level observability | No | AgentCore doesn't provide this — it's our differentiator |
| HITL design | No | Pluggable adapter swaps in one line |
| Tool registry pattern | No | Works in AgentCore tool catalog too |
| Config files (agent.yaml etc.) | No | Our config layer sits above AgentCore |
| `file_memory.py` | Yes (Phase 2) | Replaced by AgentCore Memory API |
| `docker compose up` | Yes (Phase 1) | Replaced by ECS / agentcore deploy |
| `.env` files | Yes (Phase 1) | Replaced by Secrets Manager |
| `auth.py` OPTIONAL mode | Yes (Phase 6) | Replaced by Cognito/IAM in prod |
