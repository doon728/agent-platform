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
