# Platform Demo Script — Voice + Show Guide

---

Hi, let me walk you through an agentic AI platform I've been building.
> *[SHOW: platform-overview.html open — top of page]*

Most AI agent work today is one-off. One team, one use case, built from scratch. What I wanted to build was a reusable foundation where the hard capabilities are already there and any team can build a new use case on top of it without starting from scratch. Memory across sessions, governed tool access, human approvals, retrieval, all of that already wired in. That's what this platform is.

What you'll see in the demo is built for healthcare payer, but the foundation is designed to extend to any industry and any line of business. The capabilities stay the same and the use case on top changes.

The intent right now is to use this to build POCs for healthcare use cases across customers, to show what's possible quickly and demonstrate value. And it's built to go further, so if a customer wants to take it to the next level, this becomes the accelerator they build on.

The platform supports multiple agent types. There's a chat agent, a summary agent, and more coming. We'll cover both in the demo.

It covers five capabilities: Memory, RAG, HITL, Tool Governance, and Prompt Management. The goal is that any team can deploy a fully capable AI agent on top of this, for any use case, any line of business.
> *[SHOW: scroll slowly to architecture diagram — pause here]*

On the tech stack, we're using LangGraph for the agent framework, FastAPI for the runtime, React and TypeScript for the UIs, and PostgreSQL with pgvector for domain data and vector search. The code, about 25,000 lines across 220 files, was developed using AI-assisted development with Cursor and Claude over five weeks.

And one thing I want to say upfront: this platform is designed to be AWS AgentCore compatible from day one. The orchestration engine can swap to AgentCore without touching any of the platform capabilities. I'll come back to that at the end.

Let me walk through each of the five capabilities now.

---

Let me go through each one.

Starting with Memory. There are four scopes. Short-term is your thread history, what was said in this conversation. Episodic is cross-session facts, things the agent has learned about this member across previous interactions. Semantic is structured facts, discrete data points stored as key-value pairs that can be queried directly. And summary is a generated summary the agent produces at the end of each session and carries forward into the next one.
> *[SHOW: scroll to Memory section — point to the 4-scope diagram]*

Each scope is independently toggleable per agent from the Admin UI, no code changes needed. And there's a policy override where a supervisor can force memory on or off for a specific interaction regardless of the default config.

Now RAG, Retrieval-Augmented Generation. I'm breaking this into three dimensions because I think that's the clearest way to describe what's actually configurable here.
> *[SHOW: scroll to RAG section — point to the 3-dimension table]*

Dimension one is strategy, which is how you search. You can use vector search for semantic similarity, graph traversal for relationship-based queries, or keyword for exact match. That's configured per tool in the registry.

Dimension two is stage, which is when you retrieve. You can retrieve before the agent starts reasoning, where the platform automatically pulls relevant knowledge and injects it into context so the agent already has it when it begins. Or you can retrieve mid-reasoning, where the agent calls the knowledge base as a tool, the same way it calls any other tool, when it decides it needs more information to answer.

Dimension three is pattern, which is how retrieval is orchestrated. Naive is one retrieve, inject, respond. Self-corrective adds a grading step where the agent evaluates whether what it retrieved is actually relevant and re-queries if not. Multi-hop chains multiple retrievals together, each one building on the previous. The patterns are on the roadmap and they plug in as separate files without touching anything else.

Moving to HITL, Human in the Loop. Each tool is tagged as low, medium, or high risk. Low goes straight through. Medium gets queued for supervisor review. High is blocked until approved.
> *[SHOW: scroll to HITL section — point to adapter pattern diagram]*

Today the approval queue is internal, built into the platform. But the key architectural decision here was to build this as an adapter pattern. When a customer needs approvals to route to Pega or ServiceNow or Epic, that's one new file. Nothing else changes.

Tool Governance. Every tool the agent can call lives in a registry, backed by the database, not hardcoded anywhere. Name, description, mode, tags, endpoint URL, input and output schema. The agent gets the schema at query time, not at deploy time. So if you add a tool from the Admin UI, it's immediately available to any agent configured to use it, no code change, no redeploy.
> *[SHOW: scroll to Tool Governance section — point to tool anatomy diagram]*

And finally Prompt Management. System prompts are in YAML, not in code. Each agent has a default system prompt and a supervisor can override it without a redeploy. Versioning and A/B testing are on the roadmap.
> *[SHOW: scroll to Prompt Management section in platform-overview.html — point to the two prompt cards (planner and responder), brief pause, move on]*

Those are the five. Now let me show you how it's all structured and then how it runs.

---

Let me start with the repo structure because the structure itself tells the story.
> *[SHOW: switch to Cursor — file tree visible, top-level folders collapsed]*

There's a templates folder which is the reusable foundation. The agent runtime template is the base every new usecase starts from. That's where the LangGraph graph, the memory system, the HITL wiring, all of that lives as a template.
> *[SHOW: expand templates/overlay-templates/ — show folder structure, don't drill into files]*

Then there's generated-repos, which is where new usecase repos land when you scaffold them from the Agent Factory UI. Right now there's one capability folder here, care-management, and inside that is cm-hero-fl-app, the healthcare care management agent. That repo was generated from the template in one click and then configured for this usecase.
> *[SHOW: expand generated-repos/care-management/cm-hero-fl-app/ — contrast with template]*

services/ is where the Tool Gateway lives. It's shared infrastructure, one instance, all agents use it. Tools are registered here once and available to any agent.
> *[SHOW: expand services/ briefly]*

And platform-tools is where the Admin UIs live, the Agent Factory UI and the support API that backs it.
> *[SHOW: expand services/ — show agent-factory-ui and agent-factory-support-api]*

So the pattern is: template defines the foundation, Agent Factory scaffolds a new repo from it, services provide the tool layer, and control-plane services give you the admin surface to configure everything.

Now let me open three specific files that show how the platform actually works.

---

This first one is agent.yaml and this is what the Admin UI writes to.
> *[SHOW: open templates/overlay-templates/overlays/chat_agent/overlay.yaml + reasoning.yaml + rag.yaml + hitl.yaml + tools/tools.yaml]*

Every platform capability has a config entry here. You can see the features section where memory is on, RAG is on, HITL is off, observability is on. The HITL section has the adapter set to internal with routing rules by risk level. The retrieval section has strategy, similarity threshold, and the pre-graph toggle. And the risk section has each tool tagged with its risk level.
> *[SHOW: scroll slowly — pause at features, hitl, retrieval, risk sections]*

When an admin changes a toggle in the Agent Registry UI, this file is what changes. The agent picks it up on next restart. No code touched.

---

This second file is build_graph.py and this is the graph.
> *[SHOW: open templates/overlay-templates/overlays/chat_agent/orchestration/build_graph.py]*

The graph has three nodes: a planner, an executor, and a responder. This is the chat agent overlay so the responder is built for conversation, but each agent type has its own version of this file with its own graph logic. A message comes in, the planner decides what to do, the executor calls the tool, and the responder formats the answer.
> *[SHOW: point at the three add_node lines]*

If the executor hits an approval gate, it sends an approval request to the supervisor queue. The agent can continue with other tasks in the meantime, and once the supervisor approves, that action gets executed.
> *[SHOW: point at add_conditional_edges block — the HITL branch]*

The common build_graph at the platform level reads the agent type from config and loads this file dynamically, so swapping in a new agent type means a new overlay, not touching the platform itself.

The responder is also part of the overlay, so for the chat agent it formats a conversational answer, and for the summary agent it produces a structured clinical summary. Same pattern, different implementation.

---

And this third file is langgraph_runner.py. This is the platform wrapper that owns the full lifecycle — it prepares context before the graph runs, invokes the graph, and handles memory writes after it completes.
> *[SHOW: open templates/overlay-templates/common/services/agent-runtime/src/platform/langgraph_runner.py]*

Pre-graph is where context is assembled and knowledge is injected.
> *[SHOW: scroll to pre-graph block ~line 146]*

Then the graph runs — the planner looks at the request and decides which tool to call, the executor takes that decision and actually calls the tool through the tool gateway, and the responder takes the result and formats it into a final answer.
> *[SHOW: scroll to self._app.invoke ~line 202 — pause]*

And post-graph is where memory is written. You swap the graph per agent type, the runner stays the same.
> *[SHOW: scroll to post-graph writes ~line 246 onward]*

Now let me show you the Admin UI where all of this gets configured without opening a single file.

---

This is the Tool Gateway Admin UI. Every tool the agent can call is registered here, backed by the database, not hardcoded anywhere in the codebase.
> *[SHOW: open localhost:5200 — tool list visible]*

I'll click into write_case_note. You can see the full schema, input fields, output shape, mode is write, tags include healthcare and care management. This is exactly what gets sent to the LLM as the tool definition. Add a new tool here and it's immediately available to any agent configured to use it.
> *[SHOW: click write_case_note — show schema panel, point at mode/tags/input fields]*

Now the KB tab. These are the documents indexed in the knowledge base, with chunk count and ingestion date. This is what the retrieval tool searches when the agent calls search_kb. You can upload a new document directly from here.
> *[SHOW: click KB tab — show document list and chunk counts]*

Now switching to Agent Factory, this is where agents are configured.
> *[SHOW: switch to localhost:5173 → Agent Registry]*

In the Agent Registry I'll open the chat agent. Memory tab has four scopes, each independently toggleable. Turn episodic off and the agent stops writing cross-session facts. Turn it back on and it resumes next turn, no restart needed.
> *[SHOW: open chat agent → Memory tab — point at scope toggles]*

The RAG tab is where retrieval is configured — you can set how the agent searches, whether it should retrieve knowledge before it even starts reasoning, and how close a match needs to be before it's considered relevant. All of it configurable without touching a single file.
> *[SHOW: click RAG tab]*

The HITL tab shows risk levels per tool. Writing a case note is tagged as high risk so it requires approval. Getting member information is low, it goes straight through. You can change any of these here and it takes effect immediately.
> *[SHOW: click HITL tab — point at risk levels]*

And the Prompt Governance tab is where all agent prompts are managed — the planner system prompt and the responder system prompt. You can view, update, and override either of them per agent without touching the codebase.
> *[SHOW: click Prompt Governance tab — brief glance, don't linger]*

Everything I just changed in this UI writes directly to the agent.yaml we looked at in Cursor. That's the full loop: config file, UI reads it, UI writes it back.

Now let me show this actually running.

---

Before I jump in, let me quickly connect this back to the execution flow we covered. Every time a request comes in, it goes through three phases. Pre-graph: memory is loaded and knowledge is injected into context. Then the graph runs: the planner decides which tool to call, the executor calls it through the tool gateway, and the responder formats the answer. Post-graph: memory is written. You'll see all of this live in the trace panel and the memory panel as we go through the demo.
> *[SHOW: switch to platform-overview.html — execution flow diagram — 15 seconds only]*

I'm on the Members page. I'll search for Mia Martinez, member ID m-001715. She's on a Medicaid plan in Maryland, primary diagnosis is heart failure, risk score 1.26.
> *[SHOW: switch to localhost:3000 — Members page — type "Mia" in search]*

One thing to point out — the chat panel is available at three levels. Right here at the member level the nurse can ask questions about this member across all their cases. At the case level the nurse can ask questions in the context of a specific case. And at the assessment level the nurse gets the full view with all the assessment data laid out alongside the chat. All three levels have the execution trace and memory panel — in a real production application those would be hidden from the nurse, but for this demo they let us see exactly what the platform is doing behind the scenes.
> *[SHOW: click on Mia Martinez — show member profile page with inline chat panel visible]*

She has an open case, Asthma Management. Let me open that. At the case level the nurse has two views — an inline chat right on this screen for quick research, and a dedicated assessment view when they click into a specific assessment with all the domain data laid out. Let me work from the inline view so everything is visible and readable.
> *[SHOW: click case-001 Asthma Management — show case view — click Chat button to open inline chat]*

The agent is powered by OpenAI's chat model. And switching to Bedrock or any other model is a config change, not a code change.

I'll ask a clinical question, something that needs knowledge base retrieval.

"What is the care management protocol for members with depression risk and low medication adherence?"
> *[SHOW: type and send the question — wait for response]*

Look at the trace panel. You can see the planner routed to search_kb. The tool was called, it retrieved relevant chunks from the knowledge base, and those results came back into the response. That's Dimension 2, mid-reasoning retrieval. The agent decided it needed more information and called the tool.
> *[SHOW: click Trace tab — point at search_kb call and retrieved chunks]*

Now I'll ask it to write a case note.

"Write a case note that Mia's care plan is on track and follow-up is scheduled for next month."
> *[SHOW: type and send — wait for response]*

The agent tried to call write_case_note, but that tool is tagged as high risk in the config we saw. So instead of executing, it sent an approval request to the supervisor queue. The agent can continue with other tasks in the meantime.
> *[SHOW: point at HITL approval message in chat]*

Let me switch to the supervisor view.
> *[SHOW: click Approval Console button top right]*

The approval request is here with the tool name, the arguments the agent was going to pass, and the member context. The supervisor can approve or reject. I'll approve it.
> *[SHOW: point at approval card — show tool name and arguments — click Approve]*

Back to the case view. The case note has been written and the agent confirmed it.
> *[SHOW: switch back to case view — show agent confirmation message]*

Now let me look at the memory panel. After that turn, the platform wrote to episodic memory — the fact that a case note was written, the tool that was used, and the context it was written in. This will be available in future sessions for this member. The nurse doesn't need to re-explain what happened last time because the agent already knows.
> *[SHOW: click Memory tab — show episodic entry]*

Now, same platform, different agent. I'll generate a summary of this assessment.
> *[SHOW: click Generate Summary button]*

This is the summary agent. Same LangGraph runner, same memory system, same platform. It uses a different overlay, a different graph, a different prompt, built for a different purpose. It reads the assessment data, the case notes, the memory context, and produces a structured clinical summary.
> *[SHOW: wait for summary to generate — show the output]*

Two agents, one platform. The infrastructure is the same. The use case on top changes.

---

Let me close with where this goes.
> *[SHOW: switch to platform-overview.html — Roadmap section]*

What you saw today is the foundation, V1. Memory across four scopes, RAG across the first two dimensions which is strategy and stage, HITL with an adapter pattern, tool governance with a full admin UI, prompt management in config, and agent scaffolding from a template in one click. All of it running.
> *[SHOW: point to V1 column in roadmap table]*

V2 is about depth. RAG patterns, self-corrective retrieval, multi-hop chaining. HITL evolving from tool-level risk to content-aware, where the same tool gets a different risk level depending on what's actually being written, not just which tool was called. Memory read/write split where the summary agent can read memory but is never allowed to write. Multi-KB routing. These are the next layer on a foundation that's already there.
> *[SHOW: point to V2 column]*

V3 is production-grade operations. LLM Ops with cost tracking, token budgets, latency dashboards. Context engineering so the window never overflows silently. And external system execution where the agent proposes and Pega or Epic executes. The agent never touches the system of record directly.
> *[SHOW: point to V3 column]*

On AgentCore: this platform was designed to be AgentCore compatible from day one. What AgentCore replaces is one file, langgraph_runner.py, the three-phase boundary we looked at in Cursor. Swap that file, point it at AgentCore, and you're done. Everything else stays, the memory model, RAG patterns, HITL adapter, tool governance, prompt management. Those are platform capabilities, not orchestration. AgentCore sits underneath them, it doesn't replace them.

And for customers who want to use AgentCore's native memory or tool registry, those are options too. The platform is structured so you can adopt them selectively without rebuilding anything.

That's the platform. The foundation is solid, the capabilities are built, and it's ready to be put to work.
