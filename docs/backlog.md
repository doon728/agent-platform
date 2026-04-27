# Platform Backlog

Status key: ✅ Done | ⚠ Partial / Limitation | 🔲 Not Started

---

## Architectural Decisions & Additions (Apr 2026)

These items came out of the Apr 2026 design reviews (prototype-current-state.html §12 + agent-taxonomy-matrix.html) and must fold into the main backlog prioritization.

### A1. C3 Tool Gateway — Refined Pattern A′ (PDP/PEP separation)
🔲 **Decision + implementation.** Lock in **Pattern A′ with PDP/PEP separation** (industry-standard, defensible architecture):

**Architecture:**
- **AgentCore Tool Gateway = Policy Enforcement Point (PEP)** — runtime enforcement on every MCP call. Cedar policies + auth applied at runtime. AWS-managed, fast, auditable. **MCP server lives ONLY here.**
- **C3 (`tool-policy-gateway`) = Policy Decision Point (PDP) + governance plane** — defines policies, curates domain packs, pushes Cedar policies to AgentCore, consumes audit logs, exposes governance dashboards. **OUT of the MCP request path.**
- **Tool implementations = separate** — code in `services/tools/`, deployed as Lambda (lightweight tools) or container (heavy/stateful). Registered with AgentCore Tool Gateway via IaC.

**Runtime flow:**
```
C2 ──MCP──▶ AgentCore Tool Gateway ──▶ Tool implementation (Lambda/container)
              (PEP — applies Cedar + auth)
                     ▲
                     │ policy push (config-time, not runtime)
                     │
                C3 (PDP — defines policies, curates packs,
                     consumes audit logs, governance UI)
```

**MCP on the wire = ONCE.** No double-hop. No inline proxy. C3 is not in the request path.

**What C3 actually does in this model:**
1. Authoring UI / API for ops to define allow/deny rules, curate domain packs.
2. Compiles policies → pushes to AgentCore (Cedar policy bundle, allow-list, deny-list).
3. Consumes audit logs from AgentCore → governance dashboards, compliance reports.
4. Multi-runtime adapter — for non-AgentCore deployments (Mosaic, vanilla), C3 can fall back to running policies itself.

**PHI masking placement:**
- Pre-response masking → C2 interceptor (existing pattern).
- OR registered as AgentCore-side custom action → enforced at PEP.
- NOT in C3 request path.

**Industry pattern alignment (defensible):**
- OPA + Kubernetes (OPA = PDP, admission controllers = PEPs).
- AWS Verified Permissions + Cedar (Verified Permissions = PDP, services = PEPs).
- Service mesh authz (Istio + OPA).
- API gateways with external authz.

**One-line for architects:**
> "C3 is a Policy Decision Point and governance UI — not a request-path proxy. Runtime enforcement happens in AgentCore Tool Gateway via Cedar. We follow the industry-standard PDP/PEP separation."

**Implementation tasks:**
1. Refactor `services/tool-gateway/` → `services/tool-policy-gateway/`. Remove MCP server code.
2. Move tool implementations out → `services/tools/`. Each tool = Lambda or container.
3. Add Cedar policy compiler in C3 (authored policies → Cedar bundles → push to AgentCore).
4. Add audit log consumer in C3 (pulls from AgentCore Observability → governance dashboards).
5. IaC: register tools with AgentCore Tool Gateway, deploy Cedar policy bundles.
6. Multi-runtime adapter in C3: for non-AgentCore environments, run policies locally.

**Document updates required (post-refactor):**
- `docs/design/prototype-current-state.html` §12.3 — replace 3-pattern (A/B/C) discussion with PDP/PEP + Pattern A′.
- `docs/design/agent-taxonomy-matrix.html` §9 — update C3 description to reflect PDP role.
- `docs/design/design.md` §10 — already updated; verify alignment.
- `docs/proposal/offering-proposal-summary.html` — update C3 description.
- `docs/proposal/accelerator-technical-design.html` — update C3 description + add PDP/PEP framing.
- All container topology diagrams — show C3 out of MCP request path.

---

#### A1 — Status snapshot (as of 2026-04-26)

What's already done in the recent refactor:
- ✅ `services/tool-gateway/` renamed to `services/tool-policy-gateway/`. MCP server code stripped (zero `mcp` references in `app.py`).
- ✅ `services/rag/` split out into its own service.
- ✅ `services/tool-admin-ui/` exists with Tool Registry + KB pages (no Policies tab yet).
- ✅ `cedar_compiler.py` and `audit_consumer.py` files exist in `tool-policy-gateway/src/policy/` — **but they are stubs** (file headers literally say "STUB. Real Cedar emission + AgentCore push is gated on backlog A1").
- ✅ Repo refactored to `packages/platform-core/` + `services/` layout.

What's still stub or unbuilt:
- 🔲 **Cedar compiler is a stub** — emits placeholder text, no real Cedar bindings.
- 🔲 **Audit consumer is a stub** — placeholder, no real ingestion.
- 🔲 **Tools have NOT moved to top-level `services/tools/`** — still inside `tool-policy-gateway/src/tools/registry.py` as internal handlers.
- 🔲 **No PDP authoring UI** — Tool Admin UI manages tools/KB but has no Policies tab.
- 🔲 **No IaC** — nothing registers tools with AgentCore Tool Gateway.
- 🔲 **No multi-runtime adapter** — no "if AgentCore present, push; else, run locally" toggle.
- 🔲 **No AgentCore push** (Phase 2 — needs live tenant).

#### A1 — Phase split (Phase 1 has no AWS dependency)

**Phase 1 — Local-only, no AgentCore needed (~3–4 weeks).** Delivers a working policy authoring UI + real Cedar compilation + local enforcement + audit dashboard. Demoable end-to-end without AWS.

| # | Task | Effort |
|---|---|---|
| 1 | **Define the friendly YAML policy format** — fields, conditions, targets. The contract everything else hangs off. | 2–3 days |
| 2 | **Policy Authoring UI in `tool-admin-ui`** — new Policies tab with rule-builder form (pick tool, principal group, conditions). Saves YAML to a postgres `policies` table. | ~1 week |
| 3 | **Make Cedar compiler real** — replace stub with code that takes YAML + emits Cedar text. Wrapper, not a from-scratch engine. Use Cedar Python bindings. | 3–5 days |
| 4 | **Local Cedar enforcement** — run compiled bundle through a local Cedar engine on every C2 tool call when `agentcore.enabled=false`. Demoable without AWS. | ~1 week |
| 5 | **Move tools out of `tool-policy-gateway/src/tools/` → top-level `services/tools/<tool_name>/`** — each tool becomes its own deployable. | ~1 week |
| 6 | **Audit consumer for local mode** — store decisions (permit/forbid/why) in a local DB, surface in Tool Admin UI dashboard. | 3–5 days |

**Phase 2 — AgentCore integration (~1 week, requires live tenant).** Swaps local Cedar engine for AgentCore Tool Gateway as PEP. No UX change for the admin.

| # | Task | Effort |
|---|---|---|
| 7 | Push compiled Cedar bundles to AgentCore Verified Permissions PolicyStore via API. | 2–3 days |
| 8 | Register tools with AgentCore Tool Gateway via IaC (Terraform or CDK). | 2–3 days |
| 9 | Pull audit logs from AgentCore Observability → existing C3 dashboard. | 2 days |
| 10 | Multi-runtime adapter wiring: env var or config flag to flip between local Cedar and AgentCore-backed. | 1 day |

#### A1 — Why a custom Cedar compiler? Why not just point customers at the AWS console?

The AWS Verified Permissions console *does* let you author Cedar policies directly — but it's unusable for enterprise customers in practice:

| Reason | Detail |
|---|---|
| No git-backed audit / review / rollback | Every console click bypasses change management. Compliance teams require versioned, peer-reviewed policy changes. |
| Requires AWS account access | A compliance officer or care-ops admin doesn't have (and shouldn't have) IAM into the customer's AWS account. |
| Speaks raw Cedar syntax | Even technical users struggle with `permit (principal in Group::"care_managers", action == Action::"invoke_tool", ...) when { ... };`. One typo = security regression. |
| No domain awareness | Console doesn't know what "tool", "LOB", "tenant", "PHI export", "high-risk action" mean — every policy starts from zero schema. |
| No bulk operations / templates | Healthcare needs "apply this PHI policy to all 50 tools tagged `phi_writer`" — not 50 console clicks. |
| No environment promotion | Dev → staging → prod policy promotion via CI/CD doesn't exist via console. |
| Multi-tenant | Provider running platform for N customers can't switch AWS console accounts per customer. |

**So enterprises will require:**
1. Policies defined as YAML/JSON in a git repo
2. A friendly authoring UI (the C3 PDP UI) that generates the YAML
3. A CI/CD pipeline that compiles YAML → Cedar → publishes to Verified Permissions API on merge
4. Audit trail integrated into their own systems (Linear, ServiceNow, etc.) — not just CloudTrail

That is exactly what C3 + the Cedar compiler wrapper provides. The AgentCore/Verified Permissions runtime stays — it's the **authoring + governance plane** that has to live in our platform, not in the AWS console.

#### A1 — Layer ownership (we ride on AgentCore, we don't replace it)

| Layer | Owner | Why |
|---|---|---|
| Cedar runtime (permit/forbid evaluation) | **AgentCore Tool Gateway** ✅ use as-is | AWS-managed, fast, audited, free |
| Cedar policy storage | **AgentCore Verified Permissions PolicyStore** ✅ use as-is | Same |
| Audit log emission | **AgentCore Observability** ✅ use as-is | Same |
| Raw Cedar authoring (developers) | AWS console (we don't replicate for devs) | Devs *can* use the AWS console if they want |
| **Business-friendly policy authoring UI** | **AEA C3** (build) | AWS console is unusable for ops/compliance |
| **Cedar compiler (YAML → Cedar text)** | **AEA C3** (build) | So admins write friendly YAML, not raw Cedar |
| **Healthcare domain packs / templates** | **AEA C3** (build) | LOB-aware, PHI-aware, tenant-aware |
| **Audit dashboard correlated to agent runs** | **AEA C3** (build) | Pulls AgentCore audit, presents nicely |
| Cedar push wrapper | **AEA C3** (build, thin) | Wraps Verified Permissions API |

C3 is essentially a **rebuilt-for-enterprise-admins version of AWS Verified Permissions console**, plus healthcare domain awareness and audit correlation. Same pattern as ServiceNow → email/ticketing, Datadog → CloudWatch, Okta → IAM. The underlying AWS primitive is fine for developers in a single account. The wrapper exists because enterprise admins need a higher-level, domain-aware, multi-tenant front door.

#### A1 — Why we haven't shipped Phase 1 yet (honest)

1. **Demo schedule pressure** — visible items (Observability UI, multi_hop strategy, classifier router) win demos in 1–2 weeks each. A1 is invisible to a customer demo until completion.
2. **Test coverage gap (A13)** — refactoring authorization without integration tests is how you ship a security regression. A13 is a hard precondition for shipping #5 (tool relocation) safely.
3. **Cedar learning curve** — schema design, bindings, validation, bundle packaging. Real but manageable; ~1 week of ramp-up baked into Phase 1 estimates.
4. **No live AgentCore tenant** — only blocks Phase 2. Phase 1 is fully unblocked today.

#### A1 — Recommended sequencing

```
A13 (test coverage on hitl/reasoning/tools) ──┐
                                              ├──▶ A1 Phase 1 (~3–4 weeks, no AWS)
                                              │
Define YAML policy schema (2–3 days)        ──┘
                                              │
                                              ▼
              A1 Phase 2 (~1 week, requires AgentCore tenant)
```

Without A13, every Phase 1 task carries regression risk we can't catch. With A13 in place, Phase 1 becomes a focused 3–4 week piece of work delivering real demoable value (policy UI + local enforcement + audit dashboard) before AgentCore is even live.

#### A1 — Decision criterion: customer profile

- **If your customers' admins are AWS-savvy dev/SRE teams** → consider skipping Phase 1 UI entirely; hand them the AWS Verified Permissions console + a CI/CD pipeline. Build only the thin compiler wrapper + IaC.
- **If your customers are healthcare ops with no AWS skills** (the actual ICP) → Phase 1 is non-negotiable. The friendly authoring UI is the entire value-add.

Healthcare payer ICP = Phase 1 is required.

### A2. LOB (Line of Business) tool namespacing
🔲 **Multi-LOB tool separation.** Each customer has multiple LOBs (UM, CM, PA, Appeals, Member Services, Claims, Fraud). Tools must be scoped by LOB.
- **Namespace prefix** in tool ID: `um/get_member`, `cm/get_case`, `pa/submit_form`, `appeals/fetch_history`.
- **Metadata tag** on tool manifest: `lob: ["um","pa"]` (tool can serve multiple LOBs).
- **Per-agent allow-list** in overlay: `allowed_lobs: ["um"]` → agent only sees UM-tagged tools.
- **Separate MCP servers per LOB (optional hard boundary)** for strict data isolation.

### A3. Stateful MCP support in C3 (if Pattern A retained)
🔲 **Conditional — only needed if C3 federates its own tools to AgentCore Gateway (Pattern A, not A′).** ~1–2 weeks of work. If Pattern A′ is chosen, this is unneeded (AgentCore TG handles stateful natively).

### A4. workflow_agent type + durable agent session state
🔲 **New agent type.** Covers C3 long-running category (PA review, appeals adjudication, outreach campaigns). Requires:
- `workflow_agent` template with phased plan-execute graph.
- **Durable agent session state** — checkpoint/resume for the agent's own reasoning loop (not a business WF engine). Options: AgentCore Runtime Filesystem Persistence (just shipped), Temporal-as-session-store, Step Functions-as-session-store.
- HITL hardening for day-long pauses (token refresh, session rehydration).
- Continue-as-new pattern for long-running event-history bloat.
- **Not** a replacement for customer workflow engines (Camunda, Pega, IBM BPM, ServiceNow). AEA agents embed *inside* customer workflow steps.
- Effort: 4–6 weeks.

### A5. classifier_agent / triage_agent type
🔲 **New agent type.** Covers C1 request-response (synchronous triage) and can extend to C4 event-driven triage and C5 batch classification. Single template, multiple invocation patterns.
- Structured output (classification + fields + confidence).
- `simple` reasoning strategy default; `ReAct` when enrichment tools needed.
- Integration with document intake (document lands → triage → route to workflow).
- Effort: ~1 week overlay work once the type template is in platform-core.

### A6. Event adapter pre-graph (C4 Event-driven support)
🔲 **Category extension.** Enables event-driven agents — agents triggered by Kafka / EventBridge / SQS / FHIR subscriptions.
- Pre-graph adapter layer that subscribes to event sources, normalizes to invocation envelope.
- Concurrency model (parallel agent instances per event batch).
- DLQ + retry semantics.
- Emit-as-output path (agent output fans back to event bus for downstream consumers).
- Effort: 3–4 weeks.

### A7. Agent Taxonomy reference — offering artifact
✅ **Done — `docs/design/agent-taxonomy-matrix.html`** created as the canonical reference map of 8 categories × agent types × reasoning strategies × orchestration levels × AEA coverage. Includes healthcare payer + government use-case mapping. To be referenced in all customer and leadership conversations.

### A8. Competitive positioning — updated
- **AWS Bedrock AgentCore (Apr 2026 announcement)** shipped Managed Harness + CLI + coding-assistant skills + Filesystem Persistence. Overlaps with AEA generic platform layer. Healthcare domain, fleet control plane, HITL, multi-dim RAG, evaluation workbench remain differentiated.
- **Microsoft Azure AI Foundry PA template (Apr 2026)** ships a 4-agent PA workflow with MCP tools + Pydantic output + OTel — essentially same pattern as AEA C7 multi-agent, on Azure. Validates direction. Differentiation: AEA is platform-agnostic, broader domain, fleet governance (not single template).
- **AWS healthcare PA blog** — sequential pipeline with LLM steps (not true agentic). Customers already have workflow engines; AEA doesn't replace them.

### A9. Agent embed-inside-customer-workflow posture
🔲 **Positioning artifact.** Document explicitly that AEA agents are **embedded inside the customer's existing workflow engine** (Camunda, Pega, Step Functions, ServiceNow) as intelligent steps — not standalone workflow replacements. Add as callout in proposal + prototype-current-state.html.

### A18. Prior Authorization (PA) Suite — flagship use case
🔲 **Flagship multi-agent use case for healthcare payer ICP.** AEA's answer to Microsoft Azure AI Foundry's PA template (Apr 2026). Differentiator: AEA agents target the **10–20% PA fall-out slice** (cases that escape rules-based STP) and ship as a **single Pega-step integration** that returns the verdict + assigned-nurse routing in one call.

**Today's reality (without AI):** ~80–90% of PA requests auto-approve via deterministic rules in the BPM (Pega/Facets) — straight-through processing, sub-second, no human. The remaining **10–20% fall out to manual nurse/MD review** — that's where 5–14 day delays, $35B annual cost, inconsistent decisions, and CMS-0057-F regulatory risk live. PA Suite agents target this slice.

**Architecture — Shape B (one Pega step → one AEA call → one final response):**
```
Pega step → POST /agents/pa-review (one call, all logic inside AEA)
              ↓
              AEA workflow_agent (deterministic, asyncio):
                ├── Compliance + Clinical (parallel via asyncio.gather)
                ├── Coverage (sequential, uses Clinical output)
                ├── Synthesis → APPROVE / PEND verdict + 3-gate rubric
                └── If PEND → Routing Specialist → assigned_nurse_id
              ↓
              return {decision, confidence, rationale, evidence,
                      assigned_nurse_id, routing_reason, audit_pdf_url}
              ↓
Pega: takes single response, assigns to nurse, owns case lifecycle
```

This is **Shape B**, not Shape A (Pega-makes-4-separate-calls). Top-25 payer BPMs prefer one external call per intelligent step — minimizes BPM state management, fewer failure modes, cleaner contract.

**Two orchestration shapes considered, Shape B chosen:**

| Shape | Description | Chosen? |
|---|---|---|
| **A — Pega makes 4 separate calls** | Pega calls compliance, clinical, coverage, synthesis as 4 independent steps. AEA needs no orchestration. | ❌ Too much BPM state mgmt; not how BPMs prefer to integrate |
| **B — Pega makes 1 call, AEA orchestrates internally** | Pega calls AEA once. AEA's deterministic workflow_agent runs all 5 specialists internally and returns a single response. | ✅ |

**Critical distinction — workflow_agent is deterministic, NOT an LLM supervisor:**

| Term | What it means | PA Suite needs it? |
|---|---|---|
| **Supervisor LLM agent** | LLM decides at runtime which sub-agents to call (dynamic routing) | ❌ NO — PA flow is fixed (same 4–5 specialists every case) |
| **Deterministic workflow_agent** | Hardcoded asyncio pipeline (parallel + sequential) wrapped as an agent so it appears in the registry with standard governance hooks | ✅ YES — A4 with deterministic flavor |

**A4 is back as a hard prereq** — but as deterministic workflow_agent, not LLM supervisor.

**The 5 agents (revised — Routing Specialist added):**

| # | Agent | Type (C1 specialist) | Tools called | Output |
|---|---|---|---|---|
| 1 | Compliance | C1 specialist + ReAct | NPI Registry, ICD-10 | `{compliant, checklist (10-item), issues, evidence}` |
| 2 | Clinical | C1 specialist + ReAct | ICD-10, PubMed, ClinicalTrials.gov | `{clinical_assessment, risk, citations}` |
| 3 | Coverage | C1 specialist + ReAct | CMS NCD/LCD lookup | `{covered, criteria_met/not_met, policy_refs}` |
| 4 | Synthesis | C1 specialist + simple/ReAct | (no MCP tools) | `{decision: APPROVE/PEND, confidence, rationale, gates}` |
| 5 | **Routing Specialist** (NEW) | C1 specialist + simple | nurse_directory, shift_calendar, queue_depth | `{assigned_nurse_id, routing_reason, fallback_options}` |

**Each agent has its own full overlay:**
```
overlays/<agent_name>/
  prompts/prompts.yaml      ← system + planner + responder prompts (per agent)
  skills/*.md               ← procedural rules / domain expertise (per agent)
  tools/tools.yaml          ← per-agent tool allow-list
  rag.yaml                  ← per-agent KB retrieval config
  hitl.yaml                 ← per-agent HITL gating
  reasoning.yaml            ← strategy (simple/ReAct)
```

5 agents × full overlay = 5 distinct prompt sets + skill markdowns + tool allow-lists. Routing Specialist's `skills/` folder is where Excel-equivalent if/then/else routing rules live.

**Routing Specialist — high-value, under-shipped agent:**

Today's payer ops pain: HITL nurse routing relies on Excel sheets with hundreds of rows of skill + schedule + capacity rules — too messy for BPM decision tables, too change-prone for engineering tickets. LLMs read and reason over messy markdown rules natively.

```markdown
# Skill-based routing rules (skills/routing_rules.md)

## Default specialty routing
- Oncology PA → oncology-trained RN (skill: ONC-CERT)
- Behavioral health → LCSW or BH-RN
- Specialty drug ($>10K) → pharmacist consultant

## Exceptions
- Florida Medicaid SNP → Tampa team regardless of specialty
- Novel procedure (no NCD/LCD match) → escalate to medical director, not RN
- Urgent (CMS 72-hr clock) → next-available RN with matching skill, ignore territory

## Capacity + schedule rules
- Don't assign if RN's queue depth > 15
- Primary nurse on PTO → fall back to backup nurse
- After 6pm ET → West Coast team unless urgent
```

LLM reads this + calls `nurse_directory()` + `shift_calendar()` + `queue_depth()` tools → returns assignment with rationale logged for audit.

**Why agent fits better than rules engine:**

| Traditional (BPM/rules engine) | Agent approach |
|---|---|
| Translate Excel → Pega decision tables → 6-week eng cycle | Drop Excel into markdown skill file → live in minutes |
| Edge cases multiply → unmaintainable | LLM handles "kind of like" / "usually" / "unless X" naturally |
| Skill + schedule + capacity = giant rule tree | LLM reasons over current state at runtime |
| Excel changes = engineering ticket | Ops admin edits markdown → no PR |

**What AEA owns (revised):**
- 5 specialist agent overlays (Compliance, Clinical, Coverage, Synthesis, Routing Specialist) — each with own prompts + skills + tools + RAG + HITL config
- 1 deterministic workflow_agent (A4) wrapping the asyncio pipeline as an AEA-registered agent
- 5 healthcare MCP tools (NPI Registry, ICD-10, CMS Coverage, ClinicalTrials.gov, PubMed)
- 3 routing utility tools (nurse_directory, shift_calendar, queue_depth)
- HITL adapter for customer BPM (e.g., `hitl.adapter: pega`) — LENIENT mode (APPROVE/PEND only, mandatory clinician Accept/Override)
- Audit PDF generation + notification letters

**What AEA does NOT own:**
- PA case lifecycle / state — customer BPM
- Case management UI — customer BPM
- 80–90% STP rules-based auto-approval — customer BPM (already exists)
- System of record (claims, member, EHR) — customer systems

**Comparison vs Microsoft Foundry PA template:**

| Capability | AEA (Shape B, embedded) | MS Foundry PA template |
|---|---|---|
| Per-agent intelligence + tools | ✅ | ✅ |
| Single-call orchestration | ✅ deterministic workflow_agent | ✅ FastAPI + asyncio |
| MCP tool serving | C3 PDP + AgentCore PEP (after A1) | Foundry Tools (remote MCP) |
| Customer BPM integration | ✅ Native — one Pega step | 🔲 Not the model — replaces BPM |
| **AI-driven HITL nurse routing** | ✅ **Routing Specialist agent** | 🔲 Not in MS template |
| Multi-cloud (AWS + Azure + on-prem) | ✅ Adapter pattern | 🔲 Azure-only |
| Multi-customer fleet | ✅ Agent Factory + Registry | 🔲 Single template per deployment |
| Operator-editable config (no redeploy) | ✅ Overlay YAML + skills markdown | ✅ Skills markdown |
| HealthLake / FHIR-native clinical data | ✅ Hybrid (HealthLake + Postgres) | 🔲 Custom synthetic |
| Top-25 payer fit (BPM stays) | ✅ | 🔲 Greenfield / small payers |

**Effort breakdown — ~8–9 weeks:**

| # | Task | Effort |
|---|---|---|
| 0 | New C1 specialist agent type (template + framework) | ~1 week |
| 1 | 5 specialist overlays (Compliance / Clinical / Coverage / Synthesis / Routing Specialist) — each with prompts + skills + tool allow-lists + RAG config | ~1.5 weeks |
| 2 | 5 healthcare MCP tools + 3 routing tools (nurse_directory, shift_calendar, queue_depth) | ~2 weeks |
| 3 | Deterministic workflow_agent (A4) — asyncio pipeline wrapped as agent | ~1 week |
| 4 | LENIENT HITL config + audit PDF + notification letters | ~1 week |
| 5 | HealthLake integration (FHIR resource generation, import jobs, synthetic data seeder) + Postgres workflow schema | ~1 week |
| 6 | **PA-specific Admin UI screens** (CRITICAL — see breakdown below) | ~2 weeks |
| 7 | Integration testing + Pega contract handshake + E2E | ~1 week |

**Sub-task 6 — PA-specific Admin UI screens (~2 weeks).** Today's Agent Factory UI covers prompt editing, tool allow-list, basic RAG, memory toggles, single-tenant scope. PA Suite needs **10 new config screens** on top of that — without them, operators cannot configure a payer instance from the UI without YAML editing.

| Screen | Purpose | Status today |
|---|---|---|
| Synthesis rubric weights | Sliders for Coverage / Clinical / Compliance / Policy weight (default 40/30/20/10) — payer-tunable | 🔲 New |
| LENIENT-mode HITL toggle | Enforce APPROVE/PEND-only (no auto-DENY) per CMS-0057-F + state AI-PA laws | 🔲 New |
| Routing rules markdown editor | Edit `skills/routing_rules.md` directly in UI — Excel-equivalent if/then/else with live preview | 🔲 New |
| Nurse roster + shift schedule integration | Configure connection to payer's nurse directory + scheduling system | 🔲 New |
| BPM adapter config | Pega vs ServiceNow vs Camunda endpoint configuration, queue mappings, callback URLs | 🔲 New |
| Plan / LOB filter | Which plans this PA instance serves (Medicare PA / Medicaid by state / commercial) | 🔲 New |
| Per-tool risk level matrix | Risk_levels per agent × per tool (oncology = MD review, BH = MD review, etc.) | ⚠ Partial — YAML only, no UI |
| Per-agent KB selection | Multi-KB picker per specialist (Compliance KB / Clinical KB / Coverage KB) | ⚠ Partial — single-KB UI |
| Audit PDF template editor | Customize the 8-section audit PDF layout/content per payer brand | 🔲 New |
| Notification letter template editor | Customize approval / pend letter templates per payer | 🔲 New |

**Why this is critical:** without these screens, every payer onboarding requires YAML editing + engineering involvement. UI-driven onboarding is the entire AEA pitch vs Microsoft Foundry's code-bound template. **PA-specific Admin UI is what makes the platform thesis demonstrable.**

**Prerequisites (hard sequencing — revised):**

```
A13 (test coverage on hitl/reasoning/tools)  ─┐
                                                ├─▶ A18 PA Suite (~6–7 weeks)
A1 Phase 1 (PDP/PEP, tools to services/tools/) ─┤
                                                │
A4 (deterministic workflow_agent type)        ─┤
                                                │
A16 (skills wired into runtime — markdown loader)
```

A13, A1 Phase 1, A4, A16 run in parallel. PA Suite drops on top.

**A4 (deterministic workflow_agent) is back as a hard prereq.** Its purpose here is wrapping the asyncio pipeline as an agent that appears in the registry with governance/audit/policy hooks — NOT as an LLM supervisor. Two flavors of A4 to document: (a) deterministic (PA needs this), (b) LLM-driven dynamic supervisor (future use cases like greenfield concierge).

**Total runway from today: ~12–14 weeks** to a working AEA PA Suite that beats MS Foundry on Top-25 payer fit + AI-driven HITL routing + UI-driven payer onboarding (no YAML editing required).

**Strategic positioning vs MS Foundry — updated:**
> "Microsoft Foundry's PA template ships the whole stack (UI + orchestration + 4 agents + tools), Azure-only, designed to replace the BPM. AEA is different: one Pega step → AEA returns the verdict AND the assigned nurse. We don't replace Pega — we plug into it. We add a 5th agent (Routing Specialist) that reads payer Excel routing rules as markdown and assigns the right nurse for HITL — something MS doesn't do. AEA agents target the 10–20% fall-out slice that already costs payers $35B/year. We don't touch the 80–90% STP that BPM rules already handle correctly."

**Demo asset:** AEA PA Suite becomes flagship — replaces pre-call-assessment as the "AEA at full value" showcase.

**Open implementation questions (resolve at build time):**
- Naming for the C1 specialist agent type (placeholder: "specialist_agent" or similar)
- Naming for the deterministic A4 flavor ("workflow_agent: deterministic" vs "pipeline_agent" vs other)
- Whether Routing Specialist becomes part of the workflow or a separate Pega step (probably part of workflow — return verdict + routing in one response)

### A17. Tenant + thread resolution from ctx not honored
🔲 **Bug surfaced during functional testing.** When a request includes `tenant_id` and `thread_id` in the ctx body, those values are ignored — memory writes always go to `default-tenant/default-thread`. As a result, multi-turn memory continuity for any non-default tenant is broken (turn 1 writes to default-thread, turn 2 reads from default-thread but doesn't get prior content because the read scoping doesn't match).

**Reproduction:**
1. POST /invocations with `{"prompt":"remember name X","ctx":{"tenant_id":"abc","thread_id":"t1",...}}`.
2. Turn 1 writes to `state/memory/default-tenant/conversation/default-thread.json` (NOT abc/t1).
3. Turn 2 with same tenant/thread fails to recall name.

**Root cause to investigate:**
- `LangGraphRunner.run()` in `agents/.../services/agent-runtime/src/platform/langgraph_runner.py` does `tenant_id = ctx.get("tenant_id") or "default-tenant"` — should work.
- Likely something downstream (auth interceptor, build_context, memory_writer) is overriding tenant_id from the auth/session context.
- Probably the multi-tenancy layer is enforcing tenant_id derived from auth token (or AUTH_MODE=OPTIONAL default), not request body.

**Pre-existing — not a refactor regression.** Same behavior would have existed before the refactor; refactor didn't touch this path.

**Effort:** ~1 day to trace the override + decide policy (auth-derived vs body-derived vs whichever wins).

---

### A16. Skills — wire into runtime + shared library + versioning/eval
🔲 **Today: scaffold only.** `SkillLoader` library exists in `packages/platform-core/src/platform_core/prompt/skill_loader.py` (with 7 unit tests). Sample skill exists at `templates/overlay-templates/overlays/chat_agent_simple/skills/escalate_to_human.md` and mirrored to running agent. **Skills are NOT loaded into prompts at runtime — folder exists, code exists, no consumer.**

**To make skills actually useful, three pieces of work:**

**1. Wire SkillLoader into the planner prompt building**
- In `services/platform-services/src/services/reasoning/planner.py` (or wherever prompts are assembled): instantiate `SkillLoader` for the active overlay, call `find_by_trigger(user_query)`, append matching skill bodies to the system prompt.
- Effort: ~2 hours.

**2. Shared skills library (cross-agent reuse)**
- Today: skills live per-overlay (`overlays/<type>/skills/*.md`). One skill = N copies if used by N agents.
- Build: `packages/skills-library/` (or `services/skills-library/`) — org-wide skill catalog. Agents reference by name in `overlay.yaml`:
  ```yaml
  skills:
    inherit:
      - phi_masking
      - clinical_disclaimer
    overrides:
      - escalate_to_human   # local override of the shared one
  ```
- Loader merges shared + local, local overrides shared.
- Effort: ~1 week.

**3. Skills versioning + evaluation**
- Skills today: just markdown + git history. No formal versioning. No eval harness.
- Build:
  - Extend `services/prompt-management/` to store skill versions in DB.
  - Add eval scenarios per skill version (run agent with skill v1 vs v2 → score outputs).
  - A/B testing per skill in the admin UI.
- Effort: ~2 weeks (depends on prompt-management lifecycle being wired first).

**Dependency:** A16 mostly assumes prompts/markdown loader (A11) and prompt-management lifecycle work are done first.

**Why it matters:** without this work, skills are just decorative folders. With it, skills become a first-class operator-editable layer (separate from system prompts and tools) for procedural knowledge / norms / domain expertise.

---

### A15. Flow diagrams for remaining agent types (when built)
🔲 **Track per-agent-type flow documentation.** `docs/design/agent-flow-diagrams.html` has 3-level diagrams (architecture / lifecycle / config overlay) for the 2 agent types built today — `chat_agent_simple` (C2 Conversational) and `summarization_agent_simple` (C1 Request-Response).

When a new agent type is built, add a section to that file with:
1. Category placement (which of the 8 categories from agent-taxonomy-matrix).
2. Level 1 — high-level architecture (containers + call path).
3. Level 2 — pre-graph / in-graph / post-graph lifecycle.
4. Level 3 — config overlay (which YAML drives which step).

**Pending agent types (build flow diagrams when each ships):**
- `chat_agent_react` — C2 Conversational, ReAct strategy.
- `chat_agent_plan_execute` — C2 / C3 Long-running, plan-execute.
- `chat_agent_reflection` — C2 Conversational, reflection.
- `chat_agent_multi_hop` — C3 Long-running, multi-hop.
- `classifier_agent` — C1 Request-Response (or C4 event-driven), simple classifier.
- `workflow_agent` — C3 Long-running / C7 Multi-agent, hierarchical orchestrator.
- `voice_agent` — C6 Voice/Video, streaming turn-taking.
- `panel_agent` / `debate_agent` — C7 Multi-agent peer.
- `guardrail_agent` — C7 Multi-agent monitor.

Each section should include category placement explicitly and link back to the agent-taxonomy-matrix.html for category context.

---

### A14. Merge C3 + C4 into a unified Control Plane service
🔲 **Architectural simplification.** In Pattern A′, C3 (tool-policy-gateway) is no longer in the agent request path — AgentCore Tool Gateway handles MCP serving. C3 becomes a backend + admin UI for policies + audit, structurally identical to C4 (agent factory backend + UI).

**Current shape (after refactor):**
| | C3 | C4 |
|---|---|---|
| Backend | tool-policy-gateway (FastAPI) | agent-factory-support-api (FastAPI) |
| UI | tool-admin-ui (React) | agent-factory-ui (React) |
| Scope | tools, policies, audit | agents, templates, prompts |

**Proposed merged shape — single Control Plane:**
```
control-plane/
├── backend (one FastAPI app)
│   ├── /agents/*        ← agent factory
│   ├── /prompts/*       ← prompt mgmt
│   ├── /policies/*      ← Cedar compiler + push
│   ├── /audit/*         ← audit consumer + dashboards
│   └── /domain-packs/*  ← curation
└── ui (one React app, multi-tab)
```

**Tradeoffs:**
- **Merged:** simpler deployment + ops, one auth boundary, cleaner mental model. Single team owns governance end-to-end.
- **Separate:** independent scaling per concern, separate teams could own. But scaling concerns are minimal for admin services.

**Recommendation:** merge after AgentCore Tool Gateway integration ships (A1) — at that point C3 has no runtime responsibility, and the separation cost outweighs the benefit.

**Effort:** ~1 week — combine FastAPI apps, add tabs to one React UI, update IaC.

---

### A13. Test coverage uplift — fill the gap
🔲 **Critical — current test coverage is very thin.** Today only the SkillLoader (7 cases, added in refactor) has unit tests. Most platform-core modules + services have no tests. Production-ready requires meaningful coverage.

**High-priority targets (highest blast radius first):**
1. `hitl/approval_store` — durable state machine, propose-commit pattern. Cannot ship to production without tests covering pause/resume, expiry, double-commit, audit trail.
2. `memory/file_memory`, `memory/scope_resolver`, `memory/write_engine` — read/write correctness across 4 scopes; lock-write rules per agent type.
3. `reasoning/strategies/{simple,react,plan_execute}` — graph wiring + tool dispatch + responder synthesis. Mock LLM calls.
4. `rag/patterns/*` (naive, agentic, hyde, multi_hop, self_corrective) — retrieval correctness per pattern.
5. `tools/registry`, `tools/validation` — schema validation, allow/deny enforcement.
6. `auth/authorization` — tenant claims handling, AUTH_MODE OPTIONAL vs REQUIRED behavior.
7. Integration tests — agent runtime end-to-end against mocked C2/C3 endpoints.

**Definition of done:**
- ≥80% line coverage on platform-core critical paths (hitl, memory, reasoning).
- Every new feature ships with tests.
- Every bug fix adds a regression test.
- CI runs `pytest` on every PR; failures block merge.

**Effort:** 3–4 weeks for the seven targets above, in priority order.

**Tooling already in place** (from refactor Phase 1): pytest, pytest-asyncio, pytest-cov declared in `packages/platform-core[dev]` extras; ruff + mypy + pip-audit configured.

---

### A12. Documentation update sweep — post-refactor reconciliation
🔲 **After refactor + testing, update all customer-facing and design docs.** All HTML files reference the old container topology (C3 as MCP server, tools inside C3, etc.). Once the refactor lands and tests pass:

**Files to update:**
- `docs/design/prototype-current-state.html` — §11 container mapping, §12.3 integration patterns, §13 runtime flow, §14 key files reference. Replace tool-gateway references with tool-policy-gateway. Update MCP topology diagrams. Update §12 to show PDP/PEP architecture as final.
- `docs/design/agent-taxonomy-matrix.html` — §9 control plane subsections. Update C3 description from tool serving to PDP/governance. Update §9.7 infrastructure applicability table.
- `docs/design/design.md` — §10 already updated; verify consistency with refactored structure.
- `docs/design/client-chatbot-platform-proposal.html` — update architecture diagrams (Section 2 ASCII), AWS service mapping (Section 3), where Step Functions fits (Section 6).
- `docs/proposal/offering-proposal-summary.html` — update C3 description.
- `docs/proposal/accelerator-technical-design.html` — update C3 to PDP framing; add PDP/PEP diagram.
- `docs/proposal/offering-architecture-v3.html` and `offering-architecture-v4.html` — update container architecture.
- `docs/proposal/customer-delivery-playbook.html` — update if it references container topology.
- `docs/proposal/internal-playbook.html` — update if it references container topology.
- `docs/proposal/offering-pr-faq.html` — verify customer-facing claims still align.

**Effort:** ~2–4 hours after refactor + tests pass.

**Rule:** docs update last (don't update before refactor lands — risks doc drift if refactor changes mid-flight).

---

### A11. Repo refactor — packages/services split + Brij-style overlays + skills + Pattern A′ rename
🔲 **Foundational refactor — do BEFORE major new features.** Restructures the repo into a clean, idiomatic Python monorepo with proper library/service separation. One-and-done; will not need to redo.

**Goals:**
1. Clean, idiomatic Python monorepo (sets up cleanly for future multi-repo split).
2. Proper installable `platform-core` Python package (enables AgentCore Factory team to `pip install aea-platform-core` and consume our primitives).
3. Adapter pattern preserved — AEA can flip memory / MCP / identity / observability adapters to consume Factory's primitives or AgentCore-native services.
4. Add `skills/` convention to overlays.
5. Adopt clean per-overlay internal layout (Brij-style: `prompts/`, `skills/`, `tools/`, `evals/`).
6. Move misplaced files to where they belong.
7. Best practices: type hints, lints clean, no secrets, deps pinned, auth preserved.
8. Pattern A′ rename: C3 becomes `tool-policy-gateway` (policy + governance), tools and RAG split into separate services.

**Final structure:**
```
agent-platform/
├── packages/
│   └── platform-core/                  ← installable Python package (pyproject.toml, versioned)
│       ├── src/platform_core/
│       │   ├── memory/                 ← library code
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
│   ├── platform-services/              ← C2 (reasoning + memory orchestrator + HITL)
│   ├── rag/                            ← split out — retrieval + ingestion + multi-dim orchestration
│   ├── tools/                          ← tool implementations (deployable Lambdas/containers)
│   ├── tool-policy-gateway/            ← C3 RENAMED — policy/governance only (no tool serving)
│   ├── agent-factory-ui/               ← C4
│   ├── agent-factory-support-api/      ← C4
│   └── prompt-management/              ← C4
│
├── templates/
│   ├── agent-runtime-shell/            ← C1 thin shell
│   ├── overlay-templates/              ← RENAMED from agent-runtime-template
│   │   ├── common/
│   │   └── overlays/
│   │       └── chat_agent_simple/
│   │           ├── prompts/            ← Brij-style
│   │           ├── skills/             ← NEW
│   │           ├── tools/
│   │           ├── evals/              ← NEW
│   │           └── overlay.yaml
│   ├── agent-ui-template/
│   └── capability-ui-template/         ← generic only (no care_management)
│
├── capabilities/
│   └── care-management/
│       ├── ui/                         ← MOVED from templates/capability-ui-template/care_management
│       └── domain.yaml
│
├── agents/                             ← generated agent instances
├── infra/                              ← IaC
├── docs/
├── platform-store/
├── docker-compose.yml
├── pyproject.toml                      ← workspace root
└── README.md
```

**Library / runtime split — universal pattern:**

| Area | Library code in `packages/platform-core/` | Runtime service in `services/` |
|---|---|---|
| Memory | `memory/` adapters + scope policy | inside `platform-services/` (C2) |
| RAG | `rag/` retrievers + indexer interfaces | `services/rag/` |
| Tools | `tools/` registry + adapters | `services/tools/` (impls) + `services/tool-policy-gateway/` (governance) |
| HITL | `hitl/` approval store + state machine | inside `platform-services/` (C2) |
| Reasoning | `reasoning/` strategies + planner/executor | inside `platform-services/` (C2) |
| Prompts | `prompt/` loader + templating | `services/prompt-management/` |
| Auth | `auth/` adapter interfaces | (no separate service) |
| Observability | `observability/` tracing primitives | (no separate service) |

**Why packages vs. services:**
- **Library** = code only, no Dockerfile, importable via `pip install`. Reused across multiple services.
- **Runtime service** = deployable container with Dockerfile, FastAPI app, HTTP endpoints. Imports libraries from `packages/`.

**Pattern A′ implications baked in:**
- C3 renamed `tool-policy-gateway` (no tool serving).
- Tools live in `services/tools/` (deployable) + registered with AgentCore Tool Gateway via IaC.
- RAG split into `services/rag/` (own retrieval + multi-dim orchestration).
- Stateful MCP comes from AgentCore Tool Gateway natively (free).

**AgentCore Factory integration win:**
- `aea-platform-core` becomes a proper installable Python package.
- Matt's AgentCore Factory team can `pip install aea-platform-core==X.Y.Z` from internal PyPI / CodeArtifact / git.
- Adapter pattern means AEA can also consume *their* memory / MCP / identity adapters via config flip.
- Two-way integration: AEA inside Factory, AEA can consume Factory primitives.

**Migration phases (~3–5 hours total with collaboration):**

| # | Phase | Risk |
|---|---|---|
| 0 | Pre-flight audit — catalog paths + imports + docker-compose + IaC refs | None |
| 1 | Create `packages/platform-core/` with pyproject.toml | Low |
| 2 | Reorganize `shared-infra/*` → `services/*` | Medium |
| 3 | Move top-level `platform-services/prompt-management` → `services/prompt-management` | Low |
| 4 | Move `platform-tools/*` → `services/agent-factory-ui` + `services/agent-factory-support-api` | Low |
| 5 | Rename `templates/agent-runtime-template` → `templates/overlay-templates` | Low |
| 6 | Move `templates/capability-ui-template/care_management` → `capabilities/care-management/ui` | Low |
| 7 | Adopt Brij-style overlay layout (per-overlay `prompts/`, `skills/`, `tools/`, `evals/`) | Medium |
| 8 | Add `skills/` convention + skill loader in platform-core | Low |
| 9 | Split RAG into `services/rag/`; rename C3 → `tool-policy-gateway/`; move tools to `services/tools/` | Medium |
| 10 | Update all imports, docker-compose paths, IaC refs, README | Medium |
| 11 | Run all tests + boot all services + run one agent end-to-end | Verify |
| 12 | Lint/mypy/security scan, fix findings | Low |

**Best-practice guarantees:**
- Type hints throughout, mypy-clean.
- Linting clean (ruff/pylint).
- No circular imports.
- No secrets in code or configs.
- Auth modes preserved (`AUTH_MODE` enforcement intact).
- Deps pinned (no unpinned `>=`).
- Run `pip-audit` for known CVEs.
- No PHI/PII in logs.
- TLS / encryption assumptions intact.

**Effort:** ~3–5 hours of mechanical refactoring with real-time collaboration. **Do BEFORE workflow_agent and other major feature work** to avoid migration pain.

---

### A10. Dynamic routing — classifier layer in front of agent fleet
🔲 **Critical — required for chatbot fleet use cases.** Reasoning strategy is fixed per-agent overlay (not switchable mid-run). So for a fleet of N chatbots (each with different strategy/tools/scope), we need a classifier that picks the right agent per query.

**Architecture (additive, no fundamental change):**
- New thin **router service** sits between UI and agent fleet.
- Reads Agent Registry (C4) — knows what agents exist + their capabilities.
- Classifies incoming query via lightweight LLM (Haiku) — picks best-match agent.
- Forwards to chosen agent's `/invocations`. Streams response back.
- C1/C2/C3 unchanged; Agent Factory UI adds a "routing hints" field to agent manifests.

**Agent manifest extension:**
```yaml
routing_hints:
  query_patterns: ["simple lookup", "single fact", "status of X"]
  strategy_profile: simple
  confidence_floor: 0.7
```

**Effort:** ~1–2 weeks.
**Why critical:** (a) required for the client chatbot fleet use case (Tom/Joe conversation); (b) architectural answer to "how does AEA support dynamic reasoning selection" without changing the per-overlay strategy model; (c) Anthropic's "routing" pattern implemented concretely.

**Placement:** new service in C4 control plane area (route-fit with Agent Registry consumer).

---

## Next 10 Items to Build — Prioritized

| # | Item | Type | Why Now |
|---|---|---|---|
| 1 | **Exception Handling & Recovery** | Separate pluggable service/library | Agents silently fail on tool timeout, LLM API error, network failure today. Production blocker. |
| 2 | **Event-Driven Agents** | Separate pluggable service (Event Bus) | Most real production agents are event-triggered. Unlocks workflow automation without changing any agent. |
| 3 | **multi_hop + reflection strategies** | Overlay only — new strategy files | Completes the reasoning strategy set. No platform changes, low risk. |
| 4 | **Observability UI** — Lineage + Metrics pages | UI addition — reads existing `/api/traces` | Demo-critical. Shows platform working end to end. High value, no backend changes needed. |
| 5 | **Routing tab** (3f) | UI + agent.yaml only | Completes Agent Registry. Config-driven hard routes. Small change. |
| 6 | **Guardrails** (10m) | Separate pluggable service or platform-core layer | Healthcare/enterprise safety requirement. Input/output policy enforcement. |
| 7 | **Context Engineering** (7) | platform-core addition (context_builder.py) | Token budgeting + priority truncation before real member data scale hits context limits. |
| 8 | **Goal Definition & Tracking** (14) | platform-core + new memory type | Persistent multi-step objectives across turns. Needed for long-running workflows. |
| 9 | **Resource-Aware Optimization** | platform-core addition (query classifier + model router) | Dynamic model routing (Haiku → Sonnet → Opus by complexity). Direct cost impact for customers. |
| 10 | **summarization_agent_rag overlay** | Overlay only — new files | KB-enriched summaries. New capability, zero platform risk. |
| 11 | **HITL Durable State & Session Rehydration** | platform-core — hitl/approval_store.py + C1 resume logic | If a nurse takes 2+ hours to approve, auth tokens and short-term memory may have expired. Agent wakes up in broken state. Need durable HITL state that rehydrates session context and re-validates auth on resume. |
| 12 | **Session Rules** | platform-core — C1 session policy engine | No concept of session rules today. Need per-agent, per-LOB session policy: max turn limits, inactivity timeout, re-auth triggers, session scope boundaries. Required before production deployment — without it, sessions have no policy-enforced lifecycle. |
| 12b | **PII Masking — Day 1 (not roadmap)** | platform-core interceptor — pre-response filter in C1 | C2 LLM can be tricked via adversarial prompt into echoing sensitive C3 data into C1 chat response, bypassing data layer isolation. For healthcare this is not a roadmap item — it must be active before any real member data is processed. Output filter that detects and masks PHI before C1 sends response to UI. |
| 13 | **Enterprise Deployment Artifact + C1 Self-Registration** | Agent Factory + C1 startup | Enterprise customers (healthcare, finance, air-gapped) cannot let an external wizard deploy into their environment — compliance, change control, security policy, air-gap. Fix: scaffold wizard outputs a deployment artifact (Helm chart / Terraform / docker-compose) instead of deploying directly. Customer runs it through their own CI/CD pipeline. C1 phones home on first startup to self-register with the Support API. Decouples scaffold (generate) from deploy (customer-controlled) from registration (automatic on first boot). Required before any regulated enterprise customer onboards. |
| 14 | **Fully Customer-Hosted Accelerator Deployment Model** | Agent Factory + infrastructure packaging | Some regulated customers (air-gapped, strict data residency) cannot have any dependency on provider infrastructure. Need a second deployment model where C1+C2+C3+Control Plane all run inside the customer's environment — packaged as a CloudFormation/CDK stack, Helm chart, or AWS Marketplace listing. Registry is local to customer in this model. Observability is opt-in call-home only. Updates are customer-controlled (version pinning). Key design question: how to maintain feature parity between hosted (default) and accelerator (customer-hosted) without maintaining two codebases. |
| 15 | **Infrastructure-as-Code (IaC) — Terraform + Helm + AgentCore/Bedrock Packaging** | Infrastructure — new workstream, foundational | Platform currently has no IaC. To deploy on AgentCore, Bedrock, or any customer environment in a repeatable, compliant way, every service must be packaged and provisioned as code. This is a full workstream — see checklist below. |

**Architectural pattern across all 10:**

- **Items 1, 2, 6 — Separate pluggable services.** Exception handling, Event Bus, Guardrails each deploy independently. Agents don't change at all — plug in at infrastructure level.
  - **Exception Handling:** resilience library (Python `tenacity`) in platform-core wrapping every external call (tools, LLM API, memory, RAG) — OR sidecar proxy (Envoy/Istio) at network level. Not tool-only — covers all C1→C2→C3 calls.
  - **Event Bus / Trigger Service:** listens to event sources (webhooks, SQS/Kafka, CDC, cron), normalizes to `AgentEvent` schema, routes to the right agent's `/invocations`. Agents are oblivious.
  - **Guardrails:** pre-LLM input check + post-LLM output check. Config-driven policy rules. Interceptor pattern — extra validation node in the call path.

- **Items 3, 5, 9, 10 — Overlay / config changes only.** No platform rewrite. New files, new YAML options.

- **Items 4, 7, 8 — platform-core + UI additions.** No new services. Extend context_builder.py, memory store, Agent Factory UI.

---

## Backlog #15 — IaC Deep Dive: What It Means and What Needs to Be Built

### What is IaC and why does the platform need it?

Right now the platform runs locally (Docker containers started manually, config files edited by hand). To deploy it into a real customer environment — on AWS AgentCore, Bedrock, or a customer's own cloud — every piece of infrastructure needs to be defined as code so it can be provisioned repeatably, reviewed, versioned, and audited. This is what Terraform and Helm do:

- **Terraform** — provisions the cloud infrastructure itself: VPCs, subnets, IAM roles, databases, caches, S3 buckets, networking, security groups. Think "build the house."
- **Helm** — packages the running services (C1, C2, C3, Control Plane) as Kubernetes charts so they can be installed/upgraded/rolled back in a cluster. Think "move the furniture in."
- **AWS CDK / CloudFormation** — AWS-native alternative to Terraform. Preferred if targeting AgentCore/Bedrock natively since AgentCore has first-class CDK constructs.
- **docker-compose** — simpler option for single-machine or dev/test deployments. Not for production.

For **AWS AgentCore** specifically: AgentCore is a managed runtime — you don't manage the underlying compute. You package C2 as an AgentCore agent definition and AgentCore runs it. Still need Terraform/CDK for surrounding infrastructure (networking, IAM, memory backends, observability).

For **HIPAA/healthcare compliance**: every resource must be encrypted at rest + in transit, audit-logged via CloudTrail, access-controlled via IAM, and deployed inside a private VPC. IaC is what makes this auditable — compliance teams need to see the config as code, not "we set it up manually."

---

### IaC Build Checklist — What Needs to Be Done

#### Phase 1 — Containerize everything (prerequisite)
- [ ] C1 Agent Runtime — Dockerfile exists, needs prod hardening (non-root user, health check, no dev deps)
- [ ] C2 Orchestrator services — Dockerfile per service (reasoning, memory, RAG, policy, HITL, tool governance)
- [ ] C3 Tool Gateway — Dockerfile exists, needs prod hardening
- [ ] Control Plane (Agent Factory UI + Support API) — Dockerfiles
- [ ] Push all images to a container registry (ECR for AWS)
- [ ] Tag strategy: semantic versioning per service

#### Phase 2 — Terraform / CDK for infrastructure
- [ ] VPC + subnets (public/private) + security groups
- [ ] IAM roles and policies (least-privilege per service: C1 role, C2 role, C3 role, Control Plane role)
- [ ] RDS / Aurora (episodic + semantic memory backends)
- [ ] ElastiCache (short-term memory backend)
- [ ] S3 buckets (prompt storage, trace storage, config artifacts)
- [ ] API Gateway or ALB (entry point for C1 `/chat` endpoint)
- [ ] Secrets Manager (LLM API keys, C1→C2 auth tokens, DB credentials)
- [ ] CloudTrail + CloudWatch (audit logging, metrics — HIPAA requirement)
- [ ] KMS keys (encryption at rest for all data stores)
- [ ] VPC endpoints for Bedrock / AgentCore (keep traffic off public internet)

#### Phase 3 — AgentCore / Bedrock specific
- [ ] Understand AgentCore agent definition schema — how to register C2 as an AgentCore agent
- [ ] Bedrock model access — request access to Claude/Titan models in customer account
- [ ] AgentCore memory integration — does AgentCore memory replace our memory service or complement it?
- [ ] AgentCore tool integration — how does C3 Tool Gateway register tools with AgentCore
- [ ] IAM permissions for AgentCore to call C3 tools (resource-based policy on Tool Gateway)

#### Phase 4 — Helm charts (if Kubernetes-based)
- [ ] Helm chart per service (C1, C2, C3, Control Plane)
- [ ] values.yaml per environment (dev / staging / prod)
- [ ] ConfigMaps for non-secret config (agent.yaml, domain.yaml)
- [ ] Secrets managed via External Secrets Operator (pulls from AWS Secrets Manager)
- [ ] Liveness + readiness probes per service
- [ ] Resource limits (CPU/memory) per service
- [ ] Horizontal Pod Autoscaler for C2 (handles burst load)

#### Phase 5 — Compliance controls
- [ ] Encryption at rest: all RDS, ElastiCache, S3, EBS volumes — KMS-encrypted
- [ ] Encryption in transit: TLS 1.2+ enforced on all service-to-service calls
- [ ] VPC-only: no public IPs on any data plane service
- [ ] CloudTrail: all API calls logged, log files integrity-validated
- [ ] AWS Config rules: enforce encryption, VPC placement, IMDSv2
- [ ] Secrets rotation: Secrets Manager auto-rotation for DB credentials and API keys
- [ ] HIPAA BAA: ensure AWS services used are HIPAA-eligible (RDS, ElastiCache, Bedrock, AgentCore — all eligible)

#### Phase 6 — CI/CD pipeline
- [ ] GitHub Actions / CodePipeline: build → test → push image → deploy to staging → promote to prod
- [ ] Terraform state in S3 + DynamoDB lock (shared, versioned)
- [ ] Helm release management (track what version of each chart is deployed where)
- [ ] Rollback procedure documented and tested

#### Open questions to resolve before starting
- AgentCore vs self-managed Kubernetes — which compute model for C2/C3?
- Single Terraform root module vs per-service modules?
- How does C1 get deployed in customer account — separate Terraform run in customer account, or shared module?
- Versioning strategy: do all services version together (monorepo release) or independently?

---

## Where every item lives

| Item | Home |
|---|---|
| Agent Factory UI, Agent Registry UI, Prompt Governance | `platform-tools/agent-factory-ui/` |
| Support API (scaffold, workspace, registry) | `platform-tools/agent-factory-support-api/` |
| Agent runtime (planner, executor, responder, memory, RAG, HITL) | `templates/agent-runtime-template/` → copied to `agents/<cap>/<agent>/` |
| platform-core shared library (10L) | `platform-core/` — imported by all agent runtimes |
| Guardrails (10m) | `platform-core/` layer, zero agent code touch |
| HITL adapters | `platform-core/` adapter, selected by `agent.yaml` |
| Tool Gateway | `shared-infra/industry-tool-gateway-<industry>/` — shared across all agents |
| New capability | new folder in `capabilities/` + agent shell in `agents/` |
| New industry | new folder in `shared-infra/` |
| domain.yaml (scope definitions) | `capabilities/<cap>/domain.yaml` — copied into agent at scaffold |
| agent.yaml (agent behavior config) | `agents/<cap>/<agent>/overlays/<type>/config/agent.yaml` |

---

## Active / Next Up

1. **Agent Registry UI** ✅ — fully built. Workspaces page has Restart + Stop buttons. Agent Registry, Prompt Governance all built.

2. **Summary Agent** ✅ — built. `summary_agent` overlay exists, `SummaryPanel` component built, used in AssessmentView and CaseView.

3. **Live Agent Flow Diagram in Overview tab** 🔲 — as admin configures RAG, HITL, Memory tabs in Agent Registry, the Overview tab shows a live visual flow diagram that updates dynamically to reflect the current config. Examples: enable pre-graph RAG → RAG step appears before graph in diagram; disable HITL → approval branch disappears from executor; turn off episodic memory → post-graph write shows only short-term. Diagram is a React component (ReactFlow) reading the same config state already loaded in the UI — no new API calls needed. Each tab change updates the diagram in real time. Purpose: admin sees exactly what will happen on the next message given current config, without reading YAML.

3h. **Create Agent form — minimal wizard (option 4)** 🔲 — replace the current 740-line single-scroll form with a 3-field scaffold step + post-scaffold redirect to Agent Registry for all configuration.

   **Step 1 — scaffold (3 fields only):**
   - Agent name
   - Capability (dropdown from filesystem capabilities)
   - Agent type (dropdown: chat_agent, summarization_agent, etc.)
   - → Submit → scaffold files + auto-register → redirect to Agent Registry for the new agent

   **Why:** Agent Registry already has all the config tabs (Memory, HITL, RAG, Tools). Duplicating those controls in the create form creates two places to maintain. Create form should only do what Registry can't — pick the name and type before the files exist.

   **What moves out of the create form:**
   - Memory toggles → Agent Registry Memory tab
   - HITL config → Agent Registry HITL tab
   - RAG config → Agent Registry RAG tab
   - Tool allowlist → Agent Registry Tools tab

   **After scaffold:** support API scaffolds overlay files + writes to `usecase_registry.json` → agent immediately appears in Agent Registry → admin lands on the new agent's Overview tab to configure.

3g. **Agent Config Comparison Grid** 🔲 — a dedicated view in Agent Registry for the same agent (same usecase + capability) showing all config snapshots as rows and every config parameter + performance metric as columns. Scoped to one agent at a time — not cross-agent comparison.

   **Grid structure:**
   - Rows = config snapshots (auto-saved each time agent config is changed via UI, with timestamp)
   - Columns grouped by subsection: RAG (pre_graph + planner_tool, all 3 dimensions each), Memory (all 4 types with all options), HITL (level, adapter), Tools (enabled list), Performance (pre-graph ms, planner ms, tool ms, responder ms, total ms, total tokens, cost/run)
   - First column (config name + timestamp) frozen
   - Changed cells highlighted vs previous row — instantly see what changed and what effect it had
   - Performance metrics come from actual run traces — not estimates

   **Why per-agent, same usecase:** baseline is controlled. The only variable is the config change. Useful for care management specifically — nurses are time-pressured, a 200ms latency difference matters, and cost at scale (50 nurses × 100 queries/day) is visible before it becomes a problem.

   **Detail to refine later:** exact column set, snapshot trigger rules, metric aggregation (P50/P95 vs last N runs), UI layout.

   **Tooling note — not available OOTB anywhere:**
   - **MLflow / Databricks** — experiment tracking with param + metric comparison, but built for ML training runs. Knows nothing about RAG dimensions, memory types, or reasoning strategies. Would require manually logging every config param as a metric — comparison UI is generic, not tailored.
   - **LangSmith** — per-run traces with latency + token breakdown per step. No config snapshot concept, no config comparison grid.
   - **Langfuse** — open source LLM observability, has an "experiments" feature but it is prompt-focused (compare prompt A vs prompt B), not agent config.
   - **W&B, Arize, Helicone** — aggregate dashboards and monitoring, not per-config comparison.
   - **Common gap in all:** none understand our config model (agent.yaml, RAG dimensions, memory types). The config parameter columns can only come from us.
   - **Right approach:** use LangSmith or Langfuse for raw trace + cost + latency data (they are good at that). Build the config comparison grid ourselves — reads config snapshots from our store, pulls metrics from the trace integration. Best of both.

3f. **Agent Registry UI — Routing tab (config-driven hard routes)** 🔲 — new Routing tab in Agent Registry UI per agent. Allows admin to define deterministic keyword-based routes without touching code. Replaces the hardcoded `HARD_ROUTE` block in `llm_planner.py` which today is care management specific.

   **What hard routes do:**
   Before the LLM planner runs, the platform checks if the user's message matches any configured phrase list. If it matches → call the mapped tool directly, skip the LLM planner call entirely. If no match → fall through to LLM path as normal. Benefit: speed (no extra LLM call) + cost (saves planner LLM call for deterministic queries).

   **UI — Routing tab:**
   ```
   Agent: Pre-Call Assessment                [Routing tab]
   ─────────────────────────────────────────────────────
   Hard Routes                                   [+ Add]

   Phrases: summarize, summary, status, risk
   Scope:   assessment
   Tool:    get_assessment_summary                  [✕]

   Phrases: tasks, open tasks, pending tasks
   Scope:   assessment
   Tool:    get_assessment_tasks                    [✕]
   ```
   - Scope dropdown — populated from `domain.yaml` active scopes
   - Tool dropdown — populated from Tool Gateway registry for this capability
   - No new API sources needed — both already available in UI

   **Config written to agent.yaml:**
   ```yaml
   hard_routes:
     - phrases: ["summarize", "summary", "status", "risk"]
       scope: assessment
       tool: get_assessment_summary
     - phrases: ["tasks", "open tasks", "pending tasks"]
       scope: assessment
       tool: get_assessment_tasks
   ```

   **Planner reads `hard_routes` from agent.yaml at runtime — zero care management knowledge in planner code.** Each capability defines its own phrases and tools. Claims agent, HR agent, finance agent all use the same planner with different route configs.

   **Full config flow:**
   Admin adds route in UI → Support API writes to agent.yaml → planner reads hard_routes at runtime → match = skip LLM, no match = LLM path.

   **What needs to change:**
   - `llm_planner.py` — remove hardcoded phrase lists and HARD_ROUTE block, replace with config reader that loads `hard_routes` from agent.yaml and runs same matching logic
   - Agent Registry UI — add Routing tab with add/edit/delete route UI
   - Support API — add route to read/write `hard_routes` block in agent.yaml
   - agent.yaml schema — add `hard_routes` as a validated optional field

3f-a. **Hard route — multi-match handling** 🔲 — today hard route is single match only: one phrase list → one tool → skip LLM. When multiple routes match the same input, behavior is undefined.

   **Two cases to handle:**
   - **Multiple read/context tools match** → execute all in parallel pre-graph, merge results into context. No LLM needed.
   - **Multiple action/ambiguous tools match** → pass all matched tools as candidates to LLM in-graph. LLM decides which to call.

   **What needs to change:**
   - `llm_planner.py` hard route logic — collect all matches instead of returning on first match
   - Classify each matched tool as `read` vs `write/action` (from tool metadata)
   - Read matches → execute pre-graph, inject into context
   - Action matches → pass candidate list into in-graph LLM call

3d. **Agent capability matrix — config options per agent type** 🔲 — not all agents should see all configuration options. Today the Agent Registry UI and Agent Factory create form show all options regardless of agent type. Need to enforce which capabilities are available, locked, or hidden per agent type.

   **Capability matrix (what each agent type supports):**

   | Config Option | chat_agent | summary_agent | workflow_agent (future) |
   |---|---|---|---|
   | RAG — Dimension 1 strategy | ✅ | ✅ reads only | ✅ |
   | RAG — Dimension 2 pre-graph | ✅ | ✗ no conversation | TBD |
   | RAG — Dimension 2 planner tool | ✅ | ✗ fixed tools | TBD |
   | RAG — Dimension 3 pattern | ✅ | ✗ | TBD |
   | HITL | ✅ | ✗ read-only agent | per sub-agent |
   | Memory write | ✅ | ✗ locked off | per sub-agent |
   | Memory read | ✅ | ✅ | ✅ |
   | Planner mode | ✅ | ✗ no planner | ✅ |
   | Context scopes | ✅ | ✅ | ✅ |

   **What needs to change:**
   - Each agent type declares supported capabilities in a capability manifest
   - Agent Registry UI reads manifest — shows only relevant tabs and options per agent type
   - Agent Factory create form filters options based on selected agent type
   - Platform validates at startup — warns if unsupported config is set for an agent type (e.g. `hitl: true` in summary_agent)

3e. **Generic test UI + capability-specific application UI separation** 🔲 — two problems today:

   **Problem 1 — No generic standalone test UI:**
   Today testing a new agent requires the full care management nurse UI — domain-specific pages that don't apply to other capabilities. A developer building a new capability has no way to test their agent standalone without building a full UI first.

   **Fix — Generic test UI driven by context scopes:**
   A simple chat interface included in every generated repo. On load it fetches `/config/scopes` from the agent runtime → renders ID input fields dynamically based on whatever scopes are defined in `domain.yaml`. Developer fills in test IDs, starts chatting, agent operates with full scope context.

   ```
   Care management:          Claims:
   [ member_id     ] ___     [ policy_id ] ___
   [ case_id       ] ___     [ claim_id  ] ___
   [ assessment_id ] ___
   [ Start Chat ]            [ Start Chat ]
   ```

   No hardcoding — fields driven entirely by `domain.yaml`. Works for any capability out of the box.

   **Problem 2 — Care management UI lives in generated repo, not template:**
   The nurse-facing application UI (members, cases, assessments pages) lives in `cm-hero-fl-app` — the generated repo for the care management use case. If that repo is deleted, the UI is gone. Other capabilities incorrectly inherit care management pages when scaffolded.

   **Fix — UI layer separation:**
   ```
   templates/
     capability-ui-template/     ← generic test UI only (scope-driven chat, no domain pages)

   capabilities/
     care-management/
       ui/                       ← care management application UI lives HERE
         members/, cases/, assessments/ pages

   generated-repos/
     care-management/
       cm-hero-fl-app/           ← generated repo references capability UI, does not own it
   ```

   Care management UI moves to the capability layer — owned by the capability, not the generated repo. New capabilities build their own UI in their capability folder. Generated repos are thin — they wire everything together but don't own domain UI code.

   **Application UI contract — what capability UI developers need to know:**
   The only integration requirement is: send the right scope IDs in the POST payload to `/invocations`. Agent handles everything else. UI developer doesn't need to know how the agent works internally — just which ID fields to send per page, derived from `domain.yaml`.

   **This is also the decoupling goal:**
   UI and agent are completely independent. UI can be rebuilt or redesigned without touching agent config. Agent config can change without touching UI. The scope ID payload is the only contract between them.

3a. **Scope-level memory control** 🔲 — today memory toggles (short-term, episodic, semantic, summary) apply globally to the entire agent. Every scope (member, case, assessment) shares the same on/off state.

   **The problem:**
   Different scopes have different memory needs. For example: you may want episodic memory at the assessment scope (track what happened in this assessment) but not at the member scope (too broad, too noisy). Or short-term at case level but not member level. Today there is no way to express this — it's all or nothing.

   **What needs to be built:**

   **1. Config — agent.yaml:**
   ```yaml
   memory:
     scopes:
       member:
         short_term: true
         episodic: false
         summary: true
         semantic: false
       case:
         short_term: true
         episodic: true
         summary: true
         semantic: false
       assessment:
         short_term: true
         episodic: true
         summary: true
         semantic: true
   ```
   Falls back to global policy if scope-level not defined.

   **2. Runtime — memory policy resolution:**
   `LangGraphRunner` already resolves `active_scopes` from `domain.yaml`. Extend `memory_policy_state` to be a dict keyed by scope type instead of flat booleans. Write and read engines check per-scope policy before writing.

   **3. Agent Registry UI — Memory tab:**
   Instead of 4 global toggles, render one row per scope (read dynamically from `/config/scopes`). Each row has the same 4 toggles. Works for any capability — no hardcoding. Applies to all reasoning strategies.

   **4. Post-graph Memory Panel in UI:**
   Currently shows 3 memory types. After this change, shows per-scope breakdown — e.g. "member: short-term ✅ episodic ✗" and "assessment: all ✅". Gives nurse/admin visibility into what was written where.

   **Applies to:** all agent types (chat, summarization, workflow, multi-agent) and all reasoning strategies — the memory write layer is below the reasoning layer.

   **Priority note:** tackle this before adding new capabilities — once there are multiple agents with different domain.yaml scopes, retrofitting scope-level memory becomes much harder.

3b. **Case/Member chat 3-column layout** 🔲 — CaseView and MemberProfile have `InlineChatPanel` ✅ but missing `TraceGraph` + full `MemoryPanel`. AssessmentView has the full 3-column layout — needs to be replicated in CaseView and MemberProfile.

3c. **Chat history — fetch from thread memory store** 🔲 — today `InlineChatPanel` stores displayed messages in `localStorage` (per `chat-messages:type:id` key) so the nurse sees previous messages when navigating back. Proper fix: expose a `GET /thread/{thread_id}/messages` endpoint that reads the short-term memory store (the same store the agent writes to each turn) and returns formatted messages for the UI to render on mount. Removes the localStorage duplication and makes history correct across devices and browser sessions.

---

## Platform Capabilities — Backlog

4. **Tool Gateway Admin UI** ✅ — built. Tool Registry (add/edit/delete, mode, tags, endpoint, schema, enable toggle) and Knowledge Base (document ingestion, chunk management, delete docs) both live at `shared-infra/industry-tool-gateway-healthcare/services/tool-admin-ui/` on port 5200.

4a. **Tool Gateway — Bucket hierarchy + agent assignment** 🔲 — the tag filtering layer on top of the existing flat tag list. Two parts:

   **Bucket hierarchy (Tool Admin UI):**
   - Admin defines named buckets that map to tag combinations — e.g. `Healthcare → Care Management → Florida` maps to `["healthcare", "care_management", "florida"]`
   - Hierarchy is flexible and runtime-defined — not hardcoded. Any shape: industry → LOB → region, or region → product → function
   - UI: bucket editor with parent/child relationship and tag mapping per node
   - Saves to gateway config — no code changes needed to add a new region or LOB

   **Agent bucket assignment (Agent Registry UI):**
   - Agent is assigned to one or more buckets in Agent Registry
   - At query time, tool schema passed to LLM is filtered to tools whose tags match the assigned bucket(s)
   - Florida care management agent never sees Texas Medicaid tools
   - UI: bucket multi-select dropdown in Agent Registry (populated from bucket hierarchy config)

   **What's in the data today:** tags already exist as a flat list on each ToolSpec (e.g. `["healthcare", "care_management", "florida", "member"]`). Bucket config layer and agent assignment are the only missing pieces.

   **When to build:** low priority until there are 2+ agents across different regions/LOBs. With one agent today, tag filtering is manual and sufficient.

5. **Prompt Management & Evaluation module** 🔲 — manage prompt templates (prompt-defaults.yaml), A/B test prompt variants, evaluate outputs against test cases, track prompt version history. Add to Agent Factory UI.

5b. **Config Lab — multi-agent selector** 🔲 — Config Lab currently hardcoded to `care-management / pre-call-assessment / chat_agent_simple`. Add an agent dropdown at the top that loads from the registry so any registered agent can be selected. Scenarios stored per-agent in localStorage. Needed once a second agent is added.

6. **Memory Pruning** 🔲 — automatic cleanup of stale/irrelevant memory entries. Strategies: TTL-based expiry, relevance scoring, max-size eviction per scope. Prevent memory bloat over long sessions.

6b. **Intelligent Memory Retrieval** 🔲 — today platform always retrieves all enabled memory types on every turn. Real world: episodic, semantic, and summary retrieval should be conditional — rule-based pre-filter (e.g. only search episodic if case_id present) + optional LLM decision for ambiguous cases ("does this query need past case history?"). Same decision problem as tool calling but at the memory layer.

   **Two-tier design:**
   - **Tier 1 — rule-based, pre-planner (no LLM cost):** condition options per memory type: `always | scope_present | never`. Runs in `context_builder.py` before planner. Fast, deterministic.
   - **Tier 2 — LLM-driven, planner tool:** condition `query_relevant`. Memory type exposed as a tool (`fetch_episodic_memory`, `fetch_semantic_facts`, `fetch_summary`). Planner sees a hint in system prompt and decides whether to call it based on the query.

   **Design gaps to resolve before building:**

   1. **`scope_present` needs scope ID reference** — Tier 1 condition `scope_present` must know which scope ID to check (e.g. episodic → `case_id`, summary → `assessment_id`). Requires reading domain.yaml scope hierarchy — not hardcoded. Dependency on scope_resolver.

   2. **Tier 1 → Tier 2 interaction** — if Tier 1 already fetched a memory type (scope_present fired), Tier 2 must NOT expose the fetch tool for that same type — redundant and wasteful. Rule: Tier 1 fetch suppresses Tier 2 tool registration for that memory type in the same turn.

   3. **Tier 2 result injection** — when planner calls `fetch_episodic_memory`, result must be injected back into LLM context for the responder (not just stored as a tool output in the message list). Needs a dedicated injection mechanism — different from regular tool call results.

   4. **`fetch_summary` is scope-based, not query-based** — summary is a pre-generated document, not semantically searched. `fetch_summary` = "get latest summary for this scope." Tier 2 condition `query_relevant` still applies (planner decides IF to fetch) but the fetch itself is a simple scope lookup, not a vector search.

   5. **Config shape not complete** — `memory.yaml` config block needs `intelligent_retrieval.condition` per memory type. Example:
      ```yaml
      memory:
        episodic:
          intelligent_retrieval:
            enabled: true
            condition: scope_present   # Tier 1 — which scope ID from domain.yaml
            scope: case                # maps to case_id in domain.yaml
        semantic:
          intelligent_retrieval:
            enabled: true
            condition: query_relevant  # Tier 2 — planner decides
        summary:
          intelligent_retrieval:
            enabled: true
            condition: scope_present   # Tier 1
            scope: assessment          # maps to assessment_id in domain.yaml
      ```

6d. **workflow_agent — per-step memory configuration** 🔲 — different workflow steps may need different memory types (e.g. step 1 needs episodic off, step 2 needs semantic on). Agent Registry Memory tab can only configure agent-level defaults — it has no knowledge of workflow steps. Per-step memory config requires a workflow builder UI (each step node has its own memory config panel). Until then: agent-level defaults via Memory tab, per-step overrides via `workflow.yaml` directly (developer edits). Known limitation — revisit when workflow builder is built.

6c. **Memory Read/Write Split** 🔲 — today memory is a single on/off flag controlling both read and write together. Need to separate into independent controls:
   - `memory.read.enabled` — can the agent retrieve from episodic/semantic/summary memory
   - `memory.write.enabled` / `memory.write.locked` — can the agent write to memory (lockable at agent level)
   - Use case: summary_agent should read episodic/semantic (optional enrichment) but NEVER write — write must be locked off, not just disabled
   - Config shape:
     ```yaml
     memory:
       read:
         enabled: true
         scopes: [episodic, semantic]
       write:
         enabled: false
         locked: true   # admin cannot override
     ```
   - Also needed in Agent Registry UI — Memory tab should show read/write as separate toggles, write toggle should show lock icon when locked

   **Memory capability matrix — config options per memory type:**

   | Config | Short-term | Episodic | Semantic | Summary |
   |---|---|---|---|---|
   | Read enabled | ✅ | ✅ | ✅ | ✅ |
   | Write enabled | ✅ | ✅ | ✅ | ✅ |
   | Write locked | ✗ — always writes | ✅ e.g. lock for summary_agent | ✅ | ✅ |
   | Pruning | TTL + session count — only applies when persistent backend enabled; irrelevant if backend: memory | TTL + relevance scoring | Relevance scoring | TTL |
   | Backend adapter | memory (default, session-scoped) / SQLite / PostgreSQL (LangGraph checkpointer — enables true resume by thread_id) | File / S3 / DynamoDB | pgvector | File / S3 |
   | Semantic vector retrieval | ✗ — recency based | ✗ — scope based | ✅ — vector similarity | ✗ |
   | Intelligent retrieval — Tier 1 (rule-based, pre-planner) | `always` — fixed, always loaded | `always \| scope_present \| never` | `always \| scope_present \| never` | `always \| scope_present \| never` |
   | Intelligent retrieval — Tier 2 (LLM-driven planner tool) | ✗ — not applicable | ✅ `query_relevant` — exposed as `fetch_episodic_memory` tool | ✅ `query_relevant` — exposed as `fetch_semantic_facts` tool | ✅ `query_relevant` — exposed as `fetch_summary` tool |

   **Write triggers per memory type (what causes a write to happen):**

   | Memory Type | Trigger | Configurable? | Notes |
   |---|---|---|---|
   | Short-term | Every turn — post-final-response always. Mid-loop (ReAct/multi_hop) if `write_intermediate_steps: true` | `write_intermediate_steps` toggle only | Automatic. No trigger config needed beyond the toggle. |
   | Episodic | Event-driven — tool call completes (HITL or direct), turn completes | Which tools trigger via `write_on_tool_call.tools` | Automatic. The event IS the trigger. No threshold config. |
   | Semantic | Post-final-response — after every turn, LLM extracts facts from the exchange | Extraction model + dedup threshold only | Automatic. Trigger is not configurable — runs every turn if write enabled. Config controls HOW not WHEN. |
   | Summary | Threshold-driven — not event-driven | `trigger: explicit \| turn_count \| token_threshold \| never` + threshold values | Only memory type with configurable trigger. Different usecases need different strategies. |

   **Semantic write — how the system knows what is a fact:**
   Not keyword rules (today's broken approach — 3 hardcoded phrases in `semantic_engine.py`). Replaced with an LLM call using a cheap model (Claude Haiku):
   > "Extract any persistent facts about the member or user from this conversation. Facts are things that remain true beyond this session — preferences, barriers, medical context, behavioral patterns. Return structured JSON."
   The LLM decides what is a fact. Platform writes what comes back. No Dim 3 patterns involved — Dim 3 is KB retrieval only. Semantic write is: LLM extracts → dedup check → write to store.

   **Summary write trigger modes:**
   - `explicit` — nurse/admin clicks "Generate Summary" in UI. Today's only behavior.
   - `turn_count` — platform auto-invokes summary_agent every N turns. Requires post-graph hook in app.py. Not yet built.
   - `token_threshold` — platform auto-invokes when short-term memory exceeds N tokens. Requires post-graph hook in app.py. Not yet built.
   - `never` — summary disabled for this usecase.

   **Agent type × memory type + intelligent retrieval matrix:**

   | Memory Type | chat_agent | summary_agent | workflow_agent |
   |---|---|---|---|
   | Short-term | ✅ R/W — conversational history | ✗ — no conversation loop | ✗ — no conversation loop |
   | Episodic | ✅ R/W — Tier 1: scope_present / Tier 2: query_relevant ✅ | ✅ read only — Tier 1 only (scope_present). Tier 2 ✗ — no planner | ✅ write only — Tier 1 only (scope_present). Tier 2 ✗ — executes steps, no query loop |
   | Semantic | ✅ R/W — Tier 1: always / Tier 2: query_relevant ✅ | ✅ read only — Tier 1 only (always or scope_present). Tier 2 ✗ — no planner | ✅ read only — Tier 1 only (always). Tier 2 ✗ |
   | Summary | ✅ read only — Tier 1: scope_present / Tier 2: query_relevant ✅ | ✅ write only — Tier 2 ✗ (no read) | ✅ read only — Tier 1 only (scope_present). Tier 2 ✗ |

   **Key rule: Tier 2 (LLM-driven) is only available to agents with an interactive planner loop — today that is `chat_agent` only. `summary_agent` and `workflow_agent` have no query loop so Tier 2 is locked off.**

   Agent type determines: (1) which memory types appear in Agent Registry UI at all, (2) which R/W options are locked vs configurable, (3) which intelligent retrieval tiers are available. New agent types extend this matrix — zero platform code changes, just matrix config.

   **Each memory type has its own separate store — they are NOT shared:**

   | Memory Type | Current store | Lifetime | Future backends |
   |---|---|---|---|
   | Short-term | LangGraph state (in-memory) | Session only by default. Persistent by thread_id when backend = SQLite / PostgreSQL (LangGraph checkpointer) — enables true nurse resume. Pruning: TTL (e.g. 4 weeks) + session count (e.g. last 4 sessions), whichever hits first. | SQLite, PostgreSQL (LangGraph checkpointer) |
   | Episodic | File (JSON per scope) | Persistent across sessions | S3, DynamoDB |
   | Semantic | File (JSON per scope) | Persistent across sessions | pgvector |
   | Summary | File (JSON per scope) | Persistent across sessions | S3 |

   Backend config in `memory.yaml` is per memory type — each type can point to a different backend independently.

   **All memory config is per memory type, fully independent. Full config shape (memory.yaml):**
   ```yaml
   memory:
     short_term:
       read: true
       write: true
       backend: memory          # memory (default) | sqlite | postgres
       max_turns: 20            # max turns kept in active session
       pruning:                 # only applies when backend: sqlite | postgres
         ttl_days: 28           # delete threads older than 4 weeks
         max_sessions: 4        # keep only last N sessions per thread_id

     episodic:
       read: true
       write: true
       write_locked: false
       backend: file          # file | s3 | dynamodb | redis
       pruning:
         ttl_days: 30
         max_entries: 100
       intelligent_retrieval:
         enabled: false
         condition: scope_present   # only retrieve if case_id in ctx

     semantic:
       read: true
       write: true
       write_locked: false
       backend: file
       retrieval: vector            # scope | vector
       top_k: 5
       threshold: 0.6
       pruning:
         relevance_threshold: 0.4

     summary:
       read: true
       write: false
       write_locked: true           # summary_agent writes, chat_agent never writes
       backend: file
       pruning:
         ttl_days: 7
   ```

   **UI — all memory config in Agent Registry → Memory tab, per memory type. Filtered by agent type capability matrix (e.g. summary_agent cannot enable write for episodic/semantic).**

6e. **Semantic memory write — LLM-based extraction** 🔲 — today `semantic_engine.py` is 3 hardcoded keyword rules. This breaks for any real conversation and any new domain. Replace with a single LLM call using a cheap model (Claude Haiku):
   > "Extract any persistent facts about the member or user from this conversation. Facts are things that remain true beyond this session — preferences, barriers, medical context, behavioral patterns. Return structured JSON."
   The LLM decides what is a fact. Platform writes what comes back. **No Dim 3 patterns involved — Dim 3 is KB retrieval only.**
   - Write pipeline: LLM extracts facts → dedup check (6f) → write new / update existing
   - Trigger: post-final-response, every turn, automatic — not configurable
   - Config shape:
     ```yaml
     memory:
       semantic:
         write:
           enabled: true
           extraction:
             model: claude-haiku-4-5     # cheap model for extraction
     ```

6f. **Semantic write deduplication** 🔲 — today the same fact (e.g. "member prefers Spanish") extracted on turn 3 and turn 7 both get written as separate entries. At scale: duplicate facts bloat the semantic store and confuse the LLM when multiple conflicting versions of the same fact are retrieved. Fix:
   - Before writing a new fact, query existing semantic memories for this scope (vector search if 10h is built, scope scan otherwise)
   - If a semantically similar fact already exists (cosine similarity > threshold), update in place rather than append
   - Config: `memory.semantic.write.dedup_threshold: 0.85`
   - **Dependency:** 10h (semantic vector retrieval) makes dedup accurate. Without it, dedup is string-match only — imprecise but still better than nothing.

6g. **Write scope enforcement from domain.yaml** 🔲 — `write_episodic_event` in `write_engine.py` hardcodes `{"case", "assessment"}` as the only scopes that receive episodic writes. Any new scope added to `domain.yaml` (e.g. `authorization`, `claim`, `encounter`) is silently ignored at write time. Fix: read writeable scopes from `domain.yaml` at runtime — same pattern as `scope_resolver.py` already does for read. No hardcoded scope names anywhere in the write path.

6h. **Write locked — runtime enforcement** 🔲 — `write_locked: true` is defined in `memory.yaml` config shape (item 6c) but never actually read at runtime. Any agent can call `write_engine.py` functions regardless of config. Fix: `write_engine.py` must check `memory.<type>.write_locked` before each write and raise a hard error (not silent skip) if locked. Also enforce in `memory_writer.py` (HITL path). This is the guarantee that `summary_agent` cannot accidentally write episodic/semantic facts even if called incorrectly.

6i. **Write conditioned on HITL outcome** 🔲 — today `write_hitl_requested` and `write_hitl_decision` always write episodic events regardless of approval outcome. A rejected tool call still produces an episodic memory saying "HITL approved." More critically: the tool result should only be written to episodic AFTER a successful approval + execution, not at request time. Fix:
   - `write_hitl_requested` → keep, this is useful audit trail
   - `write_hitl_decision` with `decision=rejected` → write rejection event only, no tool result
   - `write_hitl_tool_executed` → only called after confirmed execution — this is already correct
   - Add: post-execution episodic write that summarizes the actual outcome (what changed in the system of record), not just the mechanics of the HITL flow

6j. **Write audit metadata** 🔲 — today no write stamps `agent_id`, `agent_type`, or `reasoning_strategy` on the entry metadata. In production with multiple agents writing to the same member/case scope, there is no way to know which agent wrote what. Fix: add to all write calls:
   ```python
   metadata={
       "agent_id": ctx.get("agent_id"),
       "agent_type": ctx.get("agent_type"),        # chat_agent | summary_agent | workflow_agent
       "reasoning_strategy": ctx.get("reasoning_strategy"),  # react | simple | plan_execute
       "turn_id": ctx.get("turn_id"),
       ...existing fields...
   }
   ```
   Required in: `write_raw_turns`, `write_episodic_event`, `write_semantic_memories`, `write_hitl_*`. Context must carry these fields from `app.py` through the full lifecycle.

6k. **Direct tool call episodic write** 🔲 — today only HITL tool calls produce episodic memory entries (`memory_writer.py`). Non-HITL tool calls (e.g. `get_member`, `search_kb`) are completely invisible to episodic memory. A nurse asking "what is the member's risk score?" produces no episodic trace. Fix: after executor runs any tool (HITL or not), write a lightweight episodic event with tool name, key inputs, and result summary. Config-driven — agent.yaml controls which tools produce episodic writes:
   ```yaml
   memory:
     episodic:
       write_on_tool_call:
         enabled: true
         tools: [write_case_note, update_care_plan]    # explicit list, or "all", or "write_only"
   ```
   Default: `write_only` — only write-class tools produce episodic entries. Read-only tools (get_member, search_kb) do not.

6l. **Short-term write: intermediate steps config** 🔲 — for `react` and `multi_hop` strategies, each loop iteration produces thought + tool call + observation. Today only the final user/assistant message pair is written to short-term memory (`write_raw_turns`). The intermediate steps are visible in the LangGraph trace but not in memory. For auditability and next-turn context, intermediate steps may need to be written. Config:
   ```yaml
   memory:
     short_term:
       write_intermediate_steps: false    # default false — only final user/assistant turns written
                                          # true: write each thought/action/observation as short-term entries
   ```
   **Why short-term only:** intermediate steps are conversational/session-scoped — they belong to this thread. Episodic gets the final outcome. Semantic gets extracted facts. Neither needs raw thinking steps.
   **Dependency:** applies to both `react` and `multi_hop`. ReAct is built — implement this now. `multi_hop` is not yet built — **re-apply this same config and wiring when multi_hop reasoning is implemented (backlog 10n)**. Do not build multi_hop without also wiring intermediate step writes.
   **In-graph:** must be wired inside the executor loop, not post-graph in app.py — by post-graph the per-iteration context is gone.

6m. **Summary write trigger config** 🔲 — today there is no defined trigger for when a summary gets written. The `summary_agent` exists as a separate agent overlay but its invocation trigger is undefined at the platform level. Fix: define trigger config per summary type:
   ```yaml
   memory:
     summary:
       write:
         trigger: turn_count           # turn_count | token_threshold | explicit | never
         turn_count_threshold: 20      # write summary every N turns (turn_count mode)
         token_threshold: 8000         # write summary when short-term exceeds N tokens (token_threshold mode)
   ```
   - `turn_count` — platform invokes summary_agent after N turns automatically
   - `token_threshold` — platform invokes summary_agent when short-term memory exceeds token budget
   - `explicit` — only invoked when nurse/admin explicitly requests a summary (today's behavior)
   - `never` — summary agent disabled for this usecase
   **Missing today:** platform has no auto-invocation logic. Summary is only triggered by explicit UI button. `turn_count` and `token_threshold` modes need platform-level hooks in `app.py` post-graph lifecycle.

6n. **Write size limits** 🔲 — no max token/character limit per memory entry before write. A single tool result (e.g. full care plan returned by `get_care_plan`) written as episodic content can be thousands of tokens. At retrieval time, one oversized entry consumes the entire context budget. Fix: enforce max content length at write time with truncation strategy:
   ```yaml
   memory:
     episodic:
       write:
         max_content_tokens: 500       # truncate content at write, not retrieval
         truncation: tail              # head | tail | smart (LLM summarizes to fit)
     semantic:
       write:
         max_content_tokens: 200
   ```
   `smart` truncation = LLM call to compress the content to fit within budget. Expensive but preserves meaning. Default: `tail` (fast, cheap).

   > **Full memory write design:** `docs/design/memory-write-design.md` — complete reference covering all phases (write gate, triggers, per-type config, audit metadata, reasoning strategy × write matrix, agent type matrix, admin UI configurability). Read this before implementing any of 6c–6n.

6o. **Admin UI — Memory R/W config in Agent Registry + Agent Factory** 🔲 — Agent Registry Memory tab and Agent Factory create form both lack controls for the new read/write split and write policy fields implemented in 6c–6n. Missing UI controls:

   **Agent Registry → Memory tab (per memory type):**
   - Read toggle (independent from write toggle) — separate `read_policies.<type>.enabled` on/off
   - Write toggle — `write_policies.<type>.enabled` on/off
   - Write locked indicator — grayed-out lock icon (read-only display, set by platform based on agent type, not editable by admin)
   - Backend dropdown — `file | s3 | dynamodb | pgvector | redis` (drives `backend_factory.py` selection)
   - `write_on_tool_call` toggle + tools dropdown — `write_only | all | [explicit list]` (episodic only). When `write_only` is selected, the dropdown shows only tools that are: (a) in this agent's `allowed_tools` list AND (b) marked `mode: write` in Tool Gateway. This gives the admin visibility into exactly which write tools are active for this agent without leaving the Memory tab.
   - `write_intermediate_steps` toggle — on/off (short-term only, ReAct/multi_hop)
   - Dedup toggle — on/off (semantic only)
   - Summary trigger dropdown — `explicit | turn_count | token_threshold | never` with threshold input fields
   - Write size limits — `max_content_tokens` number input + truncation strategy dropdown `head | tail | smart`

   **Agent Factory → create form (new agent wizard):**
   - Same memory controls as Agent Registry (above) — admin should not need to manually edit YAML after scaffold
   - Controls should pre-populate from the agent type template defaults (e.g. chat_agent: summary `write_locked: true` pre-set)

   **`write_locked` display rule:** never editable by admin — the platform sets it based on agent type at registration. Show as lock icon with tooltip: "Set by platform based on agent type. Cannot be overridden."

6p. **Agent Factory — add `chat_agent_multi_hop` to overlay type dropdown** 🔲 — `ApplicationForm.tsx` agent type dropdown currently lists: `chat_agent_react`, `chat_agent_reflection`, `chat_agent_plan_execute`. `chat_agent_multi_hop` is missing. It is listed in `agent.yaml` strategy options and in the reasoning strategy matrix (backlog 10n) as `roadmap: true` — but it is not selectable when creating a new agent via UI. Fix: add `chat_agent_multi_hop` to the dropdown options. Mark as `(roadmap)` in the label so admins know the runtime is not yet built. Same pattern as other roadmap items in the UI.

   **Note:** Do not build the multi_hop runtime until backlog 10n is prioritized. This item is only the dropdown option — so admins can scaffold the config today and wire the runtime later.

6q. **Admin UI — HITL config gaps in Agent Registry + Agent Factory** 🔲 — HITL tab currently has: `approval_required`, per-tool `risk_levels`, `routing_rules`, `timeout`. Missing:

   **Agent Registry → HITL tab:**
   - Adapter dropdown — `internal | pega | servicenow | epic` (today only `internal` is built — others show as `(roadmap)` with a lock icon)
   - Dynamic risk scoring toggle — enables runtime scoring function instead of static `risk_levels`; when enabled, show config fields for scoring model and threshold
   - Parallel approvals toggle — fan-out mode on/off; when enabled, show max concurrent approvals field
   - Approval routing by role — table of `tool_type → approver_role` mappings (today only `supervisor` exists)
   - External system execution toggle — when enabled, show system target dropdown (`pega | servicenow | epic`) with a note that the adapter must be wired first

   **Agent Factory → create form:**
   - Same HITL fields (adapter dropdown + dynamic risk toggle) — pre-populated from agent type defaults
   - Today: no HITL config at all in create form — admin must go to Agent Registry after scaffold to configure HITL

   **Mark roadmap items clearly:** adapter options other than `internal`, dynamic risk scoring, parallel approvals, and external execution should display with `(roadmap)` labels and be non-interactive until runtime support exists.

7. **Context Engineering** 🔲 — systematic control over what goes into the LLM context window. Token budgeting per context type (memory, tools, history, retrieved docs), priority-based truncation, context quality scoring. Today short-term memory fetches N turns with no token awareness — N turns of large tool outputs can overflow the window silently.

8. **Context Graph** 🔲 — graph-based representation of context relationships. Entities, relationships, and context items as nodes/edges. Enables richer retrieval and reasoning over structured context rather than flat text chunks.

9. **LLM Ops** 🔲 — operational tooling for LLM usage in production. Cost tracking per agent/usecase, token usage dashboards, latency monitoring, model swap A/B testing, error rate and retry tracking.

10. **HITL — Production-grade approval patterns** 🔲 — evolve current tool-level HITL toward enterprise-ready patterns:
   - **Dynamic risk scoring** — replace static `risk_levels` in agent.yaml with runtime scoring function using tool + context + user role + member flags. Same tool gets different risk level per invocation.
   - **Content-aware routing via LLM classification** — keyword matching alone is insufficient for clinical content. "Medication" in "patient has no current medications" vs "adding new medication: Warfarin 5mg" carry completely different risk levels. The right approach: lightweight LLM classification call on tool arguments before the risk decision, combined with structured field rules (diagnosis code, dosage delta) and member context (risk score, comorbidities). One-time code investment — all rules then live in config/UI.
   - **Scenario-based rules** — move approval conditions into a business rules layer so business analysts can change rules without code.
   - **Parallel approvals** — LangGraph fan-out: submit multiple independent approval requests simultaneously, each resolves independently, fan-in when all complete. Today only sequential is supported.
   - **Approval routing by role** — different tools route to different approvers (care manager, medical director, comms team) based on tool type and context.
   - **External system execution** — after approval, execution moves outside the agent. Agent proposes, approval triggers Pega/ServiceNow/Epic to do the actual write. Agent never touches system of record directly.

10a. **C4 — Vector DB Container (customer VPC)** 🔲 — today the vector DB (KB / RAG data store) lives inside C3 on the provider side. For enterprise customers with PII or proprietary clinical data that cannot leave their environment, the vector DB must be deployable inside the customer's VPC as a separate container (C4).

   **Design:**
   - C4 is a standalone container: vector DB (pgvector or Chroma) + embedding service + ingest API
   - Deployable independently in customer VPC — no provider-side infrastructure required
   - C2 (RAG engine) calls C4 directly for retrieval — **C2 → C4, not C2 → C3 → C4**. C3 is not in the RAG retrieval path.
   - C3 remains provider-side for tool execution only
   - Customer controls their own KB: what gets indexed, data residency, access policy

   **RAG flow with C4:**
   Pre-graph: `C1 → C2 (RAG engine) → C4 (vector DB in customer VPC)` → chunks injected into context
   Planner tool: `C2 (executor) → C4` directly — same path

   **What needs to be built:**
   - C4 container definition: FastAPI ingest + query endpoints wrapping pgvector/Chroma
   - `agent.yaml` config: `retrieval.vector_db.endpoint` points to C4 URL instead of C3-internal KB
   - C2 RAG runner reads endpoint from config — no code change needed if config-driven
   - Docker compose profile for customer VPC deployment
   - Tool Admin UI (ingest/chunk management) exposed as part of C4 or via a lightweight admin page

   **Deployment options per customer:**
   - Option A: Provider manages C4 (no data residency concern) — C4 co-located with C2/C3 on provider AWS
   - Option B: Customer deploys C4 in their VPC — C2 calls C4 over VPC peering or private endpoint
   - Option C: Customer uses their own existing vector DB — C4 is just a thin adapter

10b. **Multi-KB routing for RAG** 🔲 — both RAG paths (pre-graph and planner tool) today hit a single KB. Need:
   - Query classification (rule-based or LLM) to select the right KB per query
   - Fan-out across multiple KBs in parallel, merge + re-rank results
   - Applies independently at both pre-graph and planner tool stages
   - Config shape TBD — possibly a `retrieval.kbs` list with tags/rules per KB

10c. **RAG Pattern implementations** ✅ — all 5 patterns built under `src/platform/rag/patterns/`. Any agent selects a pattern via `retrieval.pre_graph.pattern` or `retrieval.planner_tool.pattern` in agent.yaml — zero code touch. Patterns apply independently at both stages.
   - `naive.py` ✅ — single retrieve → use results as-is
   - `self_corrective.py` ✅ — retrieve → grade avg score → refine query with Claude Haiku if below QUALITY_BAR → re-retrieve
   - `multi_hop.py` ✅ — LLM decomposes query into sub-queries → retrieve per sub-query → deduplicate + merge → sort by score
   - `hyde.py` ✅ — LLM generates hypothetical answer → embed hypothetical → retrieve using that vector → fallback to original query if no results
   - `agentic.py` ✅ — retrieve → LLM decides if sufficient → refine query and retrieve again if not → repeat up to max_iterations
   - `runner.py` ✅ — dispatches to correct pattern based on Dim 3 config, applies Dim 1 strategy param

10d. **Semantic tool filtering (RAG over tool registry)** 🔲 — today tool filtering is purely static (allowed list + context field presence). The right approach: embed all tool descriptions at startup, embed user prompt at query time, retrieve top-k most semantically relevant tools, pass only those to the LLM. This is NOT bringing back old V1 hardcoded if/else rules — this is RAG applied to tool selection.

   **Note on tags:** Tags are stored on each tool in the Tool Gateway registry (e.g. `["care_management", "retrieval"]`) but are currently unused at runtime. They were originally intended for rule-based tool filtering — "only show tools tagged `care_management` to this agent." That approach was replaced by LLM-based tool selection (the LLM picks from `allowed_tools` directly). Tags will become useful again when semantic tool filtering (this item) is built — as metadata to aid embedding and retrieval. Until then, tags are stored but not read by the planner.

10g. **Planner — "no tool" / direct answer path** 🔲 — today the planner uses a Pydantic structured output schema where `tool` is a strict `Literal[...allowed tools...]`. The LLM is forced to pick one of the available tools — there is no way for it to say "this question doesn't need a tool, I can answer directly." Result: if `search_kb` is disabled and the user asks a general question, the LLM picks the closest-sounding tool and calls it with a wrong argument. Fix: add a `direct_answer` pseudo-tool to the allowed set. When the planner returns `tool=direct_answer`, the executor skips tool invocation and the responder answers from context (pre-graph RAG, memory, or general knowledge) alone. This makes `planner_tool.enabled: false` safe — KB questions get a graceful "I don't have a tool for that" rather than a wrong tool call.

10e. **RAG Dimension 2 — Multi-KB routing** 🔲 — query classifier (rule-based or LLM) selects which KB tool(s) to call at both pre-graph and planner tool stages independently. Fan-out across multiple KBs + merge/re-rank. All configurable via agent.yaml and UI.

10f. **Memory backend adapter pattern** 🔲 — today memory is file-based (FileMemoryStore). Build same adapter pattern as HITL: `MemoryBackend` base interface already defined. Implement: `S3Backend`, `DynamoDBBackend`, `RedisBackend`. Selected via config — zero agent code touch.

10j. **Context Scopes — Capability-level domain integration** 🔲

   **What is a Context Scope (our term — not an established industry term):**
   A context scope is a named boundary — with a specific ID — within which the agent reads memory, calls tools, and writes events during a conversation. It tells the agent not just what to do, but for whom and about what. It is not a data model concept and not a session concept — it is the operational boundary of a specific agent conversation.

   Example: a nurse opens assessment `asmt-001`. The context scopes active for that conversation are assessment + case + member — each with their own ID. The agent loads memory for all three, calls tools with those IDs, and writes episodic events back to the correct scope level.

   **Why the agent needs context scopes:**
   - **Memory** — reads and writes are scoped to these boundaries. Without scopes, the agent has no way to know which memory to load or where to write.
   - **Tool relevance** — tools need IDs to operate on. `get_case_summary` needs to know which case. `write_case_note` needs to know which case to write to.
   - **Conversation relevance** — enforces that the agent stays relevant to what the user is looking at. A nurse on assessment A should not see memory from assessment B.

   **Key property — same agent, different context scopes:**
   The same chat agent operates at member, case, and assessment level. What changes per conversation is only the context scope — determined by where in the UI the user is and which IDs the page sends with the request. No different agent needed per level.

   **Active scope resolution — derived from hierarchy:**
   The UI sends the deepest active scope as the entry point. The platform derives all parent scopes automatically from the hierarchy.
   - User on assessment page → UI sends `assessment_id` → platform activates assessment + case + member
   - User on case page → UI sends `case_id` → platform activates case + member
   - User on member page → UI sends `member_id` → platform activates member only

   **Preload strategy — per active_scope, two modes:**
   Not all active scopes should be fetched with equal eagerness. The `preload` field on each active_scope entry controls when its memory is loaded:

   - `preload: always` — fetch memory for this scope on every turn, unconditionally. Used for the immediate scope (what the user is looking at right now) and any parent scope whose facts are reliably useful regardless of the query (e.g. member semantic facts — always useful context).
   - `preload: conditional` — fetch memory for this scope only if the query indicates it is needed. Used for parent scopes whose history is not always relevant (e.g. full case episodic history — only needed for case-level questions). Avoids wasting tokens and LLM context on irrelevant history.

   Data *below* the active scope (e.g. individual assessment data when agent is scoped to case) is always fetched through tools — never preloaded.

   **Preload config shape in `agent.yaml`:**
   ```yaml
   active_scopes:
     - name: assessment
       preload: always        # immediate scope — always load
     - name: case
       preload: conditional   # only load case history if query needs it
     - name: member
       preload: always        # semantic facts always useful
   ```

   **How preload works end to end:**
   1. Payload arrives → platform resolves which active_scopes fire (based on which ID fields are present)
   2. For each resolved scope: if `preload: always` → load memory immediately
   3. For `preload: conditional` scopes: planner LLM sees a lightweight context hint ("case history available if needed") and calls a retrieval tool if the query warrants it
   4. Tools handle everything below scope level — never preloaded

   **Works at any scope level consistently:**
   - Assessment-level agent: assessment=always, case=conditional, member=always
   - Case-level agent: case=always, member=always (no assessment in active_scopes)
   - Member-level agent: member=always (only scope)

   The preload setting is agent-specific, not capability-specific — different agents in the same capability can have different preload strategies for the same scope type.

   **Design — capability-level, not agent-level:**
   Context scopes are defined once per capability — not per agent. All agents within a capability share the same scope definition. A care management capability defines assessment → case → member. Every agent in that capability (chat_agent, summary_agent, future workflow_agent) inherits those scopes automatically.

   **Who defines context scopes:**
   The developer defines scopes per capability in `domain.yaml` — two files per capability, written once, committed to the repo, never changed unless the data model changes. The Admin UI reads registered capabilities at startup and surfaces them in the agent creation dropdown. Admin never defines scopes — they pick a capability and get scopes automatically.

   **`domain.yaml` shape (common case — linear hierarchy, single ID per scope):**
   ```yaml
   scopes:
     - name: member
       id_field: member_id
       parent: null
     - name: case
       id_field: case_id
       parent: member
     - name: assessment
       id_field: assessment_id
       parent: case
   ```

   **Capability registration — what developer creates (once per capability):**
   ```
   platform/capabilities/
     care-management/
       capability.yaml    ← name, label, description, capability ID
       domain.yaml        ← context scopes, ID fields, hierarchy
     claims/
       capability.yaml
       domain.yaml
   ```
   Tools for each capability are registered separately through the Tool Gateway Admin UI — not in these files. Tool registration stays UI-driven because tool endpoints are environment-specific and can change without a code deployment.

   **Agent Factory UI flow (what admin does):**
   - Pick capability → gets context scopes automatically from domain.yaml
   - Name the agent
   - Select tools from Tool Gateway (already registered for this capability)
   - Configure memory, HITL, RAG, prompts
   - Generate + deploy

   **What platform handles automatically once scopes are defined:**
   - Scope resolution from incoming payload
   - Memory reads routed to correct scope level
   - Memory writes routed to correct scope level
   - Context hydration (patching missing IDs from thread history)
   - `/config/scopes` endpoint serves schema to frontend
   - Frontend builds ChatContext dynamically — no hardcoded type union

   **Files that become config-driven (no longer hardcoded to care management):**
   - `scope_resolver.py` — reads domain.yaml instead of hardcoded field names
   - `memory_writer._build_scopes()` — reads domain.yaml
   - `app.py hydrate_active_domain_context` — iterates domain.yaml id_fields
   - `InlineChatPanel.tsx ChatContext` — fetches from `/config/scopes` at startup
   - `SummaryPanel.tsx scopeType` — driven by schema

   **Known edge cases (out of scope for V1, documented for V2):**
   - Flat domains (no hierarchy, parallel scopes) — parent: null on all scopes, active scope = only what UI sends
   - Multiple ID fields per scope (e.g. claim_id + claim_number + authorization_id) — V1 supports one primary id_field; secondary fields handled by tools
   - Many-to-many scope relationships — out of scope, requires graph-based domain model

   **Honest boundary — what still requires code per use case:**
   - `llm_planner.py` HARD_ROUTE — domain vocabulary for fast-path routing (roadmap: remove entirely, rely on LLM path)
   - `executor.py` — tool result handling and domain data extraction
   - UI pages — member, case, assessment pages are use-case specific; developer builds them against the scope contract
   - Tool implementations — tool logic is always domain-specific, registered via Tool Gateway

   **Current build status (as of 2026-04-09):**

   **✅ Done:** `scope_resolver.py` reads `domain.yaml` at runtime to derive active scopes dynamically — no hardcoded scope names. `langgraph_runner.py` calls `resolve_scopes()` and passes results to memory read/write. Core scope resolution works.

   **🔲 Missing:**
   - `preload: always | conditional` per scope — today ALL resolved scopes are fetched unconditionally every turn. No selectivity.
   - Scope hierarchy traversal — UI currently sends all IDs (assessment_id + case_id + member_id) in the payload. Platform should derive parent scopes automatically from just the deepest ID, using the `parent:` field in domain.yaml hierarchy. Today it only activates scopes for IDs explicitly present in the payload.
   - `active_scopes` config block in `agent.yaml` — not yet defined or read.

   **Why it matters / concrete example:**
   Nurse asks "what is the member's phone number?" — a simple member-level question. Today the agent loads full case episodic history AND full assessment episodic history unconditionally, burning ~3000 tokens on irrelevant context before the LLM sees the question. With `preload: conditional` on case and assessment scopes, those fetches are skipped entirely for member-level queries.

   **When to build:** defer. Not urgent with one agent and low traffic — the token waste is invisible at this scale. Build when there is a real latency or cost problem to point to (long sessions 50+ turns, multiple agents, production load). The resolver plumbing is correct today; this is an optimization layer on top.

10n. **Reasoning Strategies — per-agent selectable reasoning loop** ⚠ Partial — `simple`, `react`, `plan_execute` built and wired. `multi_hop`, `reflection`, `tree_of_thought` remaining.

   **What a reasoning strategy is:**
   A strategy defines the *graph shape* — how the agent loops, plans, and executes. Each strategy is a separate file under `overlays/<agent_type>/agents/strategies/` that exports `build_graph()`. `build_graph.py` reads `reasoning.strategy` from `agent.yaml` and dispatches to the right file via `importlib`. Zero code changes needed to add a new strategy — drop a file, update config.

   **Important: NOT the same as RAG Dim 3 patterns.** RAG patterns control how documents are retrieved. Reasoning strategies control how the agent plans and acts. Both can be active simultaneously and are fully independent.

   **One strategy per agent — decided at deploy time:**
   Each deployed agent has one fixed strategy. Strategies have fundamentally different LangGraph graph structures — `react` is a loop, `plan_execute` is two-phase, `simple` is linear. Graph structure cannot be hot-swapped mid-conversation. Runtime strategy routing is what **multi-agent** is for — a supervisor routes to specialist agents, each with its own fixed strategy.

   ---

   **STRATEGIES — mutually exclusive, different graph shapes (pick one):**

   | Strategy | Graph shape | Planner system prompt type | `thought` field | Parallel tools | Self-corrective (last step) | Best for | Industry reference |
   |---|---|---|---|---|---|---|---|
   | `simple` ✅ | plan → execute → respond | Standard — CoT wasted, no `thought` field | ✗ | ✗ — single tool by design | ✅ optional | Single-tool Q&A, fast lookup | OpenAI Assistants, LangChain basic agent |
   | `react` ✅ | think → act → observe → loop → respond | CoT natural fit | ✅ every step | ✅ optional | ✅ optional | Multi-step tasks, 2+ tools needed | Yao et al. 2022 ReAct, LangGraph ReAct |
   | `plan_execute` ✅ | plan all steps → execute in order → respond | CoT in planning phase | ✅ planning phase | ✅ optional | ✅ optional | Structured workflows, intake forms | LangChain Plan-and-Execute |
   | `multi_hop` 🔲 | decompose → execute each sub-question → synthesize | CoT in decomposition | ✅ decomposition phase | ✅ optional | ✅ recommended | Complex research, multi-criteria queries | LangChain MapReduce, IR multi-hop QA |
   | `reflection` 🔲 | run → reflect on failure → retry with reflection → respond | CoT in reflection phase | ✅ reflection phase | ✅ optional | ✅ optional | High-stakes decisions, auditability | Shinn et al. 2023 Reflexion |
   | `tree_of_thought` 🔲 | branch multiple paths → evaluate each → pick best → respond | CoT in every branch | ✅ every branch | ✅ optional | ✅ optional | Complex tradeoff decisions | Yao et al. 2023 ToT (research-grade) |

   **Key rules from this matrix:**
   - `simple` is the only strategy where a CoT-style planner system prompt is wasted — the LLM generates reasoning but the graph has no `thought` field to capture it. Block this combination in UI.
   - `simple` cannot use parallel tools — it has exactly one tool call by design.
   - Parallel tools and self-corrective are **independent toggles** — they stack on top of any strategy that has multiple steps (all except `simple`).
   - Self-corrective is always the **last step** regardless of strategy — grades the final answer only, never mid-loop.
   - `thought` field is captured in the observability trace for all strategies except `simple` — full reasoning visibility for audit.
   - Planner system prompt type refers to the prompt written in `llm_planner.py` by the developer — not the end user's message, not the responder's prompt.

   **Memory write dependency on reasoning strategy:**
   - `simple`, `plan_execute`, `reflection`, `tree_of_thought` — memory write is always post-final-response. No dependency.
   - `react`, `multi_hop` — iterative loops. Episodic write has two modes:
     - `post_final` (default) — write once after responder produces final response. Simple, consistent.
     - `per_iteration` — write after each think-act-observe loop iteration. Full audit trail but multiple writes per turn.
   - Semantic and summary memory — always `post_final` regardless of strategy. Only episodic is affected.
   - Config: `memory.episodic.write_mode: post_final | per_iteration` in agent.yaml.
   - **When `multi_hop` and `reflection` reasoning strategies are built (currently 🔲), `memory_writer.py` must be updated to support `per_iteration` write mode for episodic.** This is a known dependency — do not build those strategies without also updating memory writer.

   **Removed from strategy list (wrong category):**
   - `chain_of_thought` — this is a *prompting technique*, not a graph shape. `react` already does CoT via the explicit `thought` field on every step. As a standalone strategy it would be identical to `simple` with a different system prompt. Not a separate strategy.
   - `self_corrective` — this is a *post-processing layer*, not a strategy. It grades and retries the final answer regardless of which strategy produced it. Moved to independent toggle (see below).

   ---

   **POST-PROCESSING — independent of strategy, stackable:**

   `self_corrective` works on top of any strategy. After the responder generates an answer, a grader LLM call checks quality (groundedness, completeness, accuracy vs tool output). If below threshold, retries with grader feedback injected.

   ```yaml
   reasoning:
     strategy: react          # controls the loop
     self_corrective:
       enabled: false         # grade + retry final answer — works with any strategy
       threshold: 0.7         # 0.0–1.0, retry if score below this
       max_retries: 2
   ```

   Best for: `write_case_note` (clinical record accuracy), `search_kb` (RAG answer grounding).
   Not needed for: simple lookups (`get_member`, `get_assessment_summary`) where the responder is already reliable.

   ---

   **Config shape (agent.yaml):**
   ```yaml
   reasoning:
     strategy: react          # react (default) | simple | plan_execute | multi_hop | reflection | tree_of_thought
     max_steps: 5             # react only — max tool calls before forcing response
     parallel_tools:
       enabled: false         # fan-out multiple tool calls simultaneously per step (not applicable to simple)
       max_parallel: 3        # max tools to call in parallel per step
     self_corrective:
       enabled: false         # grade + retry final answer — works with any strategy
       threshold: 0.7         # 0.0–1.0, retry if score below this
       max_retries: 2
   ```

   ---

   **Step-by-step breakdown per strategy — LLM calls vs tool execution:**

   > **Scope:** all steps below are **in-graph only** — the planner loop. Pre-graph (RAG retrieval before graph runs) and post-graph (memory writes after graph finishes) are outside this entirely and do not change per strategy.
   >
   > **"Internal state"** = no LLM call, no tool call. The graph stores the previous step's output into LangGraph state so the next node can read it. Pure data passing — zero cost.
   >
   > Every step is exactly one of three things: **LLM call**, **Tool execution**, or **Internal state**.

   **`simple`** — 2 LLM calls, 1 tool call
   | Step | Term | Type | What happens | Internal state detail |
   |---|---|---|---|---|
   | 1 | **Plan** | LLM — planner | picks one tool and argument | — |
   | 2 | **Act** | Tool execution | runs the tool | — |
   | 3 | **Respond** | LLM — responder | generates answer from tool output | — |

   **Prompt needed:** `planner_system_prompt` — "pick exactly one tool, return tool name and argument. No thought field needed."

   **Rule:** CoT-style prompt is wasted on `simple` — the graph has no `thought` field. Do not use a Thought/Action format here.

   ---

   **`react`** — 2+ LLM calls per loop iteration, 1 tool call per iteration
   | Step | Term | Type | What happens | Internal state detail |
   |---|---|---|---|---|
   | 1 | **Think** | LLM — react planner | reasons about what to do next, outputs Thought + Action | — |
   | 2 | **Act** | Tool execution | runs the chosen tool | — |
   | 3 | **Observe** | Internal state | stores tool output | graph writes `observation` field into state so next Think sees it in context |
   | 4→ | **Think** | LLM — react planner ← loop | reasons again with observation in context | — |
   | 5→ | **Act** | Tool execution ← loop | runs next tool | — |
   | 6→ | **Observe** | Internal state ← loop | stores output | same as step 3 |
   | ... | repeats until DONE signal or max_steps | | | |
   | N | **Respond** | LLM — responder | only triggered if max_steps hit. If DONE signal: Think carries the answer directly, no separate Respond call | — |

   **Prompt needed:** `react_planner_system_prompt` — must instruct `Thought: <reasoning> / Action: <tool>(<arg>)` format. Loop continues until LLM outputs `DONE` in Thought.

   ---

   **`plan_execute`** — 2 LLM calls total regardless of tool count
   | Step | Term | Type | What happens | Internal state detail |
   |---|---|---|---|---|
   | 1 | **Plan** | LLM — planner | decides ALL tools and order upfront in one shot | — |
   | 2 | **Observe** | Internal state | stores the plan as ordered list | graph writes `plan: [{tool, arg}, ...]` into state |
   | 3 | **Act ×N** | Tool execution | runs each tool in planned order — no LLM between acts | — |
   | 4 | **Observe ×N** | Internal state | stores each tool output | graph appends each result to `results[]` in state |
   | N | **Respond** | LLM — responder | synthesizes all tool outputs into final answer | — |

   **Prompt needed:** `plan_execute_planner_system_prompt` — "output a full ordered plan as a JSON list before executing anything. Format: [{tool, argument}, ...]"

   ---

   **`multi_hop`** — 3+ LLM calls (roadmap)
   | Step | Term | Type | What happens | Internal state detail |
   |---|---|---|---|---|
   | 1 | **Decompose** | LLM — decomposer | breaks question into N sub-questions | — |
   | 2 | **Observe** | Internal state | stores sub-question list | graph writes `sub_questions: [...]` into state |
   | 3 | **Plan** | LLM — sub-planner ← loop per sub-question | picks tool for sub-question 1 | — |
   | 4 | **Act** | Tool execution ← loop | runs tool for sub-question 1 | — |
   | 5 | **Observe** | Internal state ← loop | stores sub-answer 1 | graph appends `{question, answer}` to `sub_answers[]` |
   | ... | repeats steps 3–5 per sub-question | | | |
   | N | **Synthesize** | LLM — synthesizer | combines all sub-answers into one coherent response | reads full `sub_answers[]` from state |

   **Prompts needed:** `decomposer_system_prompt` + `sub_planner_system_prompt` + `synthesizer_system_prompt` — three distinct prompts, each for a different LLM role in the graph.

   ---

   **`reflection`** — 3–5 LLM calls (roadmap)
   | Step | Term | Type | What happens | Internal state detail |
   |---|---|---|---|---|
   | 1 | **Plan** | LLM — planner | picks tool | — |
   | 2 | **Act** | Tool execution | runs it | — |
   | 3 | **Observe** | Internal state | stores tool output | graph writes `tool_output` into state |
   | 4 | **Respond** | LLM — responder | generates answer | — |
   | 5 | **Reflect** | LLM — reflector | critiques: was the approach right? Was anything missed? | reads both `tool_output` and `answer` from state |
   | 6 | **Plan** (conditional) | LLM — planner | re-plans only if reflection found issues | reads `reflection` from state |
   | 7 | **Act** (conditional) | Tool execution | re-runs only if re-plan triggered | — |
   | 8 | **Respond** (final) | LLM — responder | final answer | — |

   **Prompts needed:** `planner_system_prompt` + `responder_system_prompt` + `reflector_system_prompt` — reflector prompt must say "critique the reasoning and answer. Identify gaps or errors. Output: {issues_found: bool, critique: str, suggested_correction: str}"

   ---

   **`self_corrective` post-processing** — appended as last steps to any strategy above
   | Step | Term | Type | What happens | Internal state detail |
   |---|---|---|---|---|
   | +1 | **Grade** | LLM — grader | scores answer quality 0.0–1.0 against tool output | reads `answer` and `tool_output` from state |
   | +2 | **Retry** (conditional) | LLM — responder | re-runs Respond with grader feedback injected ← only if score < threshold | reads `grade` and `grader_feedback` from state |

   **Prompt needed:** `grader_system_prompt` — "score this answer 0.0–1.0 for groundedness and completeness against the tool output. Output: {score: float, feedback: str}"

   > **UI — help panel:** Agent Registry → Overview tab should display the active strategy's step table (read from `reasoning.strategy` in agent config). When an admin hovers the strategy name, the help panel shows: graph shape, step-by-step breakdown, which prompts are required, and cost profile. This is the same contextual help pattern used in Memory and RAG tabs.

   **Cost summary:**
   | Strategy | Min LLM calls | Tool calls | Notes |
   |---|---|---|---|
   | `simple` | 2 | 1 | Cheapest — deliberate cost optimization |
   | `react` | 2 + N per loop | N | Moderate — N depends on query complexity |
   | `plan_execute` | 2 | N | Fixed LLM cost regardless of tool count |
   | `multi_hop` | 3 + 2 per sub-question | N | Expensive — use for research queries only |
   | `reflection` | 3–5 | 1–2 | Expensive — use for high-stakes decisions |
   | `tree_of_thought` | 3 + N branches | 1 | Most expensive — research-grade |

   ---

   **File structure:**
   ```
   overlays/chat_agent/agents/strategies/
     simple.py          ✅ built
     react.py           ✅ built
     plan_execute.py    ✅ built
     multi_hop.py       🔲
     reflection.py      🔲
     tree_of_thought.py 🔲 (research-grade, low priority)
   ```

   **UI — strategy selected in two places:**
   - Agent Factory form — dropdown at agent config step
   - Agent Registry — changeable post-creation in config tab (requires rebuild)
   - Pipeline Builder — dropdown on the Planner node

   **Default strategy:** `react` — not `simple`. `simple` is a deliberate cost-optimization choice. All production enterprise agent frameworks (LangGraph, AutoGen, Vertex AI Agent Builder) default to a reasoning loop. `simple` should require an explicit opt-in, not be the default.

   **CoT system prompt validation rule:**
   CoT (chain-of-thought) is a prompting technique — it is written into the planner system prompt by the developer, not selected by the end user. A CoT-style prompt instructs the LLM to reason before acting. `simple` has no `thought` field in its schema — the LLM reasoning is generated but not captured, stored, or used. Every other strategy (`react`, `plan_execute`, `multi_hop`, `reflection`, `tree_of_thought`) has a `thought` field as part of their structured output schema.

   Enforcement rule: if the planner system prompt contains CoT instructions, the UI must warn and block saving with `strategy: simple`. All other strategies are compatible with CoT prompts.

   UI validation location: Agent Registry → Planner tab → when system prompt is edited or strategy is changed.

10g. **Config-driven adapter selection** 🔲 — across HITL, RAG patterns, and memory backends, adapter/pattern selection should be fully config-driven. Goal: `hitl.adapter: pega`, `retrieval.pattern: self_corrective`, `memory.backend: dynamodb` in agent.yaml → platform instantiates correct implementation automatically. Zero code touch.

10L. **Platform-core shared library — plugin architecture** 🔲 — centralize all platform logic (scope resolution, memory fetch/write, RAG, HITL) into a single shared library that every agent runtime imports. Agents stay thin — they bring config, the library brings logic.

   **Design:**
   - `platform-core/` — shared library, CODE ONLY. No config, no domain knowledge, no hardcoded capability names.
   - `domain.yaml` (capability level) — defines all possible scopes, ID fields, hierarchy. Owned by the capability, shared by all agents in that capability.
   - `agent.yaml` (agent level) — defines which scopes to use, preload strategy, memory settings, RAG pattern, HITL rules. Owned by the agent shell.

   ```
   platform-core/          ← library: pure logic, zero config
     context/
       scope_resolver.py   ← reads domain.yaml + agent.yaml at runtime
       memory_fetcher.py
       context_builder.py
     rag/
       retriever.py
       patterns/
     hitl/
       risk_scorer.py
       approval_store.py
     schemas/
       agent.schema.yaml   ← validates agent.yaml at startup
       domain.schema.yaml  ← validates domain.yaml at startup
   ```

   **How it works at runtime:**
   - Agent starts → loads its own `agent.yaml` + capability's `domain.yaml`
   - Passes both into platform-core functions
   - platform-core executes against those configs — same code path for every agent
   - Different agents get different behavior purely from different config, not different code

   **This is the plugin architecture pattern** — same as webpack (webpack.config.js per project, shared engine), LangChain (chain config per agent, shared library), Kubernetes (manifest yaml per workload, shared control plane). Standard, proven, scales well.

   **Config schema + validation layer (prevents config drift):**
   At agent startup, library validates both config files against their schemas and fails fast with a clear error if something is wrong, unsupported, or inconsistent. Keeps per-agent flexibility without letting config become a free-for-all across many agents.

   **What gets centralized (moved out of agent runtimes into platform-core):**
   - `scope_resolver.py` — currently duplicated across agent overlays
   - `memory_fetcher.py` + `context_builder.py` — currently in platform/ but not formally packaged
   - `retriever.py` + RAG patterns — currently per-agent
   - `risk_scorer.py` + approval logic — currently per-agent

   **What stays per-agent (config only, never code):**
   - `agent.yaml` — behavior settings for this specific agent
   - `prompt-defaults.yaml` — prompts for this specific agent
   - `domain.yaml` — at capability level, not agent level

   **Relationship to future services (backlog 10k, AgentCore):**
   This shared library is the right step now. If multi-agent coordination later requires true service separation (agents sharing state mid-execution), platform-core modules extract to HTTP services at that point. The library design makes that extraction clean — the agent runtime already calls through a well-defined interface, so swapping in-process calls for HTTP calls is mechanical. AgentCore Memory is essentially this pattern run as a managed service.

10h. **Semantic memory vector retrieval** 🔲 — today semantic facts are retrieved by scope (fetch all facts for member). At scale (50+ facts per member), needs vector similarity retrieval: embed each fact at write time, embed query at retrieval time, return top-k by cosine similarity. Requires vector-capable backend (pgvector on PostgreSQL).

10i. **RAG Config — Wire YAML parameters to retriever** ✅ — `agent.yaml` retrieval section should drive actual RAG behavior. Right now `top_k`, similarity threshold, embedding model, and Dim 1 retrieval method (`semantic | keyword | hybrid`) are hardcoded in `retriever.py` as env var defaults and never read from YAML. Applies independently to both pre-graph and planner_tool stages. Files to touch: `agent.yaml`, `executor.py`, `retriever.py`, `registry.py`.

10k. **Multi-Agent & Workflow Architecture** 🔲 — design and build support for multi-agent workflows where a supervisor orchestrates sub-agents, each operating at a different domain scope level. Core design principle: **a new domain or use case should require only new YAML config files, zero platform code changes.**

   **Design decisions (agreed, not yet implemented):**

   **Context propagation — additive model:**
   - Context dict flows through the entire workflow and can only grow — steps add fields, never overwrite
   - Example: supervisor receives `{member_id}` → tool call enriches to `{member_id, case_id}` → sub-agent enriches to `{member_id, case_id, assessment_id}`
   - Each agent reads from the shared context at its point in the workflow; later agents see everything earlier agents discovered
   - Prevents hidden state mutation bugs; makes debugging deterministic

   **Per-agent primary scope:**
   - Each agent declares its `primary_scope` in its own `agent.yaml` — the level of the domain hierarchy it operates at
   - Memory reads and writes are scoped to the agent's declared scope plus any parent scopes it is configured to read upward from
   - Example: supervisor = `primary_scope: member`; sub-agent = `primary_scope: assessment`
   - Same memory store, different scope resolution per agent — no code change needed, only config

   **Config-driven workflow steps:**
   - Workflow sequence defined in supervisor's `agent.yaml` under a `workflow.steps` block
   - Each step declares which agent handles it, what `primary_scope` it operates at, and which context fields it expects to receive
   - Fixed graph (LangGraph edges) for regulated/auditable workflows; config-driven routing for flexible pipelines
   - Supervisor LLM decides *what question to ask*, not *which agent to invoke* — routing stays deterministic for compliance
   - Example config shape:
   ```yaml
   workflow:
     context_propagation: additive
     steps:
       - name: assessment_analyst
         agent_type: chat_agent
         primary_scope: assessment
         receives: [member_id, case_id, assessment_id]
       - name: care_planner
         agent_type: chat_agent
         primary_scope: case
         receives: [member_id, case_id]
   ```

   **Scope schema per agent (extends backlog item 10j):**
   - Each agent in the workflow declares its own scope schema in its `agent.yaml`
   - An agent at `assessment` scope may also read upward to `case` and `member` — configured explicitly
   - A new domain (e.g. claims: policy → claim → item) only needs new `agent.yaml` files with new scope schemas — no Python changes
   ```yaml
   memory:
     primary_scope: assessment
     scopes:
       - type: assessment
         id_field: assessment_id
       - type: case
         id_field: case_id        # reads parent scope for context
   ```

   **HITL across agent boundaries:**
   - Each sub-agent has its own approval queue entry — approval is tool-scoped, not agent-scoped
   - Supervisor waits (LangGraph interrupt) until all pending sub-agent approvals resolve before synthesizing final response
   - This is the same parallel approvals pattern (backlog item 10) — multi-agent makes it a hard requirement
   - Audit log records which agent in the workflow triggered each approval

   **Extending to a new domain — zero code changes:**
   - New domain = new overlay folder with new `agent.yaml` files (one per agent in workflow) + scope schema per agent
   - Workflow steps declared in supervisor's `agent.yaml`
   - Context propagation, scope resolution, memory scoping, HITL routing all driven by config

   **RAG in multi-agent — per-agent config + context passthrough:**
   - Each agent (supervisor + every sub-agent) has its own independent `retrieval` config in its own `agent.yaml`
   - Same `pre_graph` / `planner_tool` two-block structure applies per agent
   - Different sub-agents can use different KBs: research agent uses `kb_clinical`, writer uses `kb_style_guide`, QA uses `kb_compliance_rules`
   - New config field for multi-agent RAG coordination:
   ```yaml
   retrieval:
     pre_graph: ...
     planner_tool: ...
     multi_agent:
       accept_supervisor_context: true   # use rag_context passed from supervisor — skip re-retrieve
       propagate_context: false          # supervisor-only: pass rag_context down to all sub-agents
   ```
   - `accept_supervisor_context: true` → sub-agent skips its own pre_graph retrieval, uses what supervisor already retrieved. Saves latency, avoids redundant KB calls.
   - `propagate_context: true` → supervisor sets this. After its pre_graph retrieval, injects `rag_context` into shared state so all sub-agents can read it.
   - Default: each agent retrieves independently (clean separation). Passthrough is an opt-in optimization.

   **Memory in multi-agent — per-agent scope + shared store:**
   - Each agent writes to its own declared scope (assessment, case, member)
   - All agents share the same memory store — no duplication
   - Supervisor reads from member scope; sub-agents read from their own scope + parent scopes they're configured to see
   - Memory write conflicts (two agents writing to same scope in same turn): last-write-wins, documented as known limitation for V1

   **Reasoning strategies in multi-agent:**
   - Each sub-agent has its own fixed reasoning strategy in its `agent.yaml`
   - Supervisor does NOT switch strategies at runtime — it routes to the right sub-agent, each of which has the right strategy baked in
   - Example: supervisor uses `simple` (just routes), research sub-agent uses `multi_hop`, writer sub-agent uses `chain_of_thought`

   **Goal tracking in multi-agent:**
   - Goal is declared at supervisor level — it owns the overall objective
   - Sub-agents report sub-goal completion back to supervisor via shared state
   - Supervisor tracks overall goal progress across sub-agent turns
   - Requires goal tracking (backlog item 14) to be built first
   - Platform code (scope_resolver, memory_writer, workflow executor) reads config and adapts — no hardcoded domain logic

   **What still needs design:**
   - Workflow executor: how the supervisor graph invokes sub-agent graphs (LangGraph subgraph pattern vs separate HTTP calls)
   - State handoff schema: what the shared state object looks like between agents (typed vs untyped dict)
   - Memory isolation policy: when two agents write to overlapping scopes in the same workflow turn, which write wins
   - UI: how trace graph and memory panel represent multi-agent execution (one panel per agent vs merged view)

10m. **Guardrails** 🔲 — safety and compliance layer that intercepts agent inputs and outputs before they reach the LLM or the user. Ensures agent responses stay within defined boundaries — critical for regulated industries like healthcare.

   **What guardrails cover:**

   - **Input guardrails** — check the user's message before it hits the LLM. Block prompt injection attempts, PII in unexpected fields, out-of-scope requests (e.g. nurse asking agent to do something outside care management workflow).
   - **Output guardrails** — check the agent's response before it reaches the user. Block hallucinated clinical facts, PII leakage in responses, responses that contradict known member data, off-topic or harmful content.
   - **Tool call guardrails** — check tool arguments before execution. Block writes with invalid IDs, calls with mismatched scope context, high-risk operations that bypass HITL.

   **Where it sits in the execution flow:**
   ```
   User message
        ↓
   [Input guardrail]      ← intercept before LLM
        ↓
   LLM + planner
        ↓
   [Tool call guardrail]  ← intercept before tool executes
        ↓
   Tool result + response
        ↓
   [Output guardrail]     ← intercept before user sees it
        ↓
   User
   ```

   **Config-driven per agent (agent.yaml):**
   ```yaml
   guardrails:
     input:
       - type: pii_detection
         action: block
       - type: scope_check
         action: warn
     output:
       - type: pii_redaction
         action: redact
       - type: hallucination_check
         action: flag
     tool_call:
       - type: id_validation
         action: block
   ```

   **Admin UI — Guardrails tab in Agent Registry:**
   Admin enables/disables guardrail types per agent, sets action (block / warn / redact / flag), views guardrail trigger logs.

   **Industry context:**
   AWS Bedrock Guardrails, Azure Content Safety, and Guardrails AI all offer this as a managed service layer. Our design should be adapter-pattern compatible — same interface whether guardrails run locally or via a managed service. AgentCore also has a guardrails layer that this would plug into.

   **Relationship to HITL:**
   HITL handles human approval for risky tool calls. Guardrails handle automated blocking/flagging for policy violations. They are complementary — guardrails fire first, HITL fires for what passes guardrails but still needs human review.

11. **AgentCore compatibility** 🔲 — memory backend swap + CloudWatch traces. Note: AgentCore replaces the orchestration engine only — all platform capabilities (memory model, HITL, RAG patterns, prompt governance) must still be built regardless.

11a. **Runtime split — 2-container architecture** 🔲 — refactor the single agent-runtime container into two deployable units to support edge/customer VPC deployment without exposing platform IP.

   **Container 1 — Runtime Shell (deploys to customer VPC or edge)**
   - Graph skeleton: pre-graph, in-graph, post-graph orchestration
   - HTTP clients only: calls Container 2 for all logic
   - No business logic, no IP — just the execution shell

   **Container 2 — Platform Services (stays on your VPC)**
   - Config resolver (merges YAMLs → resolved runtime config)
   - Tool gateway / MCP server (tool execution, healthcare logic)
   - Memory service (read + write)
   - RAG service (retrieval)
   - Prompt service
   - Observability / trace store

   **Key property:** Container 1 is deployment-agnostic — same image deploys to customer VPC, edge, or your VPC. Points at Container 2 via URL config only. For strict customers who require zero data leaving their boundary, Container 2 services can also be moved customer-side — Container 1 code unchanged.

   **Industry alignment:** Control-plane / data-plane split is standard across AWS (VPC + service endpoints), Istio (sidecar + control plane), and enterprise agent platforms (Sema4.ai, LangChain). Two-container separation of orchestration shell from platform services is the right enterprise pattern.

   **Design constraints (must be addressed in implementation):**
   - Latency: every pre/in/post-graph step now has a network hop to Container 2 — cache resolved config + tool metadata at Container 1 startup to avoid per-request round trips
   - Inter-service auth: Container 1 → Container 2 calls must use mTLS or signed tokens — not open HTTP
   - Resilience: Container 1 needs circuit breakers — if Container 2 is unreachable, fail gracefully not silently
   - Strict customers: design Container 2 services to be individually deployable customer-side from day one — same Container 1 image, different service URLs via env vars

   **What needs to change:**
   - Extract `tools/router.py`, memory engines, RAG runner, prompt client into standalone service endpoints in Container 2
   - Container 1 replaces direct calls with HTTP client calls to Container 2 base URL (env var)
   - `tool_gateway_client.py` and `prompt_client.py` already exist as client patterns — extend this model to memory + RAG + config resolution
   - Add inter-service auth layer (mTLS or signed JWT) between containers

11b. **Resolved runtime config — single merged config per agent** 🔲 — replace per-request multi-YAML loading with a single pre-resolved `resolved_runtime_config.yaml` generated at deploy/save time. Container 1 loads one file at startup. Container 2 owns the resolution logic (merging agent.yaml + memory.yaml + rag.yaml + tools.yaml + routing.yaml + customer overrides → one execution-ready object).

   **What it solves:**
   - Container 1 has no config parsing logic → no IP exposed in shell
   - No per-request YAML merging → faster startup and execution
   - Single artifact to audit — exactly what the agent will do, no ambiguity
   - Customer never sees raw policy/routing logic, only the resolved output

   **Industry alignment:** Same pattern as Kubernetes (manifest → applied config), Helm (values.yaml → rendered templates), and compiled deployment artifacts. Pre-resolving config at build/deploy time rather than runtime is standard enterprise practice for both performance and auditability.

   **Resolution trigger:** config is regenerated whenever admin saves any config tab in Agent Registry UI → Support API calls Container 2 resolver → writes new `resolved_runtime_config.yaml` → Container 1 hot-reloads or restarts.

   **Design constraints (must be addressed in implementation):**
   - Versioning: every resolved config must be versioned (timestamp + hash) so you can rollback if a bad config reaches production
   - Invalidation: Container 1 must detect when resolved config changes and reload — avoid stale config serving live traffic
   - Sensitivity: resolved config contains tool lists, HITL rules, policy data — treat as sensitive artifact, do not log raw, encrypt at rest
   - Strict customers: for customer-hosted deployments, resolution can run customer-side with Container 2 deployed there — same output format, same Container 1 consumption

   **What needs to change:**
   - Container 2: build `ConfigResolver` service that reads all source YAMLs + customer overrides, outputs `resolved_runtime_config.yaml`
   - Container 1: replace `usecase_config_loader.py` multi-file loading with single resolved config loader
   - Support API: on any agent config save → trigger resolved config regeneration via Container 2
   - Add config version field to resolved output for audit + rollback

12. **Fresh repo generation test** 🔲 — delete and re-scaffold from template, verify end-to-end.

12c. **agent-platform repo structure refactor** ✅ — full restructure of how capabilities, apps, agents, and UI are organised in the agent-platform repo. This replaces the `generated-repos/` wrapper and the "use case" concept entirely.

   **Terminology changes:**
   - "use case" → **agent** (what gets created, deployed, and managed in Agent Factory)
   - "generated repo" → **agent shell** (thin generated deployment unit)
   - "monorepo" → **agent-platform** (the root repo)
   - Remove "use case" label from Agent Factory UI entirely

   **Target structure:**
   ```
   agent-platform/
   ├── platform/                          ← platform core (never changes per capability)
   ├── templates/
   │   ├── agent-runtime-template/        ← agent runtime scaffold
   │   └── capability-ui-template/        ← generic test UI only (scope-driven chat)
   │                                         no domain pages, works for any capability
   ├── platform-tools/                    ← Agent Factory UI, Support API
   │
   ├── care-management/                   ← capability folder
   │   ├── cm-hero-fl-app/                ← app (permanent, not generated)
   │   │   ├── capability.yaml            ← capability definition
   │   │   ├── domain.yaml                ← context scopes + ID fields (owned by app)
   │   │   └── ui/                        ← capability-specific application UI
   │   │       └── src/pages/             ← Members, CaseView, AssessmentView etc
   │   │
   │   └── agents/                        ← generated agent shells live here
   │       ├── pre-call-assessment/       ← agent shell (thin, generated)
   │       │   ├── docker-compose.yml
   │       │   └── services/
   │       │       ├── ui/                ← generic test UI (from template)
   │       │       └── agent-runtime/
   │       │           └── overlays/
   │       │               └── chat_agent/
   │       │                   ├── agent.yaml
   │       │                   └── prompt-defaults.yaml
   │       └── post-discharge/            ← another agent shell
   │
   └── claims/                            ← another capability (same pattern)
       ├── claims-app/
       │   ├── capability.yaml
       │   ├── domain.yaml
       │   └── ui/
       └── agents/
           └── claims-intake/
   ```

   **Key design decisions:**

   **App vs agent shell — two separate things with independent lifecycles:**
   - **App** (`cm-hero-fl-app/`) — permanent, never generated, never deleted. Owns `domain.yaml`, `capability.yaml`, and the capability-specific application UI. Has its own git history and deployment pipeline. UI deploys independently to CDN/web server.
   - **Agent shell** (`agents/pre-call-assessment/`) — thin, generated by Agent Factory, independently deployable. Only contains `agent.yaml`, `prompt-defaults.yaml`, `docker-compose.yml`, and generic test UI. Deploys to a container. Can be deleted and regenerated without losing anything in the app.

   **Why UI and agent are separate deployments:**
   - UI changes frequently (design, UX, new pages) — should not require agent redeployment
   - Agent config changes (prompts, tools, memory) — should not require UI redeployment
   - Each has its own CI/CD pipeline
   - Contract between them: UI sends scope IDs in POST payload to `/invocations` — that's the only coupling

   **Who owns what:**
   - `domain.yaml` — owned by the app, not the agent shell. Agent shell references it. Survives agent deletion/regeneration.
   - Application UI — owned by the app. Built once per capability by the developer. Not generated.
   - Generic test UI — owned by the agent shell template. Generated automatically. Works for any capability.
   - `agent.yaml` + prompts — owned by the agent shell. Generated, customisable, independently versioned.

   **Agent Factory UI changes:**
   - Remove "use case" concept and label entirely
   - Add "app" picker — which app does this agent belong to (e.g. cm-hero-fl-app)
   - Agent name describes what it does (Pre-Call Assessment, Post-Discharge)
   - Generated shell lands in `<capability>/agents/<agent-name>/`
   - Start/stop/restart/delete controls scope to agent shell only — app is never touched

   **Scope resolution — three levels:**

   This is the key design that makes multiple agents within the same capability work cleanly, including multiple chat agents with different scopes:

   - **`domain.yaml` (capability level)** — defines ALL possible scopes for the capability. This is the full registry of scope types, ID fields, and hierarchy for this domain. Example: care management defines member, case, assessment as all possible scopes.
   - **`agent.yaml` (agent level)** — declares `active_scopes` — the subset of capability scopes this specific agent is allowed to resolve. Example: post-discharge agent declares `active_scopes: [case, member]` — it never resolves assessment scope even if assessment_id arrives in payload.
   - **Payload (runtime)** — determines which of the declared active_scopes actually activate for this specific conversation. Example: nurse on member page → sends only member_id → only member scope activates, even if agent supports case and member.

   ```yaml
   # domain.yaml (capability level — all possible scopes)
   scopes:
     - name: member
       id_field: member_id
       parent: null
     - name: case
       id_field: case_id
       parent: member
     - name: assessment
       id_field: assessment_id
       parent: case

   # agent.yaml (agent level — subset + preload strategy per scope)
   active_scopes:
     - name: assessment
       preload: always        # immediate scope — always load memory
     - name: case
       preload: conditional   # load case history only if query needs it
     - name: member
       preload: always        # semantic member facts always useful

   # post-discharge agent — no assessment scope, different preload profile
   active_scopes:
     - name: case
       preload: always
     - name: member
       preload: always

   # member outreach agent — member only
   active_scopes:
     - name: member
       preload: always
   ```

   **The four levels of scope resolution:**
   1. `domain.yaml` defines ALL possible scopes for the capability (capability level)
   2. `active_scopes` in `agent.yaml` declares the subset this agent is allowed to resolve (agent level)
   3. `preload` on each active_scope controls memory fetch eagerness — `always` or `conditional` (agent level)
   4. Payload at runtime determines which of the declared active_scopes actually activate this turn (runtime)

   Data below the active scope (e.g. individual assessments when agent is scoped to case) is always fetched through tools, never preloaded.

   Multiple chat agents in the same capability each declare their own `active_scopes` + preload strategy. Each is independently generated, deployed, started, stopped, deleted. No use case concept needed — the agent name + active_scopes + preload config + prompts defines the workflow.

   **Generic test UI scope population:**
   When Agent Factory generates a new agent shell, the support API reads `domain.yaml` from the capability folder and filters by the agent's declared `active_scopes`. The generic test UI renders only the ID input fields for those scopes. Developer fills in test IDs and chats immediately — correct scope context, no hardcoding.

   **What needs to change — implementation tasks:**
   - Support API: update scaffold endpoint — new path structure, capability name + app picker, agents/ subfolder, read domain.yaml to populate test UI scope fields
   - Agent Factory UI: remove use case picker, add app picker, add active_scopes selector (checkboxes from capability's domain.yaml scopes), update generation flow
   - Templates: strip `capability-ui-template` to generic test UI only — scope fields rendered dynamically from `/config/scopes`
   - Care management: move nurse UI pages from `cm-hero-fl-app/services/ui/` to `care-management/cm-hero-fl-app/ui/`
   - Existing generated repos: migrate from `generated-repos/care-management/` to `care-management/agents/`
   - `domain.yaml`: move to capability level (above app), both app and agent shells reference it from there
   - Agent runtime: at startup, read `domain.yaml` from capability level, filter by `active_scopes` from `agent.yaml`, build DomainContext from intersection
   - Git init: each agent shell gets its own `.git` on generation (backlog 12b)

12b. **Git init on repo generation** 🔲 — when Agent Factory generates a new usecase repo, it should automatically `git init` inside the generated folder, make an initial commit ("scaffold: generated from template"), and optionally push to a remote (GitHub/CodeCommit/ADO). Today generated repos are just folders inside the monorepo with no own `.git`. In production each usecase repo must be independent — own git history, own remote, own CI/CD pipeline. This is also a strong demo moment: one click in Agent Factory produces a standalone, version-controlled, deployable repo.

---

## Demo

16. **Demo script + recording** 🔲 — 15-min structured demo covering all platform capabilities

   **Locked agenda (6 beats, 15 min):**
   - Beat 1 (1.5 min) — Platform intro: what it is, tech stack (Cursor + Claude, LangGraph, FastAPI, React/TS/Vite, PostgreSQL + pgvector), AgentCore compatibility stated upfront. Show architecture diagram.
   - Beat 2 (3 min) — Five capabilities high level: Memory (4 scopes), RAG (all 3 dimensions — strategy/stage/pattern), HITL (adapter pattern today → Pega/Epic tomorrow), Tool Governance (registry/lifecycle/URL dispatch), Prompt Management. Use docs diagrams.
   - Beat 3 (2.5 min) — Admin UI live: Tool Admin UI (tool registry, click write_case_note schema, KB tab). Agent Factory → Agent Registry (Memory toggles, HITL risk levels). Bridge: "that UI writes to this config file."
   - Beat 3b (1.5 min) — Cursor: open 3 files — agent.yaml ("this is what the UI writes to"), build_graph.py ("this is the graph"), langgraph_runner.py ("three-phase boundary"). Then: "now let's see this run."
   - Beat 4 (5.5 min) — Execution flow diagram briefly → Nurse demo: Members → Case → Assessment → tool call (trace) → RAG (search_kb) → HITL triggered → Supervisor approves → memory panel → Generate Summary (summary_agent, same platform)
   - Beat 5 (1.5 min) — Roadmap: V1→V2→V3 table. AgentCore: one file swap, all capabilities unchanged.

   **Recording plan:** to be defined — zoom in/out per beat, screen layout, resolution, zoom tool

---

## Content & Thought Leadership

17. **Blog post** 🔲 — focused technical post on one differentiated architectural insight. Three options (pick one):
   - **RAG 3-dimension framework** — Strategy / Stage / Pattern as a mental model for configurable retrieval. Most likely to get traction given RAG noise in the market.
   - **LangGraph runner boundary pattern** — pre-graph / graph / post-graph separation; how to wrap LangGraph so the graph stays swappable.
   - **HITL adapter pattern for enterprise** — agent proposes, system of record executes; one-file swap to Pega/Epic.
   - Target: 800-1000 words, one architecture diagram, LinkedIn or Substack.

---

## Documentation & Deliverables

13. **Platform documentation (Word doc)** 🔲 — merge all numbered section docs into a single comprehensive Word document. Full platform narrative, every file's purpose, extension points for new agents/tools/memory scopes.

13a. **Platform Capability Visual Document + "12 Components" equivalent** 🔲 — two deliverables:

   **Deliverable 1 — Per-capability deep dives** (one visual per capability):
   RAG, Memory, HITL, Tools, Observability — each showing all dimensions in flow/diagram format, color-coded by build status (✅ built / 🔲 roadmap).

   **Deliverable 2 — "What we built" platform overview diagram** — equivalent to the "12 Core Components of an Agentic AI System" format, but showing OUR platform with OUR terminology, what's actually built, and what makes it different. Structure:

   Title: **"Enterprise Agentic AI Platform — What We Built"**

   12 components to show (mapped to our platform):

   | # | Component | Our term | Status | Our differentiation |
   |---|---|---|---|---|
   | 1 | Memory | Memory System (4 types) | ✅ Built | Short-term + episodic + semantic + summary. Per-scope. Toggle per message. |
   | 2 | Knowledge Base | RAG — 3 Dimensions | ✅ Built | Dim 1: strategy (semantic/keyword/hybrid). Dim 2: stage (pre-graph/planner). Dim 3: pattern (naive/self-corrective). |
   | 3 | Tool Use & API | Tool Gateway | ✅ Built | URL-based dispatch. DB-backed registry. Admin UI. Tag-based bucketing. |
   | 4 | Planning Engine | LLM Planner | ✅ Built | Structured output. Dynamic schema from registry. Hard routes. Context-filtered tool list. |
   | 5 | Execution Loop | LangGraph Executor | ✅ Built | ReAct-compatible. HITL interrupt. Tool result handling. |
   | 6 | Reasoning Strategies | Reasoning Layer | ⚠ Partial | simple built. react/CoT/self-corrective/multi-hop/plan-execute/reflection/tree-of-thought — stubs, wiring roadmap. |
   | 7 | NL Interface (LLM) | Responder + Prompt Governance | ✅ Built | Claude. Prompt versioning. Prompt Management UI. |
   | 8 | Human-in-the-Loop | HITL — Approval Engine | ✅ Built | **Not in any standard framework diagram.** Risk scoring. Adapter pattern (internal → Pega/Epic). Async approval queue. |
   | 9 | Guardrails | Guardrails Layer | 🔲 Roadmap | Input/output/tool-call intercept. Adapter: local or Bedrock Guardrails. |
   | 10 | Goal Tracking | Goal Definition & Tracking | 🔲 Roadmap | Multi-step persistent objectives. Sub-goal progress. Required for plan_execute strategy. |
   | 11 | Evaluation | Eval & Testing Framework | 🔲 Roadmap | LLM-as-judge. RAG eval (Ragas). Prompt regression. Score dashboards. |
   | 12 | Observability | Trace + LLM Ops | ⚠ Partial | TraceGraph + MemoryPanel built. Cost/token/latency dashboards roadmap. |

   **What makes our version different from the conceptual image:**
   - Every component shows: built vs roadmap status
   - Every component is configurable via UI — not just code
   - HITL is a first-class component (absent from most frameworks)
   - Memory has 4 types with independent controls — not a single toggle
   - RAG has 3 dimensions — not just "connect a vector DB"
   - Agent Factory UI generates, deploys, and manages agents — the diagram shows the factory, not just the agent

   Structure — one page per capability:

   - **RAG page** — 3 columns (Dimension 1: Strategy, Dimension 2: KB Selection, Dimension 3: Pattern), each listing options with ✅ built / 🔲 roadmap. Below: two-row flow showing both stages (Pre-Graph and Planner Tool) with all 3 dimensions applied independently at each stage.
   - **Memory page** — 4 quadrants (Short-Term, Episodic, Semantic, Summary). Each quadrant: write trigger, storage today → roadmap backend, retrieval mechanism, known limitations. Color coded: green = built, amber = partial/limitation, grey = roadmap.
   - **HITL page** — flow diagram of full approval lifecycle. Branches for each approval pattern (Pattern 1 today through Pattern 4 fully external). Risk level: tool-level today → content-aware/dynamic roadmap. Adapter options with status.
   - **Tools page** — tool anatomy, bucketing hierarchy (Industry → LOB → State), built vs roadmap (bucket UI, semantic tool filtering, Lambda adapter).
   - **Observability page** — what exists today (trace panel, memory debug), what's roadmap (LLM Ops dashboards, cost/token tracking).
   - **Full execution flow page** — single diagram of a complete request from user message through pre-graph RAG, graph execution, HITL branch, memory write — all capabilities shown together, color coded today vs roadmap.

   Key principle: each visual mirrors exactly what the corresponding documentation section covers — same dimensions, same vocabulary, same structure.

13b. **Architecture diagram fixes** 🔲 — two issues to fix in `docs/platform-architecture-diagram.html`:
   1. **Font too small between layers** — connector labels and banner text between rows are hard to read; increase font sizes across both diagram versions
   2. **Supervisor UI label is misleading** — "Supervisor" is shown as a permanent user role box. In reality it only exists today because we have no external workflow system (Pega/Epic). When HITL adapter is wired to an external system, approvals happen there — not in a custom UI. Fix: relabel as "Supervisor UI (interim — replaces Pega/Epic until external HITL adapter is live)" or move it inside the Supervision/Observability section with a roadmap indicator.

14. **Goal Definition & Tracking** 🔲 — agents today answer one prompt at a time (stateless intent). Goal tracking gives an agent a persistent multi-step objective across turns: it knows what it's trying to achieve, which sub-steps are done, and whether the goal is met.

   **What a goal is:**
   A goal is a desired outcome that requires multiple tool calls and/or turns to complete. Example: "Complete pre-call assessment for member M-001" = sub-goals: get_member_summary ✅ → check open tasks ✅ → write case note ✅ → mark assessment complete ✅. The agent tracks state across turns until all sub-goals resolve.

   **How it works:**
   - Goal defined in `agent.yaml` or injected at runtime via payload (e.g. `goal: complete_pre_call_assessment`)
   - Goal schema defines: name, required sub-steps, success condition, timeout
   - LangGraph state carries goal progress — each node updates completed sub-steps
   - Planner is aware of goal state when deciding next tool call — avoids re-doing completed steps
   - Goal completion triggers a final summary response ("Assessment complete. All 5 tasks done.")

   **Why it matters:**
   - Without goal tracking: agent re-derives intent on every turn from scratch
   - With goal tracking: agent knows where it is in a workflow, picks up after HITL approval, recovers from failures
   - Required for `plan_execute` reasoning strategy to work properly
   - Required for multi-agent workflows where sub-agents report progress back to supervisor

   **Config shape:**
   ```yaml
   goal:
     enabled: true
     type: complete_assessment       # named goal type defined in agent.yaml
     success_condition: all_tasks_done
     timeout_turns: 10
   ```

   **Relationship to reasoning strategies:** goal tracking is what makes `plan_execute` meaningful — plan = goal decomposition, execute = track progress per sub-goal. Without it, plan_execute is just a fancier single-turn response.

   **Clarification — goal tracking vs workflow agent vs stateful memory (2026-04-09):**

   The agent is already stateful — short-term memory persists conversation history across all turns. A nurse can ask 10 questions and the agent remembers the full thread. Goal tracking is NOT needed for that.

   Goal tracking adds a structured task progress object on top:
   ```
   goal: complete_pre_call_assessment
   steps: [✅ get_member, ✅ get_case_summary, 🔲 risk_assessment, 🔲 write_case_note]
   status: in_progress
   ```
   Without it the agent can reconstruct progress from raw conversation history, but has no clean state object to read.

   **Two modes:**
   - **Explicit (recommended for care management)** — goal templates defined upfront in config. Known steps, auditable, predictable. Right for protocols with fixed steps.
   - **Emergent** — LLM infers goal and decomposes steps at runtime. More flexible, less reliable. Right for open-ended research agents.

   **Relationship to workflow agent:** goal tracking and workflow agent solve the same problem — multi-step task progress. Goal tracking is the lightweight in-agent version. Workflow agent (backlog 10k) is the full orchestration engine with branching, conditions, parallel steps, and handoffs. **Do not build goal tracking as a separate thing — it will be subsumed by workflow agent.** Build workflow agent when prioritized and get both at once.

   **Current chat panels (member/case/assessment)** are freeform Q&A — nurse asks a question, gets an answer. No structured protocol, no task progress needed. Stateful memory is sufficient for all three panels as they exist today. Goal tracking only becomes relevant when the nurse needs to follow a structured protocol (e.g. the actual pre-call assessment form with required fields). That is a workflow agent use case, not a chat panel use case.

   **When to build:** defer. Not needed for any currently built feature. Revisit when workflow agent is prioritized (backlog 10k).

14a. **Evaluation & Testing Framework** 🔲 — systematic way to measure agent output quality. Today there is no way to test whether a prompt change improved or degraded agent behavior, or whether a new tool works correctly end-to-end.

   **What it covers:**
   - **Test case library** — store input/expected_output pairs per agent (e.g. "query: summarize member M-001 → expected: member summary with risk score")
   - **Automated eval runs** — run a batch of test cases against a live agent, capture responses
   - **LLM-as-judge scoring** — use Claude to grade response quality (relevance, accuracy, tone, completeness) on a 1–5 scale per dimension
   - **Regression detection** — compare score distributions before/after a prompt or config change; flag regressions automatically
   - **RAG eval** — faithfulness (does response match retrieved chunks?), context precision (were the right chunks retrieved?), answer relevance (did retrieved chunks actually help?)
   - **HITL eval** — did risk scoring correctly flag the right tools? False positive/negative rate on approval triggers

   **Tools to consider:** Ragas (RAG eval), PromptFoo (prompt regression), custom LLM-as-judge via Claude.

   **UI — Evaluation tab in Agent Registry:**
   - Upload test cases (CSV or JSON)
   - Run eval against current config
   - View score dashboard per dimension
   - Compare runs (before/after config change)
   - Flag regressions with diff view

   **Why it matters:** without eval, every prompt change is a guess. With eval, you know in 2 minutes whether a change helped or hurt — across 50 test cases, not just the one you manually tested.

14b. **Logging & Feedback Loop** 🔲 — today the platform logs execution traces (TraceGraph in UI) but has no structured feedback mechanism and no learning loop.

   **What's missing:**
   - **Structured feedback capture** — nurse/user rates agent response (thumbs up/down, 1–5, free text). Stored per turn with full context (prompt, response, memory state, tools called).
   - **Feedback-driven improvement** — negative feedback triggers: flag for review, auto-run eval on similar test cases, suggest prompt adjustment
   - **Failure analysis** — when HITL is triggered and supervisor rejects: why? Capture rejection reason, store as labeled example, feed into eval suite
   - **LLM Ops dashboards** — cost per agent per day, token usage by component (planner/responder/RAG/memory), latency P50/P95, error rate, tool success rate. Today: none of this is visible.

   **Relationship to Evaluation (14a):** feedback is the runtime data source; evaluation is the offline scoring system. Together they form the improvement loop: feedback → test cases → eval run → prompt/config change → re-eval → deploy.

14c. **PowerPoint deck** 🔲 — platform story for stakeholders. Use capability visuals from 13a as the core slides.

15. **Platform Evolution Story** 🔲 — document how each dimension evolved from hardcoded → configurable → production-grade.

   | Dimension | V1 Hardcoded | V2 Configurable | V3 Production-grade |
   |---|---|---|---|
   | **Tool routing** | Hard-coded if/else phrases → CONTEXT_OVERRIDE patches | Hard routes + LLM free-text | Context-filtered tools + structured output + dynamic schema from registry |
   | **Memory** | No memory, stateless chat | Short-term (thread history) | Episodic + semantic + summary scopes, toggle per message, policy override |
   | **Retrieval (RAG)** | Hardcoded search_kb call | Tool-policy mode: selected/auto, tag filtering | Multi-RAG pattern (planned), hybrid retrieval strategy per tool |
   | **Observability** | Print logs only | Execution trace panel (TraceGraph), planner route metadata | LLM Ops: cost/token/latency dashboards (planned) |
   | **Agent config** | Hardcoded model, prompt in code | agent.yaml, prompt-defaults.yaml, prompt service override | Prompt Management UI, A/B testing, version history (planned) |
   | **Tool management** | Tools hardcoded in registry.py | Tool defined in registry + agent.yaml allowed list | Tool Gateway Admin UI: add/edit tools from UI, auto-appear in LLM schema (planned) |
   | **Agent scaffolding** | Manual copy-paste per usecase | Template-based generation from Admin UI | Full lifecycle: generate → configure → deploy → restart → delete |
   | **HITL** | No approval, agent writes directly | Tool-level risk_levels in agent.yaml, internal approval queue | Dynamic risk scoring per invocation, scenario-based rules engine, parallel approvals, external system executes (Pega/Epic) — agent only proposes |

---

6r. **Agent Registry — Inline config validation across all tabs** 🔲 — today most tabs save silently with no cross-field validation. Wrong config fails at runtime with no warning at save time. Add inline validation rules per tab so mismatches are caught before save.

   **Routing tab** ✅ (partially built):
   - Scope `id_field` must match tool `primary_arg` — mismatch shows orange warning banner
   - Tool must be in agent's allowed tools list (Tools tab) — warn if route tool is not in `tools.allowed`
   - Phrase list must not be empty before save — block save with error

   **Tools tab:**
   - Tool must exist in Tool Gateway registry — warn if tool name not found in gateway `/tools/specs`
   - `tools.mode: selected` with empty allowed list — warn: "no tools allowed, agent cannot call any tools"

   **RAG tab:**
   - `planner_tool.tool` must be in agent's allowed tools list — warn if `search_kb` (or configured tool) is not in `tools.allowed`
   - `pre_graph.top_k` and `planner_tool.top_k` must be > 0
   - `similarity_threshold` must be between 0 and 1
   - If `retrieval.enabled: false` but pre_graph or planner_tool enabled — warn: "retrieval is disabled globally, these settings have no effect"
   - If `retrieval.enabled: true` but both `pre_graph.enabled: false` AND `planner_tool.enabled: false` — warn: "RAG gate is on but no stage is active — RAG will not run. Enable at least one stage or turn off the gate."
   - Dim 1 (search strategy) and Dim 3 (retrieval pattern) should be per-stage config only, not at the gate level. Gate-level Dim 1/Dim 3 fields are confusing because they imply config scoped to the gate — move them inside each stage section and remove from gate. Gate = master on/off only.

   **HITL tab:**
   - Tool in `risk_levels` must exist in agent's allowed tools list — warn on unknown tool names
   - `hitl: true` (features) but `approval_required: false` — warn: "HITL is enabled but no approval trigger is active"
   - `routing_rules` must cover all risk levels present in `risk_levels` — warn if a tool's risk level has no matching routing rule

   **Memory tab:**
   - `write_on_tool_call.tools` list must only contain tools from the allowed tools list
   - Summary trigger `turn_count` or `token_threshold` with no threshold value set — warn: "trigger type requires a threshold value"
   - `write_intermediate_steps: true` on `simple` strategy — warn: "intermediate steps only apply to react/plan_execute strategies"

   **Implementation pattern:**
   - Each tab has a `validateConfig()` function that returns `Warning[]`
   - Warnings render as amber inline banners per field (not blocking save — warn only, except empty phrase list)
   - Same `validateConfig()` logic runs on the Overview tab's config summary so admin can see all warnings in one place without visiting each tab

---

## Reference: Runtime Chat Panel (InlineChatPanel) — Tab Coverage

Used at member, case, and assessment level in the care management UI. Three tabs:

| Tab | What it shows | Wired? |
|---|---|---|
| **Chat** | Full conversation, HITL pending approval, context-aware (passes member_id/case_id/assessment_id), thread persistence per context | ✅ |
| **Memory** | Live toggles (short_term/episodic/summary/semantic ON/OFF per message as `memory_policy_override`), planner route type (HARD_ROUTE vs LLM_ROUTE), router tool/mode, executor tool/status, what was written post-turn (episodic/short_term/summary/semantic), live episodic entries after HITL approval | ✅ `memory_trace` returned by runtime and read by UI |
| **Trace** | Execution graph via TraceGraph component — steps, tool calls, latency | ✅ |

**Memory tab gaps (not shown, in `memory_trace` but UI ignores):**
- `skipped.*` — which memory types were skipped and why
- `retrieved.*` — what was read from memory before the LLM ran
- `scopes` — which scopes were resolved for this invocation
- `policy_state` — effective per-type on/off after policy resolution

**Testing shortcut:** memory toggles in the Memory tab are per-message overrides — flip a toggle, send a message, see the effect without restarting the agent.

---

## Workspace + Capability UI Port Wiring 🔲

**Problem:** When Workspaces starts an agent, it resolves a port dynamically (8081, 8082, etc.). The capability UI (e.g. care management) has `VITE_API_PROXY_TARGET` hardcoded to `http://localhost:8081` in its `.env`. If the agent lands on a different port, the UI talks to the wrong place.

**Two things needed:**

1. **Write resolved port to capability UI `.env`** — when workspace starts an agent, look up which capability UI owns it and update `VITE_API_PROXY_TARGET` in that UI's `.env` with the resolved port.

2. **Restart the capability UI dev server** — Vite reads `.env` at startup only. After writing the port, the support API must kill and restart the Vite dev server process for the change to take effect. Today the dev server is started manually in terminal and the platform never touches it.

**Multi-capability implication:** each capability UI must have its own fixed port assignment (e.g. care-management always on 8081, another capability on 8082) so their UIs always proxy to the right agent. Port assignments should be defined in the registry record at scaffold time.

**Current workaround:** ensure agent always starts on 8081 (works as long as only one agent runs at a time).

---

## Observability Section — Agent Factory UI 🔲

New left nav section in Agent Factory UI with 2 menu items. **Agent + reasoning strategy selector at the top** (same dropdown pattern as Config Lab `5b`) — Lineage and Metrics views adapt to what that agent type actually ran:

- `chat_agent / simple` → pre-graph RAG → planner → tool → responder → post-graph memory
- `chat_agent / react` → thought → action → observation (loop) → responder
- `summarization_agent / simple` → parallel tool calls → LLM synthesis → no memory write
- `multi_agent / supervisor` → supervisor → sub-agents → merge → response

Each step shows its own latency, tokens, and cost. Sections show/hide based on what actually ran — not hardcoded per agent type.

### Lineage
Per-message full chain — one unified Lineage Panel per message, clickable from chat history. Content adapts by agent type, reasoning strategy, and RAG pattern:

- **Prompt version used** — which prompt version was active for this turn
- **Memory read** — which memory items (short_term, episodic, semantic, summary) were retrieved and injected
- **Documents retrieved** — per RAG retrieval: document name, chunk text, similarity score. Multi-hop shows multiple retrieval blocks chained.
- **Planner decision** — route type (HARD_ROUTE / LLM_ROUTE), tool selected, reasoning
- **Tool called** — tool name, input, output
- **HITL approval** — approval_id, who approved, timestamp (section hidden if no HITL)
- **Response** — final answer
- **Memory written** — what was written post-turn (episodic, short_term, semantic, summary) and to which scope

Sections show/hide based on what actually ran for that turn. Applies across all agent types (chat, summary, react), reasoning strategies (simple, react, plan_execute), and RAG patterns (naive, multi_hop, hyde, agentic, none).

**RAG lineage gap to fix first:** today RAG runner fetches chunks but doesn't store which documents/chunks were used. Need to record document_name, document_id, chunk_id, chunk_text, similarity_score alongside each invocation response.

**Display:** Sources tab in runtime chat panel (per message clicked), full lineage in Agent Factory Observability → Lineage view.

### Metrics
Per-turn observability grid for a given agent:
- Columns: turn, timestamp, total latency, tokens at each step (planner, tool, responder), total tokens
- Rows: every invocation turn
- Filterable by date range, agent type, thread_id

---

## Overlay Structure Refactor — Split by Agent Type + Reasoning Strategy 🔲 ⭐ NEXT PRIORITY

**Problem:** Today the overlay folder is just `chat_agent/` on disk but the Create Agent dropdown already shows `chat_agent — simple`, `chat_agent — ReAct`, `chat_agent — Plan & Execute` etc. The file structure doesn't match the UI — scaffolding always copies the same `chat_agent/` overlay regardless of reasoning strategy selected.

**Required structure:**
```
templates/agent-runtime-template/overlays/
  chat_agent_simple/
  chat_agent_react/
  chat_agent_plan_execute/
  chat_agent_chain_of_thought/
  summarization_agent/
  workflow_agent_simple/
  workflow_agent_react/
  multi_agent_supervisor/
  multi_agent_supervisor_hitl/
```

**Each overlay contains:**
- `agents/` — planner, executor specific to that reasoning strategy
- `config/agent.yaml` — pre-set reasoning.strategy locked to that overlay type
- `config/memory.yaml`
- `config/prompt-defaults.yaml` — prompts formatted for that strategy (ReAct needs thought/action/observation, simple needs tool:argument)
- `agent_manifest.yaml` — agent_type + reasoning strategy declared
- `orchestration/build_graph.py` — graph wired for that strategy
- `ui/` — mini standalone test UI for that agent type (chat panel for chat agents, context+output for summary agent)

**Why do this next:** wrong structure now = refactor everything later. UI dropdown is already correct, file structure needs to catch up.

**Existing agents affected:** `agents/care-management/pre-call-assessment/overlays/chat_agent/` needs to be renamed to `chat_agent_simple/` and re-registered.

---

## Reference: All Agent Types + Reasoning Strategies

Industry and enterprise aligned. Used to drive overlay structure refactor.

| Agent Type | Strategies | Notes |
|---|---|---|
| **chat_agent** | simple, react, plan_execute, chain_of_thought, self_corrective, reflection | Conversational, user-facing, memory-heavy |
| **summarization_agent** | simple, map_reduce, hierarchical | Batch, no conversation loop. Strategies from LangChain summarization chains (stuff/map_reduce/refine) |
| **workflow_agent** | simple, react, plan_execute | Executes defined step sequences, less conversational |
| **multi_agent** | supervisor, supervisor+HITL, hierarchical | Coordination patterns not reasoning loops — sub-agents each have their own reasoning strategy independently |

**Key distinctions:**
- chat_agent strategies = reasoning loop patterns (how the agent thinks)
- summarization_agent strategies = document processing patterns (how context is chunked/combined)
- multi_agent strategies = coordination patterns (how agents are orchestrated)

**Currently built:** chat_agent/simple ✅, summarization_agent/simple ✅

---

## Reference: Overlay Type × Agent Type × Reasoning Strategy Matrix

Each overlay = one deployable agent = one agent_type + one reasoning strategy combination. New overlays add capability without changing platform code.

| Overlay Name | Agent Type | Reasoning Strategy | RAG | Memory | HITL | Status | Notes |
|---|---|---|---|---|---|---|---|
| `chat_agent_simple` | chat_agent | simple | optional | full | yes | ✅ built | Deliberate cost optimization — 2 LLM calls |
| `chat_agent_react` | chat_agent | react | optional | full | yes | ✅ built | Default production chat agent |
| `chat_agent_plan_execute` | chat_agent | plan_execute | optional | full | yes | ✅ built | Multi-tool queries, fixed LLM cost |
| `chat_agent_multi_hop` | chat_agent | multi_hop | optional | full | yes | 🔲 roadmap | Multi-step research queries — needs 10n |
| `chat_agent_reflection` | chat_agent | reflection | optional | full | yes | 🔲 roadmap | High-stakes decisions, self-critique loop |
| `chat_agent_tree_of_thought` | chat_agent | tree_of_thought | optional | full | yes | 🔲 roadmap | Research-grade, most expensive |
| `summarization_agent_simple` | summarization_agent | simple | ❌ locked | limited | ❌ locked | ✅ built | Structured data via tools, single LLM pass |
| `summarization_agent_rag` | summarization_agent | simple + pre-graph RAG | ✅ required | limited | ❌ locked | 🔲 roadmap | KB-enriched summaries — see item below |
| `summarization_agent_map_reduce` | summarization_agent | map_reduce | optional | limited | ❌ locked | 🔲 roadmap | Long-document batch summarization |
| `workflow_agent_simple` | workflow_agent | simple | optional | limited | yes | 🔲 future | Fixed step sequence, no reasoning loop |
| `workflow_agent_react` | workflow_agent | react | optional | limited | yes | 🔲 future | Adaptive workflow with tool reasoning |
| `workflow_agent_plan_execute` | workflow_agent | plan_execute | optional | limited | yes | 🔲 future | Pre-planned multi-step workflow |
| `multi_agent_supervisor` | multi_agent | supervisor | optional | shared | yes | 🔲 future | One supervisor + N specialist sub-agents |
| `multi_agent_supervisor_hitl` | multi_agent | supervisor+HITL | optional | shared | ✅ required | 🔲 future | Supervisor with human approval gates |
| `multi_agent_hierarchical` | multi_agent | hierarchical | optional | shared | yes | 🔲 future | Multi-level agent tree |

**How to read:**
- **RAG = locked off** → agent uses tool calls to fetch structured data. No vector search needed.
- **RAG = optional** → agent can enable pre-graph KB retrieval and/or planner_tool RAG in agent.yaml.
- **RAG = required** → agent type depends on pre-graph RAG to function (e.g. `summarization_agent_rag` enriches with KB docs before summarization pass).
- **Memory = full** → all 4 types (short-term, episodic, semantic, summary) configurable.
- **Memory = limited** → short-term only for batch agents; episodic/semantic locked off (no conversation loop to write from).
- **Memory = shared** → multi-agent workflows share a memory namespace; supervisor and sub-agents read/write same store.

---

10o. **`summarization_agent_rag` overlay — KB-enriched summary agent** 🔲

Two types of summaries exist:

**Type 1 — Structured data summary (today, `summarization_agent_simple`):**
- Source: tool calls fetching structured records (assessments, care plans, clinical notes)
- Process: tool outputs → single LLM synthesis pass
- RAG: not needed. Data is already structured, fetched by ID, no vector search required.
- Overlay: `overlays/summarization_agent_simple/` ✅ built

**Type 2 — Knowledge-enriched summary (`summarization_agent_rag`):**
- Source: tool calls + pre-graph RAG retrieval from KB (clinical guidelines, evidence, protocols)
- Process: RAG retrieves relevant KB context → injected into LLM context → synthesis pass uses both structured data AND retrieved knowledge
- RAG: required — `retrieval.pre_graph.enabled: true`, embedding over KB documents
- Overlay: `overlays/summarization_agent_rag/` 🔲 not yet built
- Use case: "summarize member's condition and flag relevant clinical guidelines from KB"

**Why a new overlay (not a flag on the existing agent):**
- Pre-graph RAG changes the graph shape — a new retrieval node runs before the planner
- Different prompt templates — the LLM must be told to use both structured data AND KB context
- Different agent.yaml — `retrieval.pre_graph.enabled: true`, `rag.pre_graph.top_k`, `rag.pre_graph.embedding_model`
- Separate overlay = zero risk to the existing simple agent, independent deployable unit

**Files to create (new overlay):**
```
overlays/summarization_agent_rag/
  config/
    agent.yaml         ← retrieval.pre_graph.enabled: true, rag settings
    memory.yaml        ← same as simple (limited memory)
    prompt-defaults.yaml ← updated prompts — instruct LLM to use KB context
  agents/
    summarizer.py      ← modified to inject RAG context before synthesis
  orchestration/
    build_graph.py     ← new pre-graph RAG node wired before summarizer
```

**Dependency:** RAG wiring must be fully validated in chat_agent before porting to summarization_agent_rag. Shared platform-core retriever.py handles both — no duplication.

---

## Reference: Invalid Overlay Permutations

Not every agent_type × reasoning_strategy combination is valid. The rule: **reasoning loops only make sense for agents that don't know upfront what they need.** Batch and single-pass agents are always one-shot by design.

| Agent Type | ❌ Invalid Strategies | Reason |
|---|---|---|
| `summarization_agent` | react, multi_hop, reflection, tree_of_thought | You know upfront what data to fetch. No discovery loop needed. |
| `extraction_agent` | react, plan_execute, multi_hop, reflection, tree_of_thought | Single pass: text in → structured fields out. Nothing to iterate over. |
| `triage_agent` | react, plan_execute, multi_hop, reflection, tree_of_thought | Classify and route — always one step. |
| `monitoring_agent` | multi_hop, reflection, tree_of_thought | Check threshold → alert. react valid if investigation needed, nothing else. |
| `workflow_agent` | multi_hop, tree_of_thought | Workflow = executing steps, not researching questions or exploring branches. |
| `retrieval_agent` | reflection, tree_of_thought | Search doesn't need self-critique loops or branch exploration. |

**`plan_execute` is the universal exception** — it's not a loop, it's "plan all fetches upfront, execute in parallel." Any agent that calls multiple tools can benefit from it regardless of type.

**Enforcement:** Agent Factory dropdown must filter valid strategies per agent_type selected. Invalid combinations are not shown, not just disabled. Selecting `summarization_agent` collapses the strategy dropdown to: `simple`, `map_reduce`, `hierarchical`. Selecting `triage_agent` shows only `simple`.

---

## Reference: Prompt Strategy Alignment

**Prompts must align to overlay (agent_type + reasoning_strategy).** `prompt-defaults.yaml` is per overlay — not per agent_type alone, not per capability.

Wrong prompt on wrong strategy = broken agent at runtime (LLM outputs wrong format, graph state fails to parse).

| Strategy | Prompts Required | Prompt Structure |
|---|---|---|
| `simple` | `planner_system_prompt` | Pick one tool, return tool + argument. No thought field. CoT instructions are wasted here — graph has no thought field. |
| `react` | `react_planner_system_prompt` | Must include `Thought: <reasoning> / Action: <tool>(<arg>)` format. Loop continues until LLM outputs DONE in Thought. |
| `plan_execute` | `plan_execute_planner_system_prompt` | Output full ordered plan as JSON list before executing anything. Format: `[{tool, argument}, ...]` |
| `multi_hop` | `decomposer_system_prompt` + `sub_planner_system_prompt` + `synthesizer_system_prompt` | Three distinct prompts, each for a different LLM role in the graph. |
| `reflection` | `planner_system_prompt` + `responder_system_prompt` + `reflector_system_prompt` | Reflector must output `{issues_found: bool, critique: str, suggested_correction: str}` |
| `tree_of_thought` | `branching_planner_system_prompt` + `branch_evaluator_system_prompt` + `synthesizer_system_prompt` | Evaluator scores branches before pruning; synthesizer selects best path. |

**Agent type also constrains prompt content** (independent of strategy):

| Agent Type | Prompt Content Requirements |
|---|---|
| `chat_agent` | Conversational tone, memory-aware (reference prior turns), scope-aware (reference member/case context) |
| `summarization_agent` | Synthesis-focused, structured output format (key concerns, next steps), no conversational tone |
| `extraction_agent` | Strict structured output schema (JSON fields), no CoT, no explanation — just extract |
| `triage_agent` | Fixed classification labels in prompt, route decision output only |
| `monitoring_agent` | Threshold language, alert vs no-alert decision, no explanation needed |
| `retrieval_agent` | Query reformulation instructions, source citation format, groundedness requirement |
| `workflow_agent` | Step execution instructions, handoff format between steps |

**Full alignment rule:** `prompt-defaults.yaml` per overlay = agent_type content requirements × strategy format requirements. Neither alone is sufficient.

**UI enforcement (Agent Registry → Prompts tab):**
- Detect strategy from `agent.yaml` → show required prompt fields for that strategy
- Warn if a required prompt field is empty (e.g. `reflector_system_prompt` missing on `reflection` strategy)
- Warn if `strategy: simple` but prompt contains CoT instructions (Thought/Action format wasted)
- Block save if any required prompt for the active strategy is missing

---

## Reference: Pre/In/Post Graph — Universal for All Agent Types

The 3-phase boundary applies to every valid overlay combination. What changes is what runs inside each phase, not the phases themselves.

| Phase | What always runs | What varies by agent type |
|---|---|---|
| **Pre-graph** | Memory read, RAG retrieval (if enabled), context build | Batch agents (extraction, triage, monitoring) load less context — no episodic memory read. summarization_agent_rag runs pre-graph KB retrieval here. |
| **In-graph** | Reasoning loop (planner → executor → responder) | Graph shape changes per strategy: simple = 2 LLM calls, react = loop, plan_execute = plan then parallel execute, multi_hop = decompose → sub-plans → synthesize |
| **Post-graph** | Memory write, HITL evaluation, response formatting | Batch agents skip episodic/semantic write — no conversation to record. HITL evaluation only runs for agent types with HITL enabled. |

**Same boundary. Different contents per overlay.**

---

## Reference: Agent Registry Config Dimensions — All Agent Types

Every agent type has the same config dimensions in Agent Registry. The Agent Capability Matrix determines which options are visible, locked, or required per agent type.

| Config Dimension | chat_agent | summarization_agent | extraction_agent | triage_agent | monitoring_agent | workflow_agent | multi_agent |
|---|---|---|---|---|---|---|---|
| **RAG** | optional | simple=off / rag=required | locked off | locked off | locked off | optional | optional |
| **HITL** | optional | locked off | locked off | locked off | locked off | optional | supervisor+HITL=required |
| **Memory** | full (all 4 types) | limited (short-term only) | locked off | locked off | locked off | limited | shared namespace |
| **Tools** | configurable | configurable | configurable | configurable | configurable | configurable | per sub-agent |
| **Prompts** | required (strategy-driven) | required | required | required | required | required | per sub-agent |
| **Routing** | yes | no | no | yes (it IS routing) | no | no | at supervisor level |

**Rule:** platform structure is uniform. The Agent Capability Matrix (backlog 3d) drives which tabs are shown, which fields are locked, and which fields are required per agent type. Same Agent Registry UI for all — different valid config space per type.

**triage_agent special case:** Routing tab IS the config for this agent type — classify input → route to agent/workflow. It has no planner loop, the routing logic is the entire agent behavior.

**multi_agent special case:** Config at the supervisor level controls orchestration. Each sub-agent has its own full overlay config independently — the supervisor's Agent Registry shows which sub-agents are wired, not their internal config.

---

## Reference: Observability — Per Overlay

Every overlay emits the same trace event structure (pre-graph, in-graph steps, post-graph). What differs is the payload inside each event. The observability engine is shared — the trace content is overlay-specific.

| Overlay / Strategy | What the trace captures |
|---|---|
| `simple` | 2 LLM calls (planner + responder), 1 tool call, tool output |
| `react` | N loop iterations — each with thought + action + observation. Loop count, which tools called, in what order. |
| `plan_execute` | The full plan (ordered tool list), each tool result, final synthesis call |
| `multi_hop` | Sub-questions generated, tool call per sub-question, sub-answers, final synthesis |
| `reflection` | Initial answer, reflector critique, whether retry triggered, final answer delta |
| `tree_of_thought` | Branches explored, evaluator score per branch, pruned branches, winning path |
| `summarization_agent` | Tool outputs fetched, synthesis LLM call, structured output fields |
| `extraction_agent` | Input text (truncated), extracted fields, confidence score per field |
| `triage_agent` | Input, classification label, confidence, route decision |
| `monitoring_agent` | Metric values checked, threshold comparison, alert triggered or not |
| `workflow_agent` | Each step: tool called, input/output, handoff to next step |
| `multi_agent` | Supervisor decision, which sub-agent invoked, sub-agent trace (nested), aggregation |

**Pre/in/post graph trace events are always emitted regardless of overlay:**
- `pre_graph_complete` — memory loaded, RAG retrieved (if enabled), context built. Duration + token count.
- `in_graph_step` — one event per step inside the graph. Step type (LLM/tool/internal), duration, input/output.
- `post_graph_complete` — memory written, HITL evaluated (if enabled), final response. Duration.

**Same trace schema. Different fields populated per overlay.**

---

## Reference: Evaluation — Per Overlay

Same eval framework and runner. Metric set is overlay-specific — what "good" means differs per agent type and strategy.

| Agent Type / Strategy | What to evaluate | Metrics |
|---|---|---|
| `chat_agent` (any strategy) | Answer quality, groundedness vs tool output, tool selection correctness, memory recall accuracy | LLM-as-judge score, groundedness %, tool selection accuracy, memory hit rate |
| `summarization_agent` | Completeness vs source data, factual accuracy, hallucination rate | ROUGE/BLEU vs source, LLM-as-judge completeness score, hallucination flag rate |
| `extraction_agent` | Field accuracy vs ground truth, recall and precision per field | Exact match %, F1 per field, missed field rate |
| `triage_agent` | Classification accuracy, routing correctness | Accuracy, precision/recall per class, confusion matrix, misroute rate |
| `monitoring_agent` | Alert correctness — false positive rate, missed threshold rate | Alert precision, alert recall, false positive %, threshold replay accuracy |
| `workflow_agent` | Step completion rate, correct handoff between steps, output correctness per step | Step success rate, handoff accuracy, final output quality |
| `multi_agent` | Sub-agent selection correctness, aggregation quality, end-to-end answer quality | Sub-agent routing accuracy, aggregation LLM-as-judge, end-to-end golden set score |
| **`react` strategy (any type)** | Loop efficiency — right tools, right order, no unnecessary iterations | Loop count, tool selection accuracy, unnecessary iteration rate |
| **`reflection` strategy** | Did reflection catch real errors? Did retry improve score? | Grade delta before/after retry, false critique rate, retry trigger rate |
| **`plan_execute` strategy** | Was the plan correct upfront? Were all planned tools necessary? | Plan accuracy vs optimal, unnecessary tool rate, plan revision rate |
| **`multi_hop` strategy** | Sub-question quality, sub-answer accuracy, synthesis coherence | Sub-question coverage score, sub-answer accuracy, synthesis coherence score |

**Eval framework components (shared across all overlays):**
- **Golden set** — ground truth input/output pairs per overlay. Stored per agent type.
- **Eval runner** — replays golden set against live agent, collects trace + response.
- **Metric calculator** — applies overlay-specific metric set to trace + response.
- **Eval report** — per-run score breakdown by metric, regression detection vs prior run.
- **LLM-as-judge** — shared grader LLM call used by chat, summarization, workflow, multi_agent overlays.

**Observability and eval are linked:** eval runner reads from the trace to compute strategy-level metrics (loop count, plan accuracy, reflection delta). You cannot compute strategy metrics without the trace.

---

## Gap Analysis: Agentic Design Patterns Book — Missing from Platform

Source: "Agentic Design Patterns: A Hands-On Guide to Building Intelligent Systems" (Antonio Gulli, 424 pages). Cross-referenced against all platform capabilities. 10 patterns identified as missing.

---

15. **Learning & Adaptation** — ⛔ OUT OF SCOPE

   RLHF, DPO, and model fine-tuning are not platform responsibilities. Updating foundation model weights requires GPU clusters, training pipelines, and ML ops infrastructure — this is what Anthropic/OpenAI do when releasing a new model version. Enterprises do not fine-tune foundation models for agent Q&A workflows.

   **What we have that covers the practical enterprise version:**
   - Semantic memory write — agent learns facts about members/cases across conversations. Context improves over time without touching model weights.
   - Eval framework — quality scores per run feed back into prompt improvements and config tuning.

   This is the correct level of adaptation for an enterprise agent platform. Model fine-tuning is out of scope.

---

16. **MCP — Model Context Protocol** ✅ COVERED BY TOOL GATEWAY

   Our Tool Gateway (C3) IS the MCP concept — a server that exposes tools, agents call it, tools execute and return results. Same architecture, our own protocol format.

   **Future integration detail (not missing design):** if external agents from other companies need to call our tools, we add an MCP-compatible interface on top of the Tool Gateway. That's a thin adapter layer, not a missing platform concept. Config shape for when needed:

   ```yaml
   tools:
     gateway: internal           # our Tool Gateway (primary)
     mcp_servers:                # future: external MCP-compatible tool servers
       - url: https://salesforce.example.com/mcp
         auth: apikey
   ```

---

17. **Exception Handling & Recovery patterns** 🔲 — systematic infra-level failure handling at the platform level. `self_corrective` covers quality retry (bad answer → retry with feedback). Missing: infra failures (tool timeout, model API error, network failure).

   **Patterns needed:**
   - **Retry with backoff** — tool call fails → retry N times with exponential backoff before escalating
   - **Fallback model** — primary model (e.g. Opus) unavailable → fall back to secondary (e.g. Sonnet) automatically
   - **Circuit breaker** — tool repeatedly failing → stop calling it for T seconds, return cached/default response
   - **Graceful degradation** — RAG retrieval fails → proceed without context, flag in response that KB was unavailable
   - **Timeout handling** — tool call exceeds timeout → cancel, log, return partial result

   **Config shape:**
   ```yaml
   resilience:
     retry:
       max_attempts: 3
       backoff: exponential
     fallback_model: claude-sonnet-4-6
     circuit_breaker:
       threshold: 5          # failures before opening
       reset_after: 60       # seconds
     timeout_ms: 5000
   ```

   **Where it lives:** platform-core, not per-agent. Every agent benefits automatically. Configured in agent.yaml but enforced by platform-core executor.

---

18. **A2A — Agent-to-Agent Protocol** 🔲 — Google's open standard for cross-framework agent communication. Allows agents built on different frameworks (LangGraph, CrewAI, Google ADK) to call each other over HTTP as peer services.

   **Core concepts:**
   - **Agent Card** — JSON identity file describing the agent's capabilities, endpoint URL, supported input/output modes, auth requirements
   - **Agent Discovery** — well-known URI (`/.well-known/agent.json`), curated registry, or direct config
   - **Tasks** — async units of work with state (submitted → working → completed). Long-running support.
   - **JSON-RPC 2.0** over HTTP(S) — all communication

   **What we have:** multi_agent type with internal supervisor → sub-agent calls. Not interoperable with external agents.

   **What's missing:**
   - Each agent runtime exposes an A2A-compatible endpoint
   - Agent Card generated from agent.yaml at startup
   - Agent Factory registers agents in a central A2A discovery registry
   - Supervisor agent can call external A2A agents (not just internal sub-agents)

   **Why it matters:** A2A is backed by Atlassian, Box, LangChain, MongoDB, Salesforce, SAP, ServiceNow, Microsoft (Azure AI Foundry). This is becoming the interoperability standard for enterprise multi-agent systems.

---

19. **Resource-Aware Optimization** 🔲 — dynamic model routing and cost optimization. Route each query to the cheapest model that can handle it correctly. Simple queries → fast/cheap model. Complex queries → powerful/expensive model.

   **Pattern:**
   1. Classify query complexity (simple / reasoning / search / complex) — lightweight classifier LLM call or heuristic
   2. Route to appropriate model based on classification
   3. Monitor quality score per model tier — if Flash consistently underperforms on a query type, adjust routing threshold

   **Model tiers (example):**
   - `simple` — factual lookup, single-turn → Haiku 4.5
   - `reasoning` — multi-step logic → Sonnet 4.6
   - `complex` — research, synthesis, high-stakes → Opus 4.6

   **Config shape:**
   ```yaml
   model_routing:
     enabled: false           # opt-in
     classifier: heuristic    # heuristic | llm
     tiers:
       simple:
         model: claude-haiku-4-5-20251001
         max_tokens: 500
       reasoning:
         model: claude-sonnet-4-6
         max_tokens: 2000
       complex:
         model: claude-opus-4-6
         max_tokens: 8000
   ```

   **Relationship to existing platform:** reasoning strategy already does basic cost optimization (`simple` = 2 LLM calls). Model routing adds a second dimension: not just fewer calls but cheaper model per call.

---

20. **Graph RAG** ✅ ALREADY IN DESIGN — Graph is a Dim 1 retrieval method option, same axis as `semantic | keyword | hybrid`. The Dim 1 router decides which store to query (vector DB, keyword index, or knowledge graph). Graph RAG = set `retrieval.method: graph` in agent.yaml → retriever queries the knowledge graph store instead of vector DB.

   **Entities = nodes, relationships = edges. Retrieval navigates graph relationships, not vector similarity.**

   Use cases: interconnected entity queries ("How does gene X relate to disease Y through pathway Z?"), complex financial analysis (company → events → market impact chain), clinical knowledge networks.

   **Store implementation (backlog for Tool Gateway / C3):** Neo4j or equivalent alongside vector store. Graph traversal retriever: entity extraction from query → graph walk → context assembly. Higher setup cost but better for relational queries than vector similarity.

   **Applies to both Dim 2 stages:** pre-graph retrieval and planner_tool retrieval both benefit from graph method — same Dim 1 option, same router, different store backend.

---

21. **Agentic RAG** ✅ ALREADY IN DESIGN — `agentic` is a Dim 3 retrieval pattern option (`retrieval.pattern: agentic`). Dim 3 pattern is orthogonal to Dim 2 stage — setting `pattern: agentic` applies to ALL active Dim 2 stages (pre-graph AND planner_tool).

   **What Agentic RAG does as Dim 3 pattern (applies after any Dim 1 retrieval, at any Dim 2 stage):**
   - **Source validation** — check document recency/authority, discard outdated or low-authority sources before injecting
   - **Conflict reconciliation** — two retrieved docs contradict → agent decides which is authoritative
   - **Knowledge gap detection** — retrieved docs don't cover the query → trigger gap_fallback_tool (web search, live API) instead of hallucinating
   - **Multi-step decomposition** — complex query decomposed into sub-queries, each retrieved separately, synthesized

   **Config shape:**
   ```yaml
   retrieval:
     pattern: agentic        # Dim 3 — applies to all active Dim 2 stages
     agentic:
       source_validation: true
       conflict_resolution: true
       gap_detection: true
       gap_fallback_tool: web_search
   ```

   **This was already named in our RAG design as a Dim 3 pattern. This entry clarifies what it means in implementation detail.**

---

22. **CoD — Chain of Debates** 🔲 — multiple distinct models collaborate and argue to reach a better answer. Each model presents an answer, critiques others' answers, exchanges counterarguments, and a final synthesis is produced. Reduces individual model bias, improves accuracy.

   **How it differs from `reflection` strategy:** reflection = single model critiques itself. CoD = multiple different models critique each other. Peer review vs self-review.

   **Graph shape:**
   - Model A generates answer → Model B critiques → Model A responds to critique → Model C arbitrates → Synthesis

   **Overlay:** `chat_agent_chain_of_debates` — new overlay, not just a reasoning strategy. Requires multiple model instances configured per overlay.

   **Config shape:**
   ```yaml
   reasoning:
     strategy: chain_of_debates
     participants:
       - model: claude-opus-4-6
         role: proposer
       - model: claude-sonnet-4-6
         role: critic
       - model: claude-opus-4-6
         role: arbitrator
     rounds: 2
   ```

   **Use cases:** high-stakes clinical decisions, legal analysis, financial risk assessment — anywhere where single-model bias is unacceptable.

---

23. **GoD — Graph of Debates** 🔲 — non-linear debate network. Arguments are graph nodes, edges = `supports` or `refutes` relationships. New lines of inquiry branch dynamically. Conclusion = most well-supported cluster of arguments in the graph, not the end of a sequence.

   **How it differs from CoD:** CoD is a linear chain of critique rounds. GoD is a graph — arguments can branch, merge, refute multiple prior nodes. More robust for complex multi-faceted problems.

   **Overlay:** `chat_agent_graph_of_debates` — research-grade, expensive, similar priority to `tree_of_thought`.

   **Use cases:** strategic planning, policy analysis, complex research synthesis. Not for everyday queries.

---

24. **Contractor / Formal Specification pattern** 🔲 — agent executes against a formal contract rather than a free-form prompt. Contract defines: deliverables, validation criteria, quality thresholds, deadline. Agent self-validates output before submission. Can decompose into subcontracts.

   **Four pillars (from book):**
   1. **Formal specification** — contract defines exact deliverables and validation criteria upfront
   2. **Negotiation** — agent can clarify ambiguities before accepting the contract
   3. **Quality-focused execution** — agent generates multiple approaches, validates each against contract criteria, submits only the version that passes
   4. **Hierarchical decomposition** — primary contractor breaks contract into subcontracts, delegates to sub-agents

   **Relationship to existing platform:** this is an evolution of multi_agent + HITL + plan_execute. The "contract" is a structured form of the goal + validation criteria. Closest to `workflow_agent_plan_execute` with formal output validation.

   **Config shape:**
   ```yaml
   execution_mode: contractor   # default: conversational
   contract:
     deliverable: "Python function that sorts a list"
     validation:
       - type: unit_test
         test_suite: tests/sort_test.py
       - type: quality_check
         metrics: [performance, security, readability]
         threshold: 0.8
     max_attempts: 3
   ```

   **New agent type implied:** `contractor_agent` — distinct from workflow_agent. Workflow executes steps; contractor self-validates output quality against formal criteria.

---

25. **Event-Driven Agents** 🔲 — agents triggered by external events, not user requests. Today all agents are request-response (`/chat`, `/invocations`, `/summarize`). In production most enterprise agents are event-driven — they wake up when something happens, process it, take action, go back to sleep.

   **Event sources:**

   | Source | Example | Agent Triggered |
   |---|---|---|
   | Webhook | New lab result uploaded to EHR | pre-call assessment agent |
   | Message queue (Kafka/SQS/Pub/Sub) | Order placed | fulfillment workflow agent |
   | Database CDC (change data capture) | Patient record updated | extraction/summarization agent |
   | File upload | New document added to KB | ingestion/indexing agent |
   | Scheduled timer (cron) | Every night at 2am | monitoring/reporting agent |
   | API callback | Payment confirmed | notification agent |
   | Threshold breach | Metric crosses limit | monitoring agent |

   **What needs to be built:**
   - **Event source connectors** — webhook receiver, queue consumer (SQS/Kafka), CDC listener, cron scheduler. Each connector normalizes its event into a standard `AgentEvent` schema.
   - **Event router** — maps event type + payload fields → which agent to invoke with what context. Config-driven: `event_routing.yaml` per capability.
   - **Async execution model** — fire-and-forget (trigger agent, don't wait) vs fire-and-track (trigger agent, poll for result via task ID). Long-running agents need fire-and-track.
   - **Event acknowledgment** — at-least-once delivery guarantee. Event is not acked until agent completes successfully. On failure: retry with backoff, then dead-letter queue.

   **Standard AgentEvent schema:**
   ```json
   {
     "event_id": "uuid",
     "event_type": "lab_result_uploaded",
     "source": "ehr_webhook",
     "timestamp": "2026-04-13T10:00:00Z",
     "payload": {
       "member_id": "M123",
       "case_id": "C456",
       "result_type": "HbA1c"
     }
   }
   ```

   **Event routing config (event_routing.yaml per capability):**
   ```yaml
   routes:
     - event_type: lab_result_uploaded
       agent: pre_call_assessment
       context_mapping:
         member_id: payload.member_id
         case_id: payload.case_id
     - event_type: document_uploaded
       agent: summarization_agent_simple
       context_mapping:
         document_id: payload.document_id
   ```

   **Relationship to existing platform:** event-driven is a trigger mechanism, not a new agent type. Any existing agent type (chat_agent, summarization_agent, workflow_agent, monitoring_agent) can be event-triggered. The agent runtime already has `/invocations` — event-driven adds a layer that calls `/invocations` automatically when an event fires.

   **monitoring_agent is the most natural fit** — already designed to run on a schedule or threshold. Event-driven gives it the trigger infrastructure it needs.

   **All agent types benefit:** pre-call assessment triggered by patient admission event, summarization triggered by document upload, extraction triggered by EHR record change, workflow triggered by order placement.

---

## Design Assessment — 8-Dimension Stress Critique

**Methodology:** Red team + implementation reality check + frontier benchmarking. Scored 1–10 with honest notes on intent vs built vs battle-tested. Captured here to inform future design decisions and backlog prioritization.

| # | Dimension | Today | Post v1.0 | Honest note |
|---|---|---|---|---|
| 1 | Architectural Complexity | 7/10 | 7/10 | Production-grade, not frontier research. 4-container split may over-scope for small payers. |
| 2 | Engineering Discipline | 7.5/10 | 8/10 | Policy-as-code split is well-reasoned. 24-week plan is optimistic; offshore-heavy = knowledge-transfer risk. |
| 3 | Pattern Selection & Execution | 8/10 (intent) | 8/10 (verified) | Same patterns PwC validated. Execution score depends on code audit. |
| 4 | Pattern Novelty | 5–6/10 (intentional) | 5–6/10 | Established patterns = production-ready, low research risk. Not a weakness for SI. |
| 5 | Architecture Objectives | 8/10 (intent) / 6–7 (built) | 8/10 | Documented intent strong. Customer ownership + Four Modes unproven in real engagement. |
| 6 | Pattern Application & Reuse | 7/10 | 7.5/10 | Template + scaffold + overlay matrix is strong. No pattern recommendation / analytics / evolution. |
| 7 | Adoption / Distribution | 7/10 | 8/10 | Git-native + CODEOWNERS + full IP transfer beats Big 4 peers. Manual fork creation; unproven until first engagement. |
| 8 | Code Quality & Hygiene | 6–7/10 (tentative) | 8/10 (post-audit) | Not directly reviewed. Architectural thoughtfulness is positive signal; prototype gaps expected. Phase 1 audit required. |
| | **Overall** | **~6.8–7/10** | **~7.5/10** | |

**Dimension-level red-team notes:**

- **#3 Pattern Execution:** Based on design docs, not verified against running code. Phase 1 audit confirms or adjusts.
- **#5 Architecture Objectives:** Customer-deployed model, Four Modes, HIPAA compliance claim — all documented intent; none proven in a real customer engagement yet. First customer will stress-test.
- **#7 Adoption Model:** Master repo not yet created (Phase 1 pre-req). Manual fork creation, no automated master→fork sync (drift risk after 5+ engagements). AWS Agent Starter Pack is more polished.
- **#8 Code Quality:** Cannot rate without direct code review. Signals are positive (thoughtful architecture, explicit backlog, proactive self-awareness on "vibe coding"); typical prototype gaps expected (test coverage, hardcoded values, secrets handling, docstrings).

### Phase 1 Code Audit — Scope & Effort

**Duration:** 2 weeks (matches Phase 1 in the 24-week build plan)
**Team:** Platform Architect (lead) + 1 offshore developer (supporting)
**Deliverables:** Prototype Current-State Documentation + code audit report + technical debt inventory + remediation plan (what to fix in v1.0 vs what's v1.1+)

**Audit activities (per week):**

*Week 1:*
- **Automated scans (2 days):** linting (pylint, ruff, mypy), security scans (TruffleHog / Gitleaks for secrets, SAST basic), dependency audit (safety, pip-audit)
- **Architecture conformance (3 days):** does code match architecture docs? Are the 4 containers cleanly separated? Are overlays implemented per the matrix? Is policy-as-code actually YAML-driven?

*Week 2:*
- **Test coverage + quality assessment (2 days):** what's tested, what's not; unit vs integration vs E2E
- **Technical debt inventory (2 days):** code smells, hardcoded values, magical numbers, copy-paste, coupling, naming inconsistencies
- **Module walkthrough documentation (1 day):** Prototype Current-State Documentation companion doc produced

**Red-flag checklist used during audit:**

| Signal | Quick check |
|---|---|
| Missing unit tests | `grep -r "def test_" --include="*.py" | wc -l` |
| Hardcoded secrets | TruffleHog / Gitleaks |
| Magical numbers | Linter + review |
| Inconsistent error handling | Exception pattern review across modules |
| Copy-pasted code | Duplication scanner (jscpd, pylint) |
| No type hints | `mypy --strict` pass rate |
| Missing docstrings | Docstring coverage tool |
| Loose coupling violations | Import graph analysis |
| Missing input validation | Pydantic usage audit |
| Poor git history | Commit message / squash review |

**Audit output drives:**
- Code remediation work added to backlog (v1.0 blockers vs v1.1+ items)
- Prototype Current-State Documentation (companion doc, required pre-req before offshore onboarding)
- Architectural Decision Records (ADRs) captured for anything discovered during audit
- Target: move dimension #3 (Pattern Execution) and dimension #8 (Code Quality) from tentative to verified 8/10

**Why this audit is a pre-requisite (not v1.0 work):**
- Offshore team needs current-state knowledge before working on the code
- Unresolved debt compounds faster after multiple contributors join
- Customer-facing IP transfer demands code hygiene — cannot hand over a prototype "as-is"
- Self-aware audit is itself a differentiator vs SIs who skip this step

---
