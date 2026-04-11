# Runtime Split — 2-Container Architecture Design

## Overview

The agent runtime is split into two containers to support edge/customer VPC deployment without exposing platform IP, and to enable a shared platform-services layer across all agents and capabilities per customer.

**Industry alignment:** This is the enterprise-standard control plane / execution plane split used by Anthropic (brain/hands decoupling), AWS Bedrock AgentCore, Google Cloud, and Microsoft Azure multi-agent patterns. Reasoning strategies are kept centralized per Anthropic/LangChain production guidance — not pushed to edge.

---

## Container Responsibilities

### Container 1 — Runtime Shell (customer VPC or edge)

Thin orchestration shell. Zero business logic, zero IP. Deploys per agent, per customer.

| File | Purpose |
|------|---------|
| `app.py` | FastAPI entrypoint — receives requests, attaches tenant context |
| `langgraph_runner.py` | Runs the LangGraph graph, manages graph state |
| `graph/build_graph.py` | Graph topology only — nodes/edges wiring, no logic |
| `auth.py`, `authorization.py` | Validates caller identity |
| `clients/config_client.py` | Fetches resolved runtime config from Container 2 |
| `clients/strategy_client.py` | Calls Container 2 for reasoning strategy execution |
| `clients/memory_client.py` | Calls Container 2 for memory read/write |
| `clients/rag_client.py` | Calls Container 2 for RAG retrieval |
| `clients/tools_client.py` | Calls Container 2 for tool routing and execution |
| `state_store.py` | Local in-graph state only |
| `hitl/approval_store.py` | Tracks pending approvals, pause/resume graph state |

### Container 2 — Platform Services (your VPC)

All platform intelligence and IP. Deployed once per customer, shared across all their agents and capabilities.

| File | Purpose |
|------|---------|
| `strategies/react.py` | ReAct reasoning loop |
| `strategies/simple.py` | Simple direct response |
| `strategies/plan_execute.py` | Plan-then-execute reasoning |
| `tools/router.py` | Tool selection logic — your IP |
| `tools/registry.py`, `bootstrap.py` | Tool registration and wiring |
| `tools/bindings.py`, `validation.py` | Tool contract enforcement |
| `tools/discovery.py` | Tool metadata and semantic matching |
| `tool_gateway_client.py` | Calls MCP server / Tool Gateway |
| `memory/context_builder.py` | Pre-graph memory read |
| `memory/scope_resolver.py` | Scope-based memory resolution |
| `memory/write_engine.py` | Post-graph memory write |
| `memory/semantic_engine.py` | Semantic memory LLM extraction |
| `memory/summary_engine.py` | Summary memory generation |
| `memory/file_memory.py`, `memory_store.py` | Memory backends |
| `rag/runner.py` | RAG orchestration |
| `rag/patterns/naive.py` | Naive RAG pattern |
| `rag/patterns/hyde.py` | HyDE RAG pattern |
| `rag/patterns/multi_hop.py` | Multi-hop RAG pattern |
| `rag/patterns/agentic.py` | Agentic RAG pattern |
| `rag/patterns/self_corrective.py` | Self-corrective RAG pattern |
| `config/resolver.py` | Merges all YAMLs → resolved runtime config |
| `hitl/adapters/*` | HITL approval adapters |
| `hitl/memory_writer.py` | Writes HITL approval outcome to memory (post-graph) |
| `observability/tracer.py`, `tracing.py` | Trace store and telemetry |
| `usecase_config_loader.py`, `manifest_loader.py` | Config and manifest loading |
| `llm/responder.py` | LLM response generation |

---

## Overlay Structure Change

### Today (combined overlay per agent type + strategy)
```
overlays/
  chat_agent_simple/       ← agent type + strategy combined
  chat_agent_react/
  summarization_agent_simple/
```

### After split (agent type overlay in Container 1, strategy in Container 2)
```
# Container 1 — graph topology only, no strategy suffix
overlays/
  chat_agent/              ← graph wiring only
  summary_agent/           ← graph wiring only

# Container 2 — strategies selected at runtime via config
strategies/
  react.py
  simple.py
  plan_execute.py
```

**Key benefit:** Adding a new reasoning strategy no longer requires a new overlay. One `chat_agent` overlay works with any strategy — strategy is a config param (`reasoning_mode: react`).

---

## Resolved Runtime Config (11b)

All source YAMLs (`agent.yaml`, `memory.yaml`, `rag.yaml`, `tools.yaml`, `routing.yaml`) are merged by Container 2's `config/resolver.py` into a single `resolved_runtime_config.yaml` at deploy/save time.

Container 1 loads only this one file at startup. No config parsing logic in the shell.

**Resolution trigger:** Admin saves any config tab in Agent Registry UI → Support API calls Container 2 resolver → writes new `resolved_runtime_config.yaml` → Container 1 hot-reloads.

**Versioning:** Every resolved config is versioned (timestamp + hash) for audit and rollback.

---

## Deployment URL — env var driven

Container 1 points at Container 2 via a single env var:

```
# Same VPC (co-located)
PLATFORM_SERVICES_URL=http://platform-services:8080

# Cross-VPC (customer VPC shell → your VPC services)
PLATFORM_SERVICES_URL=https://platform.yourvpc.com
```

Same Container 1 image deploys anywhere. No code changes.

---

## HITL Grey Area

HITL state straddles both containers:

- **Container 1** — `hitl/approval_store.py` tracks pending approvals and manages graph pause/resume. Must be local — graph can't resume across a network call.
- **Container 2** — `hitl/memory_writer.py` writes the approval outcome (what was approved, by whom, when) to memory post-graph.

Container 1 calls Container 2 after approval resolves — same pattern as all other post-graph writes.

---

## Repo Structure After Split

### Scaffolded per agent (Container 1 only)
```
agents/
  care-management/
    pre-call-assessment/
      overlays/
        chat_agent/          ← graph topology only
        summary_agent/
      services/
        agent-runtime/       ← Container 1 shell
          src/
            platform/
              app.py
              langgraph_runner.py
              clients/
                config_client.py
                strategy_client.py
                memory_client.py
                rag_client.py
                tools_client.py
          .env               ← PLATFORM_SERVICES_URL=...
        chat-ui/
        summary-ui/
```

### Deployed once per customer (Container 2)
```
shared-infra/
  platform-services/
    src/
      strategies/
      tools/
      memory/
      rag/
      config/
      hitl/
      observability/
    Dockerfile
```

---

## Platform-Core Relationship

Platform-core **becomes Container 2** — exposed as an HTTP service, not a shared library.

Shared library pattern is an anti-pattern for agent platforms (creates version lock-in, deployment coupling per Microsoft microservices guidance). One service, all agent shells call it over HTTP.

---

## Key Design Constraints

| Constraint | Mitigation |
|-----------|-----------|
| Latency — network hop on every node call | Cache resolved config + tool metadata at Container 1 startup |
| Inter-service auth | mTLS or signed JWT between Container 1 and Container 2 |
| Container 2 unreachable | Circuit breakers in Container 1 — fail gracefully |
| Strict customers (zero data leaving boundary) | Container 2 services deployable customer-side individually — same Container 1, different `PLATFORM_SERVICES_URL` |
| Config staleness | Versioned resolved config, hot-reload on change |
| Resolved config sensitivity | Treat as sensitive artifact — encrypt at rest, do not log raw |

---

## What Needs to Change (Implementation)

### Container 1 code changes
- `langgraph_runner.py` — remove direct strategy/memory/RAG/tool calls, replace with HTTP client calls
- `graph/build_graph.py` — remove direct tool bootstrap, call `tools_client.py`
- Remove `agents/strategies/` from overlays entirely

### New files to write (Container 1)
- `clients/config_client.py`
- `clients/strategy_client.py`
- `clients/memory_client.py`
- `clients/rag_client.py`
- `clients/tools_client.py`

### Container 2 code changes
- `tools/router.py`, `bootstrap.py` — wrap in FastAPI endpoints
- `memory/context_builder.py`, `write_engine.py` — expose as HTTP endpoints
- `rag/runner.py` — expose as HTTP endpoint
- `strategies/react.py`, `simple.py`, `plan_execute.py` — moved from overlays, expose as HTTP endpoints

### New files to write (Container 2)
- `config/resolver.py` — merges all YAMLs into resolved runtime config
- `main.py` — FastAPI app exposing all platform service endpoints

---

## Component Change Summary

### Admin UI (Agent Registry / Agent Factory)
- **No UI redesign** — same tabs, same fields, same UX
- **One new trigger:** after any config save → support API calls Container 2 `POST /resolve-config` to regenerate resolved runtime config
- **Optional:** add "Resolved Config" preview in Overview tab so admin can see the merged output

### Tool Gateway
- **No changes to Tool Gateway itself** — tool execution logic unchanged
- **Caller changes only:** today Container 1 calls Tool Gateway directly; after split Container 2 calls it
- `tool_gateway_client.py` moves from Container 1 → Container 2

### Capability Mini UI (chat-ui, summary-ui)
- **No changes** — mini UI still calls Container 1's `/chat` or `/summarize` endpoint
- Container 1 URL is unchanged from the mini UI's perspective
- Mini UI has no awareness of the split

### Support API
- **One change:** after writing any YAML → call Container 2 `POST /resolve-config` to regenerate resolved runtime config
- Everything else unchanged

### Platform-Core
- **No logic changes** — stays in your VPC as Container 2
- **Only change:** wrap existing logic in FastAPI endpoints so Container 1 calls over HTTP instead of importing directly
- Same code, same logic, new interface

---

## Agent Type + Reasoning Strategy — How It Works

### Today (combined overlay)
Agent type and reasoning strategy are tightly coupled into one overlay folder per combination:
```
overlays/
  chat_agent_simple/       ← full code: graph + simple strategy logic
  chat_agent_react/        ← full code: graph + react strategy logic
  summary_agent_simple/    ← full code: graph + simple strategy logic
  workflow_agent_react/    ← full code: graph + react strategy logic
```

- Strategy is **pre-selected per agent type at scaffold time** — not runtime-configurable
- Each overlay contains duplicated graph wiring AND duplicated strategy logic
- Adding a new strategy = new overlay folder for every agent type that needs it
- Bug in `react.py` logic = fix in every overlay that uses react — not just one place
- 4 agent types × 3 strategies = potentially 12 overlay folders

### After split

**One overlay per combination is still required** — strategy is still pre-selected at scaffold time, not runtime-configurable. This does not change.

**What changes:** each overlay becomes a thin graph skeleton. Strategy logic moves to Container 2 and lives once, shared across all overlays that use it.

```
# Container 1 — still one overlay per combination (same as today)
overlays/
  chat_agent_simple/       ← THIN: graph topology only, calls Container 2 simple
  chat_agent_react/        ← THIN: graph topology only, calls Container 2 react
  summary_agent_simple/    ← THIN: graph topology only, calls Container 2 simple
  workflow_agent_react/    ← THIN: graph topology only, calls Container 2 react

# Container 2 — strategy logic lives ONCE, shared by all overlays
strategies/
  react.py                 ← POST /strategy/react  (used by chat_agent_react, workflow_agent_react)
  simple.py                ← POST /strategy/simple (used by chat_agent_simple, summary_agent_simple)
  plan_execute.py          ← POST /strategy/plan-execute
```

**The real win — fix once, all agents get it:**
- Bug in ReAct loop today → fix in `chat_agent_react/strategies/react.py` AND `workflow_agent_react/strategies/react.py` (duplicated)
- Bug in ReAct loop after split → fix in Container 2 `strategies/react.py` once → all agent overlays using react get the fix automatically
- Same applies to adding improvements, tuning prompts, changing loop logic

**Runtime flow:**
1. Container 1 loads `chat_agent_react` overlay — builds the thin graph topology
2. Container 1 reads resolved config: `reasoning_mode: react`
3. At the planner node, Container 1 calls `strategy_client.py → POST /strategy/react`
4. Container 2 runs the ReAct loop, returns next action
5. Container 1 executes the action (tool call via `tools_client.py`)
6. Repeat until done

**Adding a new strategy:** add one file in Container 2 + expose endpoint. No overlay changes. No Container 1 changes.

**Switching strategy for an agent:** change `reasoning_mode` in agent.yaml → resolved config regenerates → done.

---

## Latency Impact vs Today

### What adds latency (honest assessment)
Today all logic runs in-process — function calls with zero network overhead. After split, several steps become HTTP calls:

| Step | Today | After split | Added latency |
|------|-------|-------------|---------------|
| Config load | local file read | HTTP GET /resolve-config (startup only, cached) | ~0ms at runtime |
| Pre-graph memory read | in-process | HTTP POST /memory/read | +5–20ms |
| Tool routing | in-process | HTTP POST /tools/route | +5–15ms |
| Strategy call (per turn) | in-process | HTTP POST /strategy/react | +10–30ms per turn |
| Post-graph memory write | in-process | HTTP POST /memory/write | +5–20ms (async, non-blocking) |
| RAG retrieval | in-process | HTTP POST /rag/retrieve | +10–30ms |

### Total added latency per request
- **Same VPC** (both containers co-located): ~20–50ms total added — negligible
- **Cross-VPC** (Container 1 customer side, Container 2 your VPC): ~50–150ms total added — noticeable but acceptable for care management workflows (not real-time)

### How to mitigate

| Mitigation | What it solves |
|-----------|---------------|
| Cache resolved config at Container 1 startup | Eliminates config fetch on every request |
| Cache tool registry + tool metadata at startup | Eliminates tool routing round trip for known routes |
| Hard route match in Container 1 before calling Container 2 | Skips strategy call entirely for deterministic routes |
| Post-graph writes async (fire and forget) | Memory write, trace, observability don't block response |
| Co-locate containers same VPC where latency is critical | Reduces cross-network hops to ~1ms |
| Connection pooling between Container 1 and Container 2 | Eliminates TCP handshake overhead on every call |

### Bottom line
For healthcare payer workflows (care management, case research, prior auth) — added latency is acceptable. These are not sub-100ms real-time interactions. A well-mitigated same-VPC deployment adds ~20–50ms which is not user-perceptible. Cross-VPC adds ~100–150ms which is still within acceptable range for the use cases you are targeting.

---

## Environment Config — Local vs Remote

Container 1 uses a single env var to locate Container 2. Same image, no code changes:

```bash
# .env.local — both containers co-located (same VPC / local dev)
PLATFORM_SERVICES_URL=http://platform-services:8080

# .env.remote — Container 1 customer VPC, Container 2 your VPC
PLATFORM_SERVICES_URL=https://platform-services.yourvpc.com

# .env.dev — local development
PLATFORM_SERVICES_URL=http://localhost:8001
```

All clients in Container 1 read `PLATFORM_SERVICES_URL` as their base URL. Switching deployment model = swap the `.env` file.

---

## AgentCore Deployment

When deploying via AWS AgentCore, two container images are registered:

- **Image 1** — `agent-runtime-shell` (Container 1) — one per agent type+strategy combination, deployed per customer capability
- **Image 2** — `platform-services` (Container 2) — one per customer, shared across all their agents

AgentCore manages lifecycle (scaling, health, restart) for both. Container 1 connects to Container 2 via `PLATFORM_SERVICES_URL` set in AgentCore environment config.

---

## Tool Gateway / MCP Server Placement

Tool Gateway and MCP server live in **your VPC alongside Container 2** (platform services). They are never deployed to customer VPC directly.

```
Your VPC
  Container 2 (platform-services)
    tools/router.py          ← selects which tool to call
    tools/registry.py        ← knows all registered tools
    tool_gateway_client.py   ← calls Tool Gateway

  Tool Gateway / MCP Server
    healthcare tool implementations
    customer API adapters
    calls customer-exposed APIs
```

Container 2 handles tool selection and routing. Tool Gateway handles tool execution. Customer systems are accessed via secure customer-exposed APIs — data comes back to your VPC, gets processed, result returns to Container 1.

### MCP Client + Server — both on your VPC

MCP Client lives in Container 2 (`tools/router.py`). MCP Server is the Tool Gateway. Both on your VPC — this is the standard enterprise pattern (Anthropic, AWS Bedrock, Google all centralize tool orchestration).

MCP Server on customer side is only needed for zero-data-leaving-boundary requirements — see section below.

### Considerations behind keeping MCP server on your VPC

| Consideration | Detail |
|--------------|--------|
| IP protection | Tool selection logic, healthcare domain tools, canonical schemas stay yours |
| One fix, all customers | Fix a tool once in Tool Gateway — all customers get it immediately |
| Simpler operations | One Tool Gateway to manage, not one per customer |
| Trade-off | Customer data crosses boundary on tool call — mitigated by PHI masking pre-LLM and TLS encryption in transit |

---

## Zero Data Leaving Boundary

Moving only the MCP server to customer VPC **does not solve the data boundary problem**. Data still flows back to Container 1 (your VPC) for the agent to process. The only clean solution is moving **both containers** to customer VPC.

```
# Partial move — does NOT solve data boundary
Customer VPC: MCP Server only
Your VPC: Container 1 + Container 2        ← data still comes here

# Full zero-boundary model — correct
Customer VPC: Container 1 + Container 2 + Tool Gateway/MCP Server
Your VPC: control plane only (config UI, templates, evaluation, observability dashboard)
```

Same container images, same code. Only `PLATFORM_SERVICES_URL` and tool registry URLs change via env vars.

---

## Customer Adapter Tools — How Per-Customer Variation Works

### Tool structure (two parts)

Every tool has two parts — the implementation (shared, your IP) and the registration (per customer, config only):

| Part | Where | Per customer? |
|------|-------|--------------|
| Tool implementation | Tool Gateway (your VPC) | No — one shared implementation |
| Tool registration (endpoint URL, auth, field mapping) | Tool registry (DB) | Yes — one row per customer per tool |

The tool code never changes per customer. Only the registry entry changes.

**Example:** `get_case_details`
- Customer A: calls `https://epic.customerA.com/api/cases`, uses OAuth, maps `case_key` → `case_id`
- Customer B: calls `https://cerner.customerB.com/cases`, uses API key, maps `caseId` → `case_id`
- Same tool implementation, different registry rows

### What needs to change in shared-infra Tool Gateway today

Today the tool registry is not tenant-aware. Three changes needed:

1. **Tenant-scoped registry** — add `tenant_id` to tool registry schema. Same tool name (`get_case_details`) can have different rows per tenant with different endpoint URLs.

2. **Per-tenant auth config** — each customer's API uses different auth (API key, OAuth, mTLS). Tool Gateway stores auth config per tenant in registry, injects correct credentials at call time. Never hardcoded.

3. **Per-tenant field mappings** — customer data models differ. Field mapping config (`member_key` → `member_id`) stored in registry per tenant. Tool Gateway applies mapping before returning result to Container 2.

**No new tool code per customer** — adding a new customer = new registry rows only. Tool Gateway code unchanged.

---

## Admin UI — Tenant/Customer Context

Everywhere in Admin UI that touches tool or agent config, `tenant_id` must be present so edits always apply to the correct customer.

### Tool Registry UI
- Tool registration form must include `tenant_id` selector
- Same tool name (`get_case_details`) can have different rows per tenant — endpoint URL, auth, field mappings differ
- Adding a tool = pick tenant + fill endpoint + auth + mapping = one registry row for that tenant
- Tool list view must be filtered by tenant — never show all customers' tools mixed together

### Agent Registry UI
- Workspace must map to a `tenant_id` — all config saves (memory, HITL, RAG, tools, routing) write to the correct tenant's resolved config
- Available tools dropdown in Tools tab must filter by `tenant_id` — only show tools registered for that customer
- Resolved config regeneration must pass `tenant_id` to Container 2 resolver

### Agent Factory (scaffold)
- Create agent form must capture which customer/tenant this agent belongs to
- Scaffold writes agent to correct tenant's registry row
- `domain.yaml` loaded at scaffold time must be the correct tenant's version

---

## domain.yaml — Per Customer Per Capability

`domain.yaml` structure and format stays exactly the same. How agents consume it is unchanged. What changes is that each customer can have their own version per capability.

### Today (one shared per capability)
```
capabilities/
  care-management/
    domain.yaml        ← one, used by all customers
```

### After (per customer per capability)
```
capabilities/
  care-management/
    domain.yaml                      ← base template (your defaults)
    customers/
      customer-a/
        domain.yaml                  ← customer A's scope definitions
      customer-b/
        domain.yaml                  ← customer B's scope definitions
```

**Why:** Different customers use different vocabulary for the same concepts:
- Customer A: `case_id`, `member_id`, `assessment_id`
- Customer B: `encounter_id`, `patient_id`, `eval_id`

Each customer's `domain.yaml` defines their scope vocabulary — entity names, ID fields, allowed scopes. Agents load the correct version at runtime via `tenant_id`.

**What stays the same:** structure, format, how agents consume it — zero changes to agent code or runtime logic. Only the values differ per customer.

**Resolution at runtime:** Container 2 config resolver reads `tenant_id` from request → loads correct customer `domain.yaml` → includes in resolved runtime config → Container 1 gets correct scope definitions.

---

## Gaps — What Else Needs to Be Built

Research against enterprise agent platform best practices identified the following gaps not yet covered in this design. These are real requirements for production enterprise healthcare deployment.

### 1. Service-to-Service Authentication
**Gap:** Container 1 → Container 2 calls and Container 2 → Tool Gateway calls have no mutual auth today.

**Required:**
- mTLS or signed JWT between Container 1 and Container 2
- API key or service token between Container 2 and Tool Gateway
- No plain HTTP between services in production — ever

### 2. Secrets Management
**Gap:** API keys, DB passwords, model credentials are in `.env` files — production anti-pattern.

**Required:**
- Integrate with AWS Secrets Manager, HashiCorp Vault, or equivalent
- Secret rotation mechanism — keys must be rotatable without redeploy
- Separate local dev secrets (`.env`) from production secrets (vault)
- Never log secrets, never pass in URL params

### 3. PHI Masking — Implemented, Not Just Designed
**Gap:** PHI masking is a design intent today, not an enforced code layer.

**Required:**
- Explicit masking layer in pre-graph before any data reaches LLM context
- Field-level classification config per tool output (which fields are PHI)
- Masking applied automatically based on classification — not manual per tool
- Memory store encrypted at rest — FileMemoryStore writes plaintext JSON today

### 4. Immutable Audit Log (HIPAA)
**Gap:** Current approval audit log is SQLite — mutable, deletable, not signed.

**Required:**
- Immutable append-only audit log for all agent decisions, tool calls, data access
- Log who accessed what member/case data, via which tool, at what time
- Encrypted log transmission between services
- Signed log entries for regulatory proof
- Retention policy — HIPAA requires minimum 6 years

### 5. Rate Limiting + Quota Management
**Gap:** No rate limits anywhere — Tool Gateway accepts unlimited requests, memory writes are unbounded.

**Required:**
- Per-tenant rate limits on tool invocations, LLM calls, memory writes
- Per-user limits where applicable
- Quota management — customer contracts may limit usage
- Graceful rejection (429) not hard failure when limits hit

### 6. Multi-Tenancy Data Isolation
**Gap:** Tenant isolation enforced at API layer but not at data layer.

**Required:**
- DB credentials scoped per tenant OR row-level security enforced in DB
- Memory store file permissions enforce tenant isolation
- Tool registry per-tenant access policies — tenant A cannot see tenant B's tools
- All API routes validate `tenant_id` matches authenticated caller

### 7. Circuit Breakers + Graceful Degradation
**Gap:** Tool Gateway failures and LLM unavailability crash the runtime hard today.

**Required:**
- Circuit breaker on all Container 1 → Container 2 calls
- Circuit breaker on all Container 2 → Tool Gateway calls
- Degraded mode: if RAG unavailable → skip retrieval, proceed without context
- Degraded mode: if memory unavailable → proceed stateless, log warning
- Health checks cascade — Container 1 health endpoint checks Container 2 reachability

### 8. API Versioning + Contract Stability
**Gap:** Tool specs and service APIs have no versioning strategy — clients can break silently on changes.

**Required:**
- Version all Container 2 service endpoints (`/v1/strategy/react`, `/v2/...`)
- Tool spec versioning — tools can be updated without breaking existing agents
- Schema validation on requests and responses — fail fast on contract mismatch
- Deprecation path for old tool versions

### 9. Healthcare-Specific Compliance Hooks
**Gap:** No HIPAA-specific operational controls.

**Required:**
- BAA (Business Associate Agreement) compliance audit hooks — log all PHI access events
- Patient/member consent tracking — was this data access authorized?
- Breach notification trigger — detect and alert on anomalous data access patterns
- Data residency enforcement — ensure data never leaves configured boundary
- Minimum necessary principle enforcement — agent only gets data it needs for the task

### 10. Tool Gateway as Policy Enforcement Point
**Gap:** Tool Gateway is a pure HTTP router today — no inline policy enforcement at the boundary.

**Required:**
- Tool Gateway enforces: data residency, encryption, access controls at the boundary
- Not delegated entirely to downstream services
- Every tool call checked against: tenant policy, tool allowlist, data classification, rate limit
- Rejected calls logged to audit trail before rejection
