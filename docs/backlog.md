# Platform Backlog

Status key: ✅ Done | ⚠ Partial / Limitation | 🔲 Not Started

---

## Active / Next Up

1. **Agent Registry UI** ✅ — fully built. Workspaces page has Restart + Stop buttons. Agent Registry, Prompt Governance all built.

2. **Summary Agent** ✅ — built. `summary_agent` overlay exists, `SummaryPanel` component built, used in AssessmentView and CaseView.

3. **Live Agent Flow Diagram in Overview tab** 🔲 — as admin configures RAG, HITL, Memory tabs in Agent Registry, the Overview tab shows a live visual flow diagram that updates dynamically to reflect the current config. Examples: enable pre-graph RAG → RAG step appears before graph in diagram; disable HITL → approval branch disappears from executor; turn off episodic memory → post-graph write shows only short-term. Diagram is a React component (ReactFlow) reading the same config state already loaded in the UI — no new API calls needed. Each tab change updates the diagram in real time. Purpose: admin sees exactly what will happen on the next message given current config, without reading YAML.

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

3b. **Case/Member chat 3-column layout** 🔲 — CaseView and MemberProfile have `InlineChatPanel` ✅ but missing `TraceGraph` + full `MemoryPanel`. AssessmentView has the full 3-column layout — needs to be replicated in CaseView and MemberProfile.

3c. **Chat history — fetch from thread memory store** 🔲 — today `InlineChatPanel` stores displayed messages in `localStorage` (per `chat-messages:type:id` key) so the nurse sees previous messages when navigating back. Proper fix: expose a `GET /thread/{thread_id}/messages` endpoint that reads the short-term memory store (the same store the agent writes to each turn) and returns formatted messages for the UI to render on mount. Removes the localStorage duplication and makes history correct across devices and browser sessions.

---

## Platform Capabilities — Backlog

4. **Tool Gateway Admin UI** 🔲 — new module in Agent Factory UI for managing the tool gateway without editing code
   - Add/edit/delete tools: name, description, mode (read/write), tags, primary_arg
   - KB classification: mark tool as retrieval tool, pick DB type (vector_db, graph_db, keyword) → auto-sets strategy (Dimension 1)
   - Document ingestion: upload PDFs/txt/docx into a KB tool's backing vector store, trigger embedding
   - KB management: view indexed documents, delete docs, re-embed, see chunk count
   - Publishes changes to tool gateway registry (currently requires code edits)
   - **Bucket hierarchy management** — admin defines named buckets (industry → LOB → region/state or any custom hierarchy) and maps them to tag combinations. Hierarchy is flexible and defined at runtime — not hardcoded. Examples: Healthcare → Care Management → Florida; or Region: Southeast → Product: Medicare Advantage → Function: Case Management.
   - **Agent bucket assignment** — in Agent Registry UI, agent is assigned to one or more buckets. Tool schema shown to LLM is filtered to matching tools at query time. Florida care management agent sees only Florida care management tools.
   - **What's in the data today**: tags are already a flat list on each ToolSpec (e.g. `["healthcare", "care_management", "florida", "member"]`). The bucket config layer on top is what's missing.

5. **Prompt Management & Evaluation module** 🔲 — manage prompt templates (prompt-defaults.yaml), A/B test prompt variants, evaluate outputs against test cases, track prompt version history. Add to Agent Factory UI.

6. **Memory Pruning** 🔲 — automatic cleanup of stale/irrelevant memory entries. Strategies: TTL-based expiry, relevance scoring, max-size eviction per scope. Prevent memory bloat over long sessions.

6b. **Intelligent Memory Retrieval** 🔲 — today platform always retrieves all enabled memory types on every turn. Real world: episodic, semantic, and summary retrieval should be conditional — rule-based pre-filter (e.g. only search episodic if case_id present) + optional LLM decision for ambiguous cases ("does this query need past case history?"). Same decision problem as tool calling but at the memory layer.

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

10b. **Multi-KB routing for RAG** 🔲 — both RAG paths (pre-graph and planner tool) today hit a single KB. Need:
   - Query classification (rule-based or LLM) to select the right KB per query
   - Fan-out across multiple KBs in parallel, merge + re-rank results
   - Applies independently at both pre-graph and planner tool stages
   - Config shape TBD — possibly a `retrieval.kbs` list with tags/rules per KB

10c. **RAG Pattern implementations** 🔲 — build each RAG pattern as a separate file under `src/platform/rag/patterns/`, all implementing a common `RAGPattern` base interface. Once built, any agent selects a pattern via `retrieval.pattern` in agent.yaml — zero code touch in the agent overlay. Patterns to build:
   - `naive.py` — single retrieve → inject → respond (implicit today, needs formalizing)
   - `self_corrective.py` — retrieve → LLM grades relevance → re-query if poor → respond
   - `multi_hop.py` — retrieve → reason → identify gap → retrieve again → chain results → respond
   - `hyde.py` — LLM generates hypothetical answer first → embed that → use as query → retrieve
   - `agentic.py` — LLM decides when/how many times to retrieve mid-reasoning
   - Pattern router — rule-based or LLM-based selection when multiple patterns active in same agent
   - Admin guidance: naive/self_corrective for time-pressured workflows (nurses); multi_hop/agentic for research-heavy workflows

10d. **Semantic tool filtering (RAG over tool registry)** 🔲 — today tool filtering is purely static (allowed list + context field presence). The right approach: embed all tool descriptions at startup, embed user prompt at query time, retrieve top-k most semantically relevant tools, pass only those to the LLM. This is NOT bringing back old V1 hardcoded if/else rules — this is RAG applied to tool selection.

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

10i. **RAG Config — Wire YAML parameters to retriever** ⚠ — `agent.yaml` retrieval section should drive actual RAG behavior. Right now `top_k`, similarity threshold, embedding model, and strategy are hardcoded in `retriever.py` as env var defaults and never read from YAML. Files to touch: `agent.yaml`, `executor.py`, `retriever.py`, `registry.py`.

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

12. **Fresh repo generation test** 🔲 — delete and re-scaffold from template, verify end-to-end.

12c. **agent-platform repo structure refactor** 🔲 — full restructure of how capabilities, apps, agents, and UI are organised in the agent-platform repo. This replaces the `generated-repos/` wrapper and the "use case" concept entirely.

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

13a. **Platform Capability Visual Document** 🔲 — one visual per capability (RAG, Memory, HITL, Tools, Observability) showing all dimensions in flow/diagram format, color-coded by build status. The "what and where are we" view for stakeholders and demos.

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

14. **PowerPoint deck** 🔲 — platform story for stakeholders. Use capability visuals from 13a as the core slides.

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
