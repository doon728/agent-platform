# Container Architecture & Repo Design

This document captures the core architectural decisions for the Intelligent Agent Accelerator for Healthcare — specifically, what gets cloned when a developer or engagement team starts from the accelerator, how the four containers are scoped, how templates relate to scaffolded agent instances, and what developers can and cannot modify.

---

## 1. What Gets Cloned

When a developer (internal sandbox) or delivery team (customer engagement) clones the accelerator, they receive a **full fork of the master accelerator repo**. The repo contains everything:

- **The four-container platform code** (C1 / C2 / C3 / C4) — runnable locally with `docker-compose up`
- **The `platform-core` shared library**
- **Shared infrastructure services** (tool gateway, prompt management)
- **The `templates/` folder** — source material for scaffolding new agents
- **Reference agents** — already scaffolded, configured, and running under `agents/<domain>/<agent>/`
- **The Agent Factory UI** — the interface for creating new agents
- **IaC, CI/CD, documentation** — everything required to run and deploy

**What gets modified vs. what does not is enforced by policy, not by absence.** Every fork contains every file. The separation is enforced through:

- **CODEOWNERS** files on platform directories (`platform-core/`, `platform-services/`, `shared-infra/`, `platform-tools/`, `templates/`) — Platform Team approval required for any change
- **Branch protection rules** — PRs required for all changes; platform-directory changes require additional reviewers
- **Team discipline** — engagement teams and developers operate only in `agents/`, `capabilities/` (their own), and config files; they do not edit platform code

### What's read-only by policy (though the code is in the repo)

| Directory | Read-only for | Reason |
|---|---|---|
| `platform-core/` | Engagement team, customer | Shared library — Platform Team owns evolution |
| `platform-services/` (top-level shared platform services, e.g. prompt-management) | Engagement team, customer | Platform Team owns evolution |
| `shared-infra/` (C2 platform services code, C3 tool gateway code) | Engagement team, customer | Platform Team owns evolution |
| `platform-tools/` (C4 code) | Engagement team, customer | Agent Factory UI + support API — Platform Team owns evolution |
| `templates/` | Engagement team, customer | Source material for scaffolding — Platform Team owns evolution |

### What engagement teams and developers modify freely

| Directory | Purpose |
|---|---|
| `agents/<domain>/<agent>/overlays/<variant>/config/` | Per-agent YAML (`agent.yaml`, `memory.yaml`, `prompt-defaults.yaml`) |
| `agents/<domain>/<agent>/` | Custom per-agent code (custom tool adapters, custom UI) |
| `capabilities/<domain>/` | Per-capability `domain.yaml` and capability-level UI |
| Engagement-specific IaC values | `tfvars`, CDK context per environment |

### Consumer-side summary

| Who | What they get on clone | What they do |
|---|---|---|
| Internal developer (sandbox) | Full fork of master — platform + templates + reference agents + Agent Factory UI | `docker-compose up` → scaffold new agents via the UI (reads from their local `templates/`, writes into `agents/`) |
| Engagement team | Engagement fork of master — full platform + templates + reference agents + Agent Factory UI | Tailor platform via config, scaffold customer-specific agents, build engagement-specific IaC |
| Customer (post-handoff) | Their engagement repo becomes their own master copy | Own and evolve the platform going forward — including templates if they choose; pull upstream releases from us |

### How upstream updates flow

When the practice ships a new accelerator release (`v1.1`, `v1.2`, …), updates to platform code and templates flow downstream:

1. Platform Team tags the new release in the master accelerator repo
2. Each engagement's architect pulls the release at a sprint/phase boundary via `git fetch upstream && git merge upstream/v1.1`
3. The merge touches `platform-core/`, `platform-services/`, `templates/`, etc. — but leaves engagement-team-owned folders (`agents/`, `capabilities/`) untouched
4. CI re-runs, tests pass, the engagement is now on the new version

Because platform code is in the engagement repo (not referenced externally), upgrades are a standard Git merge — not a coordinated cross-repo operation.

---

## 2. Container Scoping

The four containers scale differently. Getting this right matters for cost and deployment topology.

| Container | Scope | Count per tenant |
|---|---|---|
| **C1 — Agent Runtime (thin shell)** | **Per-agent** | 100 agents = 100 C1 instances |
| **C2 — Platform Services** | **Shared across all agents within a tenant** | 1 C2 per tenant |
| **C3 — Tool Gateway** | **Shared across all agents within a tenant** | 1 C3 per tenant |
| **C4 — Control Plane** | **Per-tenant** | 1 C4 per tenant |

### Why C1 is per-agent
Each agent has its own graph topology (encoded in `build_graph.py`), its own endpoint, its own cold-start behavior, and its own deployment lifecycle. Keeping C1 thin means 100 instances cost almost nothing in engineering effort or runtime — no intelligence is duplicated.

### Why C2 and C3 are shared within a tenant
Reasoning strategies, memory services, RAG logic, HITL service, tool gateway code — these are identical across agents. Running 100 copies of the same reasoning service would waste resources. One C2 and one C3 serve all agents within a tenant. Per-agent customization happens via the agent's YAML config, which C2 and C3 read per request.

### Why C4 is per-tenant (not practice-wide)
C4 administers Agent Factory UI, agent registry, observability, and prompt management **for a given tenant**. It spans capabilities and agents within that tenant.

- **Internally at the practice**: the practice itself is the tenant; developers for each capability access one C4 instance to configure their agents' tools, prompts, and governance
- **At a customer**: each customer is a tenant; C4 deploys per customer (or per LOB within a customer)

C4 is one per tenant — one C4 instance serves all LOBs for a given tenant.

---

## 3. Template and Scaffolded Instance Flow

Templates are present in every fork of the repo but are **not deployed directly**. Scaffolded instances are. The flow:

```
templates/agent-runtime-shell/   ← source code (in every fork; read-only by policy)
          │
          │  Agent Factory UI "Scaffold" action
          ▼
agents/<domain>/<agent>/services/agent-runtime/   ← scaffolded INSTANCE
          │
          │  CI/CD build
          ▼
Container image (per agent, tagged)
          │
          ▼
Deployed as Container 1 for that specific agent
```

- **Template** — source material. Present in every fork (master, engagement, sandbox). Read-only by policy — only the Platform Team modifies it, upstream releases propagate changes.
- **Scaffolded instance** — created from template by the Agent Factory UI. Lives under `agents/<domain>/<agent>/services/agent-runtime/` in whatever repo the Agent Factory scaffolds into (engagement or sandbox). One per agent.
- **Container image** — built from the scaffolded instance plus the `platform-core` shared library.
- **Deployed** — one C1 container per agent.

### What's inside the C1 container image

| Content | Source |
|---|---|
| Thin shell code | Scaffolded from template (per agent) |
| Agent's YAMLs (`agent.yaml`, `memory.yaml`, etc.) | Per-agent config in the repo |
| `platform-core` shared library | Imported — same library every C1 uses |
| HTTP clients to call C2/C3/C4 | In shell code |

The template itself is never inside the container. The scaffolded instance is.

---

## 4. Shell Code Structure

The C1 shell is deliberately minimal. Structure for a scaffolded agent:

```
agents/<domain>/<agent>/
├── overlays/<variant>/                ← per-variant YAML config (agent.yaml, memory.yaml, etc.)
├── domain.yaml                        ← capability-level domain config
└── services/
    └── agent-runtime/                 ← the C1 scaffolded instance
        ├── Dockerfile
        ├── pyproject.toml
        ├── config/                    ← base/dev/staging/prod.yaml
        └── src/                       ← the shell code
            ├── clients/               ← HTTP clients to C2 and C3
            │   ├── strategy_client.py
            │   ├── memory_client.py
            │   ├── rag_client.py
            │   ├── tools_client.py
            │   └── config_client.py   ← to C4
            ├── graph/
            │   └── build_graph.py     ← agent-specific graph topology
            └── platform/
                ├── app.py             ← FastAPI entry point
                └── langgraph_runner.py
```

### The key per-agent file

**`graph/build_graph.py`** is the main per-agent file. It encodes the agent's LangGraph topology — nodes, edges, state transitions. Every other file in the shell is identical plumbing across all agents.

### Generated, not hand-edited

`build_graph.py` is generated by the Agent Factory UI from the agent's YAML config (reasoning strategy, tools, RAG stages, HITL gates). When YAML config changes, `build_graph.py` is regenerated. Developers treat it as generated code; they do not edit it by hand.

---

## 5. What Developers Modify

Developers working on an agent modify **configuration and per-agent extensions** — not platform code.

| Developer modifies | Read-only for developers |
|---|---|
| `agent.yaml` — reasoning strategy, tools, RAG, model | C1 shell code (generated) |
| `memory.yaml` — memory types, scopes, backends | C2 platform services code |
| `prompt-defaults.yaml` — prompt seeds | C3 tool gateway code |
| `domain.yaml` — capability-level config | C4 control plane code |
| Prompts (via Agent Factory UI / Prompt Management service) | `platform-core` shared library |
| Custom tool adapters (when a new integration is required) | Template source in `templates/` |
| Custom agent UI (per-agent UI customizations) | |

Platform code (C2, C3, C4, `platform-core`) is owned by the Platform Team. New reasoning strategies, memory backends, RAG patterns, tool adapters, or compliance controls ship as versioned platform releases (`v1.0`, `v1.1`, `v1.2`), not as per-engagement code edits.

Developers interact with the platform the way application developers interact with a framework: through configuration and their own code, not by modifying the framework itself.

---

## 6. Summary of the Design

1. **Cloning gives a working system.** Every fork contains everything — platform code, templates, reference agents, Agent Factory UI.
2. **Separation is enforced by policy (CODEOWNERS, branch protection), not by absence of code.** Platform code and templates live in the repo but are read-only to engagement teams and customers.
3. **C1 multiplies with agents; C2 and C3 are shared within a tenant; C4 is per-tenant.**
4. **Scaffolded instances, not templates, build into containers.** Templates in the repo are source material — the Agent Factory UI reads them and generates agent instances.
5. **`build_graph.py` is the one agent-specific file** — and it is generated from YAML.
6. **Developers work in YAML, prompts, custom tool adapters, and custom UI.** Everything else is read-only platform code.
7. **At customer handoff, the customer receives the full repo.** Their AI COE becomes the equivalent of the Platform Team internally — they own platform code and templates going forward, free to evolve them or to pull upstream releases from the practice.

This separation is what lets the accelerator scale: adding an agent is a YAML and scaffold operation, not a platform change. The platform evolves on its own release cadence under Platform Team ownership; individual agents evolve independently via configuration. Upstream releases flow into every fork via standard `git merge upstream/v1.x` operations.

---

## 7. Current State (Prototype) vs Target State (v1.0 on AWS)

The reference architecture (v4) describes the **target state** after v1.0 ships. The **current prototype** runs locally on Docker without AWS managed services integrated. The 24-week build bridges the two.

| Component | Target State (v1.0 on AWS) | Current Prototype (local Docker today) |
|---|---|---|
| C1 Agent Runtime | Runs on Amazon Bedrock AgentCore Runtime (session-isolated microVM per agent) | Python container on local Docker |
| C2 Platform Services | On ECS/Fargate; LangGraph runner | Python container on local Docker |
| C3 Tool Gateway | On ECS/Fargate; LOB-namespaced catalog | Python container on local Docker |
| C4 Control Plane | On ECS/Fargate; Agent Factory UI, Registry, Prompts, HITL, Observability | Partially built; Agent Factory UI running locally |
| C1 → C2 comms | HTTP (same today) | ✓ HTTP (`PLATFORM_SERVICES_URL`) |
| **C2 → tools comms** | **MCP protocol** via AgentCore Gateway (default) or C3 facade (fallback) | ✗ HTTP direct to C3 — **no MCP implementation yet** |
| **Tool registration** | Tools registered in C3; C3 syncs to AgentCore Gateway | ✓ Tools registered in C3; served via HTTP |
| **Memory backend** | AgentCore Memory (primary) + pgvector / OpenSearch (semantic) | ✗ `MEMORY_BACKEND=file` — local file store only |
| **Observability** | AgentCore Observability → CloudWatch / X-Ray | ✗ Local stdout logs only |
| **Identity / Auth** | AgentCore Identity for inbound + outbound | ✗ `AUTH_MODE=OPTIONAL` in local dev |
| **LLM** | Amazon Bedrock (HIPAA-eligible) | ✓ OpenAI direct (prototype dev only) |

**Gap interpretation:** The architecture is complete conceptually; the prototype proves the pattern; the 24-week build wires in AWS managed services (AgentCore Memory, Gateway, Identity, Observability) via adapter interfaces already in place. Every gap above is tracked in `backlog.md` under the IaC + AgentCore/Bedrock Packaging workstream.

---

## 8. AWS Deployment — MCP / Tool Serving Patterns

**AgentCore is an AWS service — it does not run locally.** Local dev is Docker-only; AgentCore integration activates only when deploying to AWS.

### Local Dev Today (no AgentCore anywhere)

```
┌────────────────┐   HTTP    ┌──────────────────────┐   HTTP    ┌──────────────────┐
│ C1 Agent       │──────────>│ C2 Platform Services │──────────>│ C3 Tool Gateway  │
│ Runtime        │           │ (LangGraph)          │           │ (local catalog)  │
└────────────────┘           └──────────────────────┘           └──────────────────┘
                                       │                                 │
                                       ▼                                 ▼
                                  [file memory]                    [tool impls]

No AgentCore. No MCP. No AWS. Everything on the developer's laptop.
```

### Target — Three Tool-Serving Patterns on AWS

**Pattern 1 — C3 Tool Gateway as source of truth; AgentCore Gateway as MCP server (DEFAULT)**

Tools are registered in **C3 Tool Gateway** (our managed governance layer). C3 syncs the catalog to **AgentCore Gateway**, which is the AWS-managed MCP server. Agents call AgentCore Gateway via MCP protocol.

```
┌────────────────────┐     MCP protocol    ┌──────────────────────────┐
│ C1 Agent Runtime   │────────────────────>│ AgentCore Gateway        │
│ (on AgentCore RT)  │                     │ (AWS managed MCP server) │
└────────────────────┘                     └──────────┬───────────────┘
                                                      │
                              ┌───────────────────────┘
                              │ Gateway's catalog synced from C3
                              ▼
                    ┌──────────────────────┐
                    │ C3 Tool Gateway      │   ← Tools registered HERE (source of truth)
                    │ (on ECS/Fargate)     │      Governance, LOB namespaces, allow/deny
                    └──────────────────────┘
```

- Developer registers tool in C3 catalog (YAML)
- C3 Publisher module syncs definitions to AgentCore Gateway (AWS-managed)
- Agent calls AgentCore Gateway via MCP — Gateway handles protocol, auth (via AgentCore Identity)
- **Best for:** multi-LOB payers needing centralized tool governance

**Pattern 2 — AgentCore Gateway direct (no C3 governance layer)**

Tools registered **directly in AgentCore Gateway** via AWS Console / CLI / IaC. No C3. Simpler setup, no custom governance.

```
┌────────────────────┐     MCP protocol    ┌──────────────────────────┐
│ C1 Agent Runtime   │────────────────────>│ AgentCore Gateway        │
│ (on AgentCore RT)  │                     │ Tools registered HERE    │
└────────────────────┘                     └──────────────────────────┘

No C3 Tool Gateway. Tools go directly into AgentCore Gateway.
```

- **Best for:** simple customers, few tools, single LOB, no multi-LOB governance needs
- **Tradeoff:** lose centralized allow/deny, LOB namespacing, custom schema validation, audit trail

**Pattern 3 — C3 hosts MCP server directly (fallback for on-prem / non-AWS)**

No AgentCore Gateway. C3's built-in MCP facade serves tools directly via MCP.

```
┌────────────────────┐     MCP protocol    ┌──────────────────────────┐
│ C1 Agent Runtime   │────────────────────>│ C3 Tool Gateway          │
│                    │                     │ + MCP facade (built-in)  │
└────────────────────┘                     └──────────────────────────┘

No AgentCore Gateway. C3 IS the MCP server.
```

- **Best for:** on-prem deployments, air-gapped environments, non-AWS infrastructure, customers who can't use AgentCore Gateway

### Current Implementation Status

- Pattern 1 (C3 + AgentCore Gateway sync): **NOT built yet** — Publisher module is backlog work
- Pattern 2 (AgentCore Gateway direct): not our accelerator's primary path; supported by AgentCore natively
- Pattern 3 (C3 hosts MCP facade): **partially built** — C3 has catalog + governance; MCP facade module on backlog
- **What's running today:** simpler HTTP-based variant — C2 calls C3 via HTTP, C3 executes tools directly. Neither MCP protocol nor AgentCore integration is wired in the prototype.

All three target patterns are **architecturally supported**; implementation ships in v1.0 per the IaC + AgentCore packaging workstream in `backlog.md`.

---

## 9. Dynamic Routing — Classifier in Front of the Agent Fleet

### Problem

Reasoning strategy in AEA is **fixed per-agent overlay** (not switchable mid-run). That means a `chat_agent` configured with `ReAct` cannot dynamically switch to `plan-execute` for a harder query. For a fleet of N chatbots (each tuned for a different query shape), we need a way to pick the right agent per query.

### Anti-pattern: in-agent strategy switching

Tried and rejected: having an agent's planner decide which strategy to run mid-flow. Violates the overlay-as-config principle, complicates observability (hard to tell which strategy actually ran), and makes evaluation non-deterministic (same overlay yields different behaviors).

### Pattern: classifier layer in front of the fleet

A lightweight **router service** sits between the UI and the agent fleet. It classifies the query, picks the best-match pre-deployed agent, forwards the invocation, and streams the response back.

```
User types in Chat UI
      │
      ▼
┌────────────────────────────────┐
│ Router (new thin service)      │
│ • Reads Agent Registry (C4)    │
│ • Calls classifier LLM (Haiku) │
│ • Returns: pick agent X        │
└──────┬─────────────────────────┘
       │
       ▼  (forwards to chosen agent)
┌──────┴────┬──────────┬───────────┐
▼           ▼          ▼           ▼
chat_simple chat_react chat_plan  chat_reflection
(each is a separately-deployed C1, strategy fixed)
       │
       ▼
  Response streams back to UI
```

### Why this fits AEA architecture

- **Agents unchanged** — pre-graph → reasoning (C2) → post-graph intact per agent.
- **C2 orchestration unchanged** — each agent still runs its own LangGraph loop with its configured strategy.
- **C3 Tool Gateway unchanged**.
- **C4 Control Plane unchanged** — Agent Registry already exists; router just consumes it.
- **Additive only** — new router service, not a structural change to the 4-container model.

### Agent manifest extension

Each agent declares routing hints so the router can pick the right one:

```yaml
routing_hints:
  query_patterns: ["simple lookup", "single fact", "status of X"]
  strategy_profile: simple
  confidence_floor: 0.7
  example_queries:
    - "Status of ticket JIRA-123?"
    - "What is the owner of project X?"
```

The classifier LLM sees incoming query + all agents' routing hints → returns best-match agent ID + confidence.

### Alignment with Anthropic's five patterns

This is Anthropic's **"routing"** pattern — classify input and direct to specialized handlers. Not the "orchestrator-workers" pattern (which requires mid-flow delegation) and not "evaluator-optimizer" (which requires self-critique). Routing is the correct primitive for our constraint.

### Implementation effort

- New router service (Lambda or Fargate): ~1 week.
- Agent manifest extension + Agent Registry UI field: ~3 days.
- Capability UI update to POST to `/router/invocations`: ~2 days.
- **Total: ~1–2 weeks.**

### When the router is needed vs. not

- **Needed:** fleet with multiple agents per use case (e.g., chatbot platform with `simple`, `ReAct`, `plan-execute`, `reflection` variants).
- **Not needed:** single-agent deployments (skip the router; call agent directly).
- **Not needed:** when the UI already knows which agent to call (e.g., dedicated status bot, no classification required).

Default architecture: router is **optional** — deploy when fleet size and query variety justify it.
