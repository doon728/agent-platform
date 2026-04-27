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

---

## 10. Repo Structure — Library / Service Split + Pattern A′ Layout

### Goal

Restructure the monorepo into a clean, idiomatic Python layout with explicit library / runtime separation. This refactor:

- Makes `platform-core` a proper installable Python package (so AgentCore Factory and other consumers can `pip install` it).
- Cleanly separates code that lives *as a library* from services that *deploy as containers*.
- Bakes in Pattern A′ (tool serving offloaded to AgentCore Tool Gateway; our gateway becomes policy / governance).
- Adopts Brij-style internal layout per overlay (`prompts/`, `skills/`, `tools/`, `evals/`).
- Adds `skills/` convention as a packaging primitive.

### Final structure

```
agent-platform/
├── packages/
│   └── platform-core/                  ← installable Python package (pyproject.toml, versioned)
│       ├── src/platform_core/
│       │   ├── memory/
│       │   ├── rag/
│       │   ├── hitl/
│       │   ├── reasoning/
│       │   ├── tools/
│       │   ├── auth/
│       │   ├── prompt/
│       │   └── observability/
│       └── tests/
│
├── services/                           ← deployable runtime services
│   ├── platform-services/              ← C2 (reasoning + memory + HITL orchestrators)
│   ├── rag/                            ← split-out RAG service
│   ├── tools/                          ← tool implementations
│   ├── tool-policy-gateway/            ← C3 (renamed; policy/governance only)
│   ├── agent-factory-ui/               ← C4 (React)
│   ├── agent-factory-support-api/      ← C4 (FastAPI)
│   └── prompt-management/              ← C4
│
├── templates/
│   ├── agent-runtime-shell/            ← C1 thin shell
│   ├── overlay-templates/              ← was agent-runtime-template
│   ├── agent-ui-template/
│   └── capability-ui-template/
│
├── capabilities/
│   └── care-management/
│       ├── ui/                         ← moved from templates/capability-ui-template
│       └── domain.yaml
│
├── agents/                             ← generated instances
├── infra/                              ← IaC
├── docs/
└── platform-store/
```

### Library vs. service rule

- **Library** (`packages/`) = code-only Python package. No Dockerfile. Imported via `pip install`. Reusable across many services.
- **Runtime service** (`services/`) = deployable container with Dockerfile, FastAPI app, HTTP endpoints. Imports libraries from `packages/`.

Universal pattern across all functional areas:

| Area | Library code | Runtime service |
|---|---|---|
| Memory | `packages/platform-core/memory/` | inside `services/platform-services/` |
| RAG | `packages/platform-core/rag/` | `services/rag/` |
| Tools | `packages/platform-core/tools/` | `services/tools/` + `services/tool-policy-gateway/` |
| HITL | `packages/platform-core/hitl/` | inside `services/platform-services/` |
| Reasoning | `packages/platform-core/reasoning/` | inside `services/platform-services/` |
| Prompts | `packages/platform-core/prompt/` | `services/prompt-management/` |
| Auth | `packages/platform-core/auth/` | (no separate service) |
| Observability | `packages/platform-core/observability/` | (no separate service) |

### Pattern A′ embedded in the layout

- `services/tools/` — tool implementations (deployable Lambdas / containers). Registered with AgentCore Tool Gateway via IaC.
- `services/tool-policy-gateway/` — what was C3, minus tool serving. Per-agent allow/deny, PHI masking, HIPAA audit, multi-runtime fallback adapter.
- `services/rag/` — multi-dim RAG orchestration (stage × source × extraction). Was previously co-located inside the old C3 tool gateway; split out for clean separation.

### Skills convention

Each overlay gets a `skills/` folder for reusable behavior patterns (markdown files):

```
overlays/chat_agent_simple/
├── prompts/
├── skills/                ← NEW
│   ├── triage_intake.md
│   └── escalate_to_human.md
├── tools/
├── evals/                 ← NEW
└── overlay.yaml
```

Aligns with Anthropic Claude Skills + Microsoft Foundry's "skills as markdown" pattern. Loader in `packages/platform-core/prompt/` picks up skill files at agent boot.

### AgentCore Factory integration

With `platform-core` as a proper package:

- AgentCore Factory team can `pip install aea-platform-core==X.Y.Z` (internal PyPI / CodeArtifact / git).
- Adapter pattern means AEA can also consume Factory's memory / MCP / identity primitives via config flip — no code changes needed.
- Two-way integration: AEA-as-library inside Factory, *or* AEA-consumes-Factory-primitives.

### Best-practice guarantees

- Type hints throughout, mypy-clean.
- Lint clean (ruff / pylint).
- No circular imports between packages.
- Service boundaries enforced (no service imports another service directly).
- No secrets in code or configs.
- Auth modes preserved.
- Deps pinned in pyproject.toml.
- `pip-audit` clean.
- No PHI/PII echo in logs.
- TLS / encryption invariants intact.

---

## 11. Prior Authorization (PA) Suite — Design

Flagship multi-agent use case for healthcare payer ICP. AEA's answer to the Microsoft Azure AI Foundry PA template. Tracked as backlog item A18.

### 11.1 Posture — embedded in customer's BPM, not replacing it

AEA's PA Suite is positioned for **Top-25 payers who already run Pega / Facets / TriZetto / IBM BPM**. Their workflow engine owns the PA case lifecycle (intake → review → coverage → decision → output). AEA agents are invoked by BPM steps as intelligent specialists.

```
Customer's BPM (Pega / Facets / IBM BPM / Camunda)
   owns: PA intake, phase orchestration, audit, output, EHR/FHIR integrations
   │
   ├── step 1 ─▶ POST /agents/compliance     ──▶ {compliant, issues, evidence}
   ├── step 2 ─▶ POST /agents/clinical       ──▶ {clinical_assessment, risk, evidence}
   │            (parallel with step 1 if BPM supports)
   ├── step 3 ─▶ POST /agents/coverage       ──▶ {covered, conditions, met/not_met}
   │            (sequential after clinical)
   ├── step 4 ─▶ POST /agents/synthesis      ──▶ {decision: APPROVE|PEND, confidence, rationale}
   └── HITL via hitl.adapter:pega/servicenow ─▶ clinician Accept/Override (mandatory)
```

This contrasts with Microsoft Foundry's template, which ships its own Next.js UI + FastAPI orchestrator + asyncio.gather coordination — a complete standalone stack that effectively replaces the BPM. Top-25 payers will not rip out their BPM. AEA fills the gap MS leaves.

### 11.2 The 4 specialist agents

Each agent is a **C1 Request-Response specialist** — structured input, structured output, ReAct reasoning with MCP tools. Not chat agents, not summary agents. The agent type itself is a missing slot in our taxonomy that needs to be added when PA Suite is built (see Phase 0 below).

| Agent | Role | MCP tools called | Output shape (Pydantic) |
|---|---|---|---|
| **Compliance** | Documentation check, eligibility, regulatory rules | NPI Registry, ICD-10 | `{compliant: bool, checklist: 10-item with blocking flags, issues: [], evidence: []}` |
| **Clinical** | Clinical evidence review, medical necessity | ICD-10, PubMed, ClinicalTrials.gov | `{clinical_assessment: str, risk_level, citations: []}` |
| **Coverage** | Policy matching against CMS NCD/LCD + plan rules | CMS Coverage | `{covered: bool, criteria_met/not_met: [], policy_refs: []}` |
| **Synthesis** | 3-gate decision rubric | (no MCP tools — consumes prior 3 outputs) | `{decision: APPROVE\|PEND, confidence: float, rationale: str, gates: {provider, codes, medical_necessity}}` |

Synthesis applies a 3-gate rubric (Provider gate, Codes gate, Medical Necessity gate) with weighted scoring (40% coverage + 30% clinical + 20% compliance + 10% policy match) — same scoring as MS template.

**No supervisor agent.** Orchestration is either (a) BPM steps (embedded model — production), or (b) thin Python `asyncio.gather` + sequential awaits (~30 lines for AEA-led demo). The synthesis agent is the *last specialist*, not a supervisor — it consumes the others' outputs and emits the verdict.

### 11.3 LENIENT-mode HITL (regulatory posture)

Synthesis emits **APPROVE or PEND only — never auto-DENY** in default LENIENT mode. Every recommendation requires a clinician to Accept or Override with documented rationale. Override flows to audit PDF Section 9, notification letters, and downstream systems.

This addresses CMS-0057-F (electronic PA mandate) and the wave of state legislation restricting AI-driven PA denials (49 states + DC have PA laws, half introduced AI-PA-specific reform in 2026).

In AEA terms: configure the existing HITL adapter for `mode: lenient` — synthesis output gates on clinician approval before final commit. Override events emit to audit + memory.

### 11.4 Skills as markdown — domain experts own the rules

Agent behavior is defined in `overlays/<agent>/skills/*.md` files (Anthropic Claude Skills pattern, also used by MS template). When CMS updates an NCD or a plan changes commercial policy, a clinician/compliance officer edits a markdown file and redeploys — no engineering PR.

AEA already has `skill_loader` in `packages/platform-core/prompt/skill_loader.py`. PA Suite is the first real consumer; ships with backlog item A16 (skills wiring into runtime) as a hard prereq.

### 11.5 Data architecture — Postgres + AWS HealthLake hybrid

PA Suite splits data across two stores following AWS-native healthcare patterns:

| Data | Store | Why |
|---|---|---|
| Member clinical history (Patient, Encounter, Condition, MedicationRequest, Observation, DocumentReference) | **AWS HealthLake** (FHIR-native, HIPAA-eligible, AWS-managed) | Standard FHIR R4. AWS-credible co-sell story. Built-in NLP for unstructured notes. |
| PA workflow tables (`pa_requests`, `pa_*_results`, `pa_clinician_decisions`, `pa_audit_pdfs`) | **Postgres** | Transactional workflow data, no FHIR equivalent |
| Code catalogs (ICD-10 ~70K, CPT/HCPCS ~10K) | **Postgres** | Reference data, not patient data |
| Coverage rules (CMS NCD/LCD ~150, plan coverage rules per LOB × state) | **Postgres** | Policy data, not clinical |
| Step therapy / network / PA-required code mappings | **Postgres** | Operational/administrative |
| Synthetic seed for demos | **Postgres** | HealthLake is for real PHI; demos use synthetic Postgres seed |

**HealthLake = OLTP-style FHIR document store**, not a lakehouse and not a free-form table store. Pre-defined FHIR resource types only (~140 types in spec). Schema is the FHIR specification itself; you don't create tables.

### 11.6 Analytics — HealthLake → Iceberg or Delta (post-MVP)

For population-level analytics (denial trend dashboards, provider scorecards, PA cycle-time analysis), the standard pattern:

```
HealthLake ──Export Job──▶ S3 (ndjson)  ──▶  Parquet  ──▶  Iceberg or Delta tables  ──▶  Athena / Spark / Redshift / Databricks
                                                              ▲
                                                              │
                                                  Medallion (bronze / silver / gold) lives HERE,
                                                  not inside HealthLake. HealthLake is OLTP.
```

- **Iceberg + Athena/Redshift** for AWS-native shops
- **Delta + Databricks** for shops already on Databricks (very common at large payers for claims analytics)

Both are valid; pick by customer's existing data platform. **Analytics layer is post-MVP — not required for PA decision flow.**

### 11.7 MCP tools — 5 healthcare data sources

AEA's PA Suite ships 5 MCP tools matching MS template's tool set:

| Tool | Source | Real vs synthetic in demo |
|---|---|---|
| `npi_registry_lookup` | CMS NPPES public API | Real, subset |
| `icd10_validate` | Postgres-backed catalog | Real (public dataset) |
| `cms_coverage_lookup` | CMS NCD/LCD policies | Real subset (~50 policies) |
| `pubmed_search` | NCBI Entrez API | Real (rate-limited) |
| `clinical_trials_lookup` | ClinicalTrials.gov API | Real |

Tools live in `services/tools/<tool_name>/` once Pattern A′ tool relocation lands (A1 Phase 1 prereq). Each is registered with the policy gateway and gated by Cedar policies.

### 11.8 Audit + notification

Every PA case emits:
- 8-section audit justification PDF (per-criterion evidence, source attribution, timestamps, confidence breakdowns) — Section 9 captures clinician overrides
- Notification letters (approval / pend templates) auto-generated
- All artifacts designed to support CMS-0057-F documentation requirements

PDF + letter generation is plain Python (~1 week implementation), not platform code. Stored in S3 with metadata in Postgres `pa_audit_pdfs` table.

### 11.9 Effort breakdown — ~5–6 weeks (with prereqs ~9–10 weeks)

| Phase | Task | Effort |
|---|---|---|
| **0 — prereq** | A13 (test coverage on critical paths) + A1 Phase 1 (PDP/PEP, Cedar compiler, tools to `services/tools/`) | ~3–4 weeks each, parallel |
| **0 — taxonomy** | Add C1 specialist agent type to `agent-taxonomy-matrix.html` + build the agent type framework | ~1 week |
| 1 | 4 specialist overlays (Compliance / Clinical / Coverage / Synthesis) on top of new C1 type | ~1 week |
| 2 | 5 healthcare MCP tools in `services/tools/` | ~2 weeks |
| 3 | LENIENT HITL config + audit PDF + notification letters | ~1 week |
| 4 | HealthLake integration (FHIR resource generation, import jobs, synthetic data seeder) + Postgres workflow schema | ~1 week |
| 5 | Thin orchestrator (asyncio Python for AEA-led demo) OR BPM contract (embedded) | ~3 days |
| 6 | Integration testing, BPM handshake contracts, E2E with synthetic data | ~1 week |

**A4 (workflow_agent / supervisor agent type) is NOT required.** MS template doesn't use one; orchestration is asyncio code. AEA matches that with thin Python orchestrator (or BPM in embedded mode).

### 11.10 What we will NOT build

To stay focused and avoid scope creep — explicit non-goals:

- **No supervisor agent** — orchestration is code, not an LLM
- **No PA workflow UI** — customer's BPM (Pega) owns case management UI in production. A reference demo UI is optional sales asset, not product.
- **No replacement for customer BPM** — Top-25 payers will not rip out Pega
- **No analytics layer in MVP** — defer until real analytics use case demands it
- **No multi-LOB sub-agent fleet** — start with 4 flat agents (MS template shape). Split into sub-experts only when evidence demands it (prompt incoherence, tool overflow, governance fragmentation, cross-use-case reuse). Premature fragmentation = latency tax + cost tax + context loss.

### 11.11 Strategic positioning vs Microsoft Foundry PA template

| Capability | AEA (embedded posture) | MS Foundry PA template |
|---|---|---|
| Per-agent intelligence + tools + structured output | ✅ | ✅ |
| Multi-agent flow | Customer BPM orchestrates AEA agents | Foundry orchestrator (Next.js + FastAPI + asyncio) |
| MCP tool serving | C3 PDP + AgentCore PEP (after A1) | Foundry Tools (remote MCP) |
| Customer BPM integration | ✅ Native (embedded model) | 🔲 Not the model — replaces BPM |
| Multi-cloud (AWS + Azure + on-prem) | ✅ Adapter pattern | 🔲 Azure-only |
| Multi-customer fleet governance | ✅ Agent Factory + Registry + Tool Admin | 🔲 Single template per deployment |
| Operator-editable config (no redeploy) | ✅ Overlay YAML + skills markdown | ✅ Skills markdown (similar) |
| Multi-dim RAG (3 dimensions) | ✅ | 🔲 Single retrieval path |
| 4-scope memory (short / episodic / semantic / summary) | ✅ | Partial |
| HealthLake / FHIR-native clinical data | ✅ Hybrid (HealthLake + Postgres) | 🔲 Custom synthetic only |
| Top-25 payer fit (BPM stays in control) | ✅ | 🔲 Targets greenfield / small payers |

**One-liner positioning:**
> Microsoft Foundry's PA template owns the whole stack — UI, orchestration, agents, tools — Azure-only, code-bound. AEA is different: we plug *intelligence into the workflow engine the customer already runs*. Pega owns the PA workflow. AEA's specialist agents do compliance, clinical review, coverage check, synthesis — invoked as Pega steps. The customer's BPM stays in control. We add intelligence, not another workflow engine. That matters for Top-25 payer ICP.
