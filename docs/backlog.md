# Platform Backlog

Status key: ✅ Done | ⚠ Partial / Limitation | 🔲 Not Started

---

## Active / Next Up

1. **Agent Registry UI** ✅ — fully built. Workspaces page has Restart + Stop buttons. Agent Registry, Prompt Governance all built.

2. **Summary Agent** ✅ — built. `summary_agent` overlay exists, `SummaryPanel` component built, used in AssessmentView and CaseView.

3. **Live Agent Flow Diagram in Overview tab** 🔲 — as admin configures RAG, HITL, Memory tabs in Agent Registry, the Overview tab shows a live visual flow diagram that updates dynamically to reflect the current config. Examples: enable pre-graph RAG → RAG step appears before graph in diagram; disable HITL → approval branch disappears from executor; turn off episodic memory → post-graph write shows only short-term. Diagram is a React component (ReactFlow) reading the same config state already loaded in the UI — no new API calls needed. Each tab change updates the diagram in real time. Purpose: admin sees exactly what will happen on the next message given current config, without reading YAML.

3b. **Case/Member chat 3-column layout** 🔲 — CaseView and MemberProfile have `InlineChatPanel` ✅ but missing `TraceGraph` + full `MemoryPanel`. AssessmentView has the full 3-column layout — needs to be replicated in CaseView and MemberProfile.

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

10g. **Config-driven adapter selection** 🔲 — across HITL, RAG patterns, and memory backends, adapter/pattern selection should be fully config-driven. Goal: `hitl.adapter: pega`, `retrieval.pattern: self_corrective`, `memory.backend: dynamodb` in agent.yaml → platform instantiates correct implementation automatically. Zero code touch.

10h. **Semantic memory vector retrieval** 🔲 — today semantic facts are retrieved by scope (fetch all facts for member). At scale (50+ facts per member), needs vector similarity retrieval: embed each fact at write time, embed query at retrieval time, return top-k by cosine similarity. Requires vector-capable backend (pgvector on PostgreSQL).

10i. **RAG Config — Wire YAML parameters to retriever** ⚠ — `agent.yaml` retrieval section should drive actual RAG behavior. Right now `top_k`, similarity threshold, embedding model, and strategy are hardcoded in `retriever.py` as env var defaults and never read from YAML. Files to touch: `agent.yaml`, `executor.py`, `retriever.py`, `registry.py`.

11. **AgentCore compatibility** 🔲 — memory backend swap + CloudWatch traces. Note: AgentCore replaces the orchestration engine only — all platform capabilities (memory model, HITL, RAG patterns, prompt governance) must still be built regardless.

12. **Fresh repo generation test** 🔲 — delete and re-scaffold from template, verify end-to-end.

12c. **Capability-based repo structure** 🔲 — remove `generated-repos/` wrapper folder. Each generated usecase repo should land at the top level of the monorepo under its capability folder: `<capability>/<usecase-repo>/`. Changes needed:
   - **Support API** — update scaffolding endpoint to accept `capability_name` and construct output path as `/<capability>/<usecase-repo>/` instead of `/generated-repos/<capability>/<usecase-repo>/`
   - **Agent Factory UI** — add capability picker/creator to the "create new agent" flow. User selects existing capability (care-management, appeals-management) or creates a new one. Capability becomes the top-level folder.
   - **Generation path logic** — if capability folder doesn't exist, create it. If it does, scaffold into it alongside existing usecases.
   - **In production** — each `<capability>/` folder at top level can become its own repo, or each `<usecase-repo>/` gets its own `.git`. Either way, no `generated-repos/` wrapper.

   Final structure:
   ```
   agent-platform/
   ├── platform/
   ├── templates/
   ├── platform-services/
   ├── shared-infra/
   ├── platform-tools/
   ├── care-management/          ← capability folder
   │   └── cm-hero-fl-app/       ← generated usecase repo
   ├── appeals-management/       ← another capability
   └── payment-integrity/        ← another capability
   ```

12b. **Git init on repo generation** 🔲 — when Agent Factory generates a new usecase repo, it should automatically `git init` inside the generated folder, make an initial commit ("scaffold: generated from template"), and optionally push to a remote (GitHub/CodeCommit/ADO). Today generated repos are just folders inside the monorepo with no own `.git`. In production each usecase repo must be independent — own git history, own remote, own CI/CD pipeline. This is also a strong demo moment: one click in Agent Factory produces a standalone, version-controlled, deployable repo.

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
