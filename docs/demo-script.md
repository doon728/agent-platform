# Platform Demo Script

**Total time: ~16 min**
**Format: Loom recording**

---

## Agenda

| Beat | Content | Time |
|---|---|---|
| 1 | Platform intro + tech stack + AgentCore | ~2 min |
| 2 | Five capabilities | ~3 min |
| 3c | Cursor — repo structure + template vs generated | ~1 min |
| 3b | Cursor — 3 key files | ~1.5 min |
| 3 | Admin UI — Tool Admin + Agent Registry | ~2.5 min |
| 4 | Execution flow → Nurse demo (both agents) | ~5 min |
| 5 | Roadmap + AgentCore path | ~1.5 min |

---

## BEAT 1 — Platform Intro
**Time: ~2 min | Screen: platform-overview.html**

"Hi — let me walk you through an agentic AI platform I've been building.
> *[platform-overview.html open on screen — top of page]*

There are frameworks that give you building blocks, and there are managed cloud services that lock you in. What's harder to find is a reusable, cloud-agnostic foundation with enterprise-grade capabilities already built in — memory across sessions, governed tool access, human approvals, retrieval — that a team can deploy on top of for any use case without starting from scratch every time.

That's what this platform is.

It's currently tailored for healthcare payer — you'll see that in the demo — but the foundation is designed to extend to any industry and any line of business. The capabilities are the same, the use case on top changes.

Now — the intent right now is to use this platform to build POCs for healthcare use cases across customers. To show what's possible, move fast, and demonstrate value quickly. But the foundation is production-grade — if a customer wants to take it further, this becomes the accelerator they build on.

The platform supports multiple agent types — a chat agent, a summary agent, and more in the roadmap. We'll cover those in the upcoming sections.

It covers five capabilities — Memory, RAG, HITL, Tool Governance, and Prompt Management. The goal is that any team can deploy a production-ready AI agent on top of this foundation, for any use case, any line of business.
> *[scroll slowly to architecture diagram — pause here]*

The tech stack — LangGraph for the agent framework, FastAPI for the runtime, React and TypeScript for the UIs, PostgreSQL with pgvector for domain data and vector search.

The code — 25,000 lines across 220 files — was developed using AI-assisted development with Cursor and Claude. Five weeks to get here.

And one thing upfront — this is designed to be AWS AgentCore compatible from day one. The orchestration engine can swap to AgentCore without touching any platform capability. More on that at the end."

**TRANSITION:** "Let me walk through each of these five capabilities."

---

## BEAT 2 — Five Capabilities
**Time: ~3 min | Screen: platform-overview.html — capability sections**

"There are five capabilities built into this platform. Let me go through each one.

**Memory.**
Four scopes. Short-term is thread history — what was said in this conversation. Episodic is cross-session facts — things the agent has learned about this member across previous interactions. Semantic is structured facts — discrete data points stored as key-value pairs, queryable directly. And summary is a generated summary the agent produces at the end of each session and carries forward.
> *[scroll to Memory section — point to the 4-scope diagram]*

Each scope is independently toggleable per agent — from the Admin UI, without touching code. And there's a policy override — a supervisor can force memory on or off for a specific interaction regardless of the default config.

**RAG — Retrieval-Augmented Generation.**
I'm breaking this into three dimensions, because that's the clearest way to describe what's actually configurable here.
> *[scroll to RAG section — point to the 3-dimension table]*

Dimension one is strategy — how you search. Vector search for semantic similarity, graph traversal for relationship-based queries, or keyword for exact match. That's set per tool in the registry.

Dimension two is stage — when you retrieve. Either before the agent starts reasoning — the platform automatically pulls relevant knowledge and injects it into context, so the agent already has it when it begins. Or mid-reasoning — the agent can call the knowledge base as a tool, the same way it calls any other tool, when it decides it needs more information to answer.

Dimension three is pattern — how retrieval is orchestrated. Naive is one retrieve, inject, respond. Self-corrective adds a grading step — the agent evaluates whether what it retrieved is actually relevant, and re-queries if not. Multi-hop chains multiple retrievals together, each one building on the previous. These are roadmap — the foundation is there, the patterns plug in as separate files.

**HITL — Human in the Loop.**
Tool-level risk classification. Each tool is tagged as low, medium, or high risk. Low goes straight through. Medium gets queued for supervisor review. High is blocked until approved.
> *[scroll to HITL section — point to the adapter pattern diagram]*

Today the approval queue is internal — built into the platform. The key architectural decision was to build this as an adapter pattern. When a customer needs approvals to route to Pega or ServiceNow or Epic — that's one new file. Nothing else changes.

**Tool Governance.**
Every tool the agent can call lives in a registry — backed by the database, not hardcoded. Name, description, mode, tags, endpoint URL, input and output schema. The agent gets the schema at query time, not at deploy time. Add a tool from the Admin UI, it's immediately available to any agent configured to use it.
> *[scroll to Tool Governance section — point to the tool anatomy diagram]*

**Prompt Management.**
System prompts are in YAML — not in code. Each agent has a default, and a supervisor can override it at the agent level without a redeploy. Versioning and A/B testing are on the roadmap.
> *[scroll to Prompt Management section — brief pause, move on]*

Those are the five. Now let me show you what configuring these actually looks like."

**TRANSITION:** "Let me show you the repo structure first — then the three files that matter — then the Admin UI where all of this is configured."

---

## BEAT 3c — Repo Structure (Cursor)
**Time: ~1 min | Screen: Cursor — repo file tree**

"Let me show you how the repo is organized — because the structure itself tells the story.
> *[Cursor open, file tree visible on left panel — top-level folders collapsed]*

`templates/` — this is the reusable foundation. `overlay-templates` is the base agent runtime every new usecase starts from. This is where the LangGraph graph, the memory system, the HITL wiring, all of it lives as a template.
> *[expand `templates/overlay-templates/` — show folder structure, don't drill into files]*

`generated-repos/` — this is where new usecase repos land when you scaffold them from the Agent Factory UI. Right now there's one capability folder here: `care-management`. Inside that is `cm-hero-fl-app` — the healthcare care management agent. That repo was generated from the template in one click, then configured for this usecase.
> *[expand `generated-repos/care-management/cm-hero-fl-app/` — contrast the structure with the template]*

`services/` — the Tool Gateway lives here. It's shared infrastructure — one instance, all agents use it. Tools are registered here once and available to any agent.
> *[expand `services/` briefly]*

`services/` — the Admin UIs. Agent Factory UI and the support API that backs it.
> *[expand `services/` — show agent-factory-ui and agent-factory-support-api]*

So the pattern is: template defines the foundation, Agent Factory scaffolds a new repo from it, services provide the tool layer, control-plane services give you the admin surface to configure everything."

**TRANSITION:** "Now let me open three specific files that show how the platform actually works."

---

## BEAT 3b — Key Files (Cursor)
**Time: ~1.5 min | Screen: Cursor — open files one at a time**

**Files to open (in order):**
1. `templates/overlay-templates/overlays/chat_agent/overlay.yaml + reasoning.yaml + rag.yaml + hitl.yaml + tools/tools.yaml`
2. `templates/overlay-templates/overlays/chat_agent/orchestration/build_graph.py`
3. `templates/overlay-templates/common/services/agent-runtime/src/platform/langgraph_runner.py`

---

"This is `agent.yaml`. This is what the Admin UI writes to.
> *[open agent.yaml — scroll to top]*

Every platform capability has a config entry here. `features` — memory on, RAG on, HITL off, observability on. `hitl` — adapter is internal, routing rules by risk level, SLA timeout. `retrieval` — strategy, top_k, similarity threshold, pre-graph toggle. `risk` — each tool tagged with its risk level.
> *[scroll slowly through — pause at `features`, `hitl`, `retrieval`, `risk` sections]*

When an admin changes a toggle in the Agent Registry UI — this file is what changes. The agent picks it up on next restart. No code touched.

---

This is the graph. Three nodes — planner, executor, chat responder.
> *[open build_graph.py — point at the three `add_node` lines]*

Message comes in, planner decides what to do, executor calls the tool, chat responder formats the answer. If the executor hits an approval gate, it exits early — the graph ends there, the approval goes into the queue, and the agent waits.
> *[point at `add_conditional_edges` block — the HITL branch]*

This is the usecase-specific overlay. The common `build_graph.py` at the platform level reads the agent type from config and loads this file dynamically — so swapping in a new agent type means a new overlay, not touching the platform.

---

This is the runner — and this is where the three phases happen that I mentioned in the architecture.
> *[open langgraph_runner.py — scroll to line ~146]*

Before the graph runs: memory is loaded, scopes are resolved, pre-graph RAG fires if enabled, context is assembled and passed into the graph.
> *[highlight pre-graph block ~line 146–173]*

Then the graph runs.
> *[scroll to `self._app.invoke` ~line 202 — pause]*

After the graph runs: memory is written — short-term, episodic, semantic, summary — each one independently, based on what the policy says and what actually happened in that turn.
> *[scroll to post-graph writes ~line 246 onward]*

The graph itself only does reasoning and tool calls. All platform capabilities live here, in the runner, wrapping the graph. That's the boundary that makes the graph swappable."

**TRANSITION:** "Now let me show you the Admin UI — where all of this is configured without opening a single file."

---

## BEAT 3 — Admin UI
**Time: ~2.5 min | Screen: Browser — Tool Admin UI (5200), then Agent Factory UI (5173)**

"This is the Tool Admin UI. Every tool the agent can call is registered here — backed by the database, not hardcoded anywhere in the codebase.
> *[open localhost:5200 — tool list visible]*

Let me click into `write_case_note`. You can see the full schema — input fields, output shape, mode is write, tags include healthcare and care management. This is what gets sent to the LLM as the tool definition. Add a new tool here, it's immediately available to any agent configured to use it. No code change, no redeploy.
> *[click `write_case_note` — show schema panel, point at mode/tags/input fields]*

Now the KB tab. These are the documents indexed in the knowledge base — chunk count, ingestion date. This is what the retrieval tool searches when the agent calls `search_kb`. You can upload a new document directly from here.
> *[click KB tab — show document list and chunk counts]*

---

Now Agent Factory. This is where agents are configured.
> *[switch to localhost:5173 → Agent Registry]*

In the Agent Registry, I'll open the chat agent. Memory tab — four scopes, each independently toggleable. Turn episodic off, the agent stops writing cross-session facts. Turn it back on, it resumes next turn. No restart needed.
> *[open chat agent → Memory tab — point at scope toggles]*

HITL tab — risk levels per tool. `write_case_note` is high — requires approval. `get_member` is low — goes straight through. Change a risk level here, it takes effect immediately.
> *[click HITL tab — point at risk level per tool]*

And Prompt Governance — system prompt per agent. Override it here without touching the codebase.
> *[brief glance at Prompt Governance tab — don't linger]*

Everything you just saw me change in this UI — it writes directly to the `agent.yaml` we looked at in Cursor. That's the full loop: config file → UI reads it, UI writes it back."

**TRANSITION:** "Now let me show this running. Let me switch to the nurse view and walk through an actual interaction."

---

## BEAT 4 — Nurse Demo
**Time: ~5 min | Screen: platform-overview.html briefly, then Care Management UI (3000)**

"Before I jump into the demo, let me point to the execution flow one more time — because what you're about to see maps directly to this.
> *[switch to platform-overview.html — execution flow diagram — 15 seconds only]*

Three phases. Pre-graph: context assembled — memory loaded, RAG injected if enabled. Graph: planner decides, executor calls the tool. Post-graph: memory written. Every message, every turn. Now let's watch it happen.
> *[switch to localhost:3000 — Members page]*

---

**Members → Case → Assessment**

I'm on the Members page. I'll search for Mia Martinez — member ID m-001715. Medicaid plan, Maryland. Primary diagnosis is heart failure — I50.9. Risk score 1.26.
> *[type "Mia" in search — click on Mia Martinez]*

She has an open case — Asthma Management, case-001. Let me open that.
> *[click case-001]*

And inside the case, there's an assessment. Let me open it.
> *[click into assessment asmt-000001]*

This is the assessment view. Three columns — the domain data on the left, the chat panel in the middle, the execution trace and memory panel on the right. The nurse works here. Everything happens in this view.

---

**Turn 1 — RAG**

I'll ask a clinical question — something that needs knowledge base retrieval.
> *[click into chat input]*

"What is the standard care protocol for a member with heart failure and low medication adherence?"
> *[type and send — wait for response]*

Look at the trace panel on the right. You can see the planner routed to `search_kb`. The tool was called, it retrieved relevant chunks from the knowledge base, and those results came back into the response. That's Dimension 2 — mid-reasoning retrieval. The agent decided it needed more information and called the tool.
> *[point at trace panel — show search_kb call and retrieved chunks]*

---

**Turn 2 — HITL**

Now I'll ask it to write a case note.
> *[click into chat input]*

"Write a case note that Mia's care plan is on track and follow-up is scheduled for next month."
> *[type and send]*

The agent tried to call `write_case_note`. But that tool is tagged as high risk in the config we saw — so instead of executing, it's now waiting for supervisor approval. The agent has stopped. It won't proceed until a human approves.
> *[point at HITL approval message in chat — trace shows APPROVAL_REQUIRED]*

Let me switch to the supervisor view.
> *[open supervisor / approval queue — either separate tab or navigate to it]*

The approval request is here — tool name, the arguments the agent was going to pass, the member context. The supervisor can approve or reject.
> *[point at approval card — show tool name and arguments]*

I'll approve it.
> *[click Approve]*

Now back to the nurse view. The case note has been written. The agent confirmed it.
> *[switch back to assessment view — show the agent's confirmation message]*

---

**Memory Panel**

Let me look at the memory panel.
> *[point to memory panel on the right side]*

After that turn, the platform wrote to episodic memory — the fact that a case note was written, the tool that was used, the context it was written in. This will be available in future sessions for this member. The nurse doesn't need to re-explain what happened last time — the agent already knows.
> *[show episodic entry in memory panel]*

---

**Summary Agent**

Now — same platform, different agent. I'll generate a summary of this assessment.
> *[click Generate Summary button in the assessment view]*

This is the summary agent. Same LangGraph runner, same memory system, same platform. Different overlay — different graph, different prompt, different purpose. It reads the assessment data, the case notes, the memory context, and produces a structured clinical summary.
> *[wait for summary to generate — show the output in the Summary panel]*

Two agents, one platform. The infrastructure is the same. The usecase on top changes."

**TRANSITION:** "Let me close with where this goes next."

---

## BEAT 5 — Roadmap + AgentCore
**Time: ~1.5 min | Screen: platform-overview.html — Roadmap section**

"Let me close with where this goes.

What you saw today is the foundation — V1. Memory across four scopes, RAG across two of the three dimensions, HITL with an adapter pattern, tool governance with a full admin UI, prompt management in config. Agent scaffolding from a template in one click. All of it running.
> *[point to roadmap table in platform-overview.html — V1 column]*

V2 is about depth. RAG patterns — self-corrective retrieval, multi-hop chaining. HITL evolving from tool-level risk to content-aware — the same tool gets a different risk level depending on what's actually being written, not just which tool was called. Memory read/write split — the summary agent reads memory but is never allowed to write. Multi-KB routing. These are the next layer on a foundation that's already there.
> *[point to V2 column]*

V3 is production-grade operations. LLM Ops — cost tracking, token budgets, latency dashboards. Context engineering — token-aware assembly so the window never overflows silently. External system execution — agent proposes, Pega or Epic executes. The agent never touches the system of record directly.
> *[point to V3 column]*

Now — AgentCore.

This platform was designed to be AgentCore compatible from day one. AgentCore is AWS's managed orchestration layer. What it replaces is one file — `langgraph_runner.py`. The three-phase boundary we looked at in Cursor. Swap that file, point it at AgentCore, done.

Everything else stays. Memory model, RAG patterns, HITL adapter, tool governance, prompt management — none of that changes. Those are platform capabilities, not orchestration. AgentCore doesn't replace them — it sits underneath them.

And for customers who want to use AgentCore's native memory or tool registry — those are options too. The platform is structured so you can adopt them selectively without rebuilding anything.

That's the platform. Foundation is built. Capabilities are running. Path to production is clear."
> *[end on roadmap section — no need to scroll further]*
