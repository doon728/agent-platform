# Section 1 — Repo & File Structure

## The Core Platform Principle

> **Build once in platform. Configure per agent. Never touch agent code for platform capabilities.**

This is the single most important thing to understand about this platform. Everything else follows from it.

RAG patterns, HITL adapters, memory backends, retrieval strategies — all of these are built once in `src/platform/`. Agent overlays contain only config, prompts, and tool lists. When a new capability is needed (a new RAG pattern, a new HITL adapter, a new memory backend), one developer builds it in the platform layer. Every existing and future agent gets it immediately via a config change — zero code touch in the agent.

This means:
- A new usecase agent is created by writing config and prompts — not code
- Swapping `retrieval.pattern: naive` to `retrieval.pattern: self_corrective` requires no agent code change
- Swapping `hitl.adapter: internal` to `hitl.adapter: pega` requires no agent code change
- Adding a new agent to the platform means adding an overlay folder + config files — the engine is already there

Every section in this documentation is an application of this principle. Keep it in mind as you read.

---

## Overview

Every agent in the platform lives in its own repo. The repo has two distinct layers:

- **Platform Core** — the engine. Shared across all agents. You never touch this.
- **Overlay** — the usecase. This is where your business logic, prompts, and config live. This is what you own.

Understanding this boundary is critical. When something breaks in the engine, you fix the platform. When you need new behavior for a usecase, you edit the overlay.

---

## Top-Level Repo Structure

```
cm-chat-buddy-assess/
├── overlays/                  ← YOUR LAYER — usecase-specific logic and config
│   ├── chat_agent/            ← one folder per agent type
│   └── summary_agent/
├── services/
│   └── agent-runtime/         ← PLATFORM LAYER — the engine, do not edit
├── data/                      ← runtime data: memory files, KB indexes
├── state/                     ← HITL approval state, pending approvals
├── docker-compose.yml         ← local dev container setup
├── rebuild-runtime.sh         ← rebuild + restart the agent container
└── .env                       ← environment variables (API keys, ports)
```

The key insight: **`overlays/` is yours. `services/agent-runtime/` is the platform.**

---

## The Overlay — What You Own

Each agent type gets its own overlay folder. Here is what's inside `overlays/chat_agent/`:

```
overlays/chat_agent/
├── agent_manifest.yaml        ← declares this overlay to the platform
├── config/
│   ├── agent.yaml             ← tools, HITL risk levels, retrieval params, model
│   ├── memory.yaml            ← memory scopes, write policies, triggers
│   └── prompt-defaults.yaml   ← system prompt, persona, format rules, tone
├── agents/
│   ├── llm_planner.py         ← decides what tool to call (or LLM routes directly)
│   ├── chat_responder.py      ← formats the final response to the user
│   ├── executor.py            ← executes tool calls, handles HITL gate
│   └── planner.py             ← hard-coded route fallback (legacy, being phased out)
├── graph/
│   └── state.py               ← LangGraph state definition — what flows through the graph
└── orchestration/
    └── build_graph.py         ← wires all nodes into the LangGraph execution graph
```

### The execution flow — Planner → Executor → Responder

Every user message flows through three stages. This is the core loop of the agent:

```
User message
     │
     ▼
 PLANNER          "What should I do?"
     │             Reads the message, history, and context.
     │             Decides: call a tool, or answer directly from LLM.
     │             Outputs a plan: [tool_name, arguments] or [LLM_ROUTE]
     │
     ▼
 EXECUTOR         "Do it."
     │             If tool call → calls the Tool Gateway.
     │             Checks HITL risk level for that tool.
     │             If high risk → pauses, stores approval request, returns APPROVAL_REQUIRED.
     │             If approved or low risk → executes, returns tool output.
     │             If LLM_ROUTE → passes through, no tool called.
     │
     ▼
 RESPONDER        "Say it."
                  Takes the tool output (or raw LLM route signal).
                  Calls LLM to format a human-readable response.
                  Applies persona, tone, format rules from prompt-defaults.yaml.
                  Returns the final answer to the user.
```

The planner is about **decision**. The executor is about **action**. The responder is about **communication**. They are intentionally separated so you can change one without touching the others.

The **router** is a fourth concept used in multi-agent setups — it decides which agent to hand the conversation to next (e.g. escalate from chat_agent to a specialist agent). Not present in single-agent deployments.

---

### What each file does

| File | Purpose | Edit when |
|---|---|---|
| `agent_manifest.yaml` | Declares the overlay — agent type, RAG dimension metadata | Setting up a new agent type |
| `agent.yaml` | Tool allowlist, risk levels per tool, retrieval strategy, model | Changing which tools the agent can use, adjusting HITL thresholds |
| `memory.yaml` | Which memory scopes are on, write policies, triggers per scope | Changing what the agent remembers and when |
| `prompt-defaults.yaml` | System prompt, persona, format rules, tone of responses | Changing how the agent thinks, talks, or formats responses |
| `llm_planner.py` | Structured output planner — routes to tool or LLM response | Adding new hard routes, changing tool selection logic |
| `chat_responder.py` | Takes planner output, calls LLM to format final response | Changing response formatting behavior |
| `executor.py` | Calls the tool gateway, evaluates HITL risk, pauses for approval | Changing how tools are executed or how HITL is triggered |
| `state.py` | TypedDict — all fields that flow through the LangGraph graph | Adding new state fields needed by your agent |
| `build_graph.py` | Assembles the LangGraph nodes and edges | Adding new nodes to the agent workflow |

---

### The planner does more than pick a tool

A common misconception: the planner just decides which tool to call. It actually does three things:

1. **Context extraction** — pulls domain identifiers out of the message and history (member ID, case ID, assessment ID, etc.) so the tool call has the right arguments
2. **Tool selection** — decides which tool to call based on the user's intent
3. **Route decision** — decides whether to call a tool at all, or respond directly from the LLM (LLM_ROUTE)

This means the planner has domain knowledge baked in. For a care management usecase it knows to look for `asmt-XXXX` patterns and `m-XXXX` member IDs. For a benefits usecase it would look for policy numbers, claim IDs, or enrollment dates instead.

---

### State — Your Domain Contract

The `GraphState` TypedDict in `build_graph.py` defines all the fields that flow through the graph. The platform only requires a minimal set:

```python
# Platform-required — do not remove these
class GraphState(TypedDict, total=False):
    prompt: str          # the user's message
    history: list        # conversation history
    ctx: dict            # full context object (member, tools, memory, prompts)
    result: any          # tool execution result
    answer: str          # final response to user
    planner_trace: dict  # observability — what the planner decided
    executor_trace: dict # observability — what the executor did
```

Everything beyond that is yours to define per usecase. A care management agent adds:

```python
    assessment_id: str   # pulled from message or context
    case_id: str
    member_id: str
```

A benefits agent would add:

```python
    policy_number: str
    claim_id: str
    enrollment_date: str
```

A loan origination agent would add:

```python
    application_id: str
    loan_type: str
    applicant_ssn_last4: str
```

The platform doesn't care what domain fields you add — it only reads the fields it knows about (`prompt`, `history`, `ctx`, `result`, `answer`, traces). Everything else flows through untouched for your planner and executor to use.

**This is how the same platform serves completely different industries without any platform code changes.**

---

## The Platform Core — Do Not Edit

```
services/agent-runtime/src/
├── platform/
│   ├── app.py                 ← FastAPI server — chat, approval, health endpoints
│   ├── langgraph_runner.py    ← loads the overlay graph and runs it
│   ├── manifest_loader.py     ← reads agent_manifest.yaml, resolves overlay path
│   ├── config.py              ← loads base + env config
│   ├── context.py             ← builds the context object passed to every node
│   ├── auth.py                ← authentication middleware
│   ├── authorization.py       ← role-based access control
│   ├── memory/                ← memory system: read, write, scope resolution
│   │   ├── memory_store.py    ← reads/writes episodic and semantic memory
│   │   ├── context_builder.py ← assembles memory into LLM context
│   │   ├── write_engine.py    ← decides what to persist after each turn
│   │   ├── scope_resolver.py  ← resolves which scopes to read based on config
│   │   ├── semantic_engine.py ← semantic similarity search
│   │   ├── summary_engine.py  ← summary memory read/write
│   │   └── file_memory.py     ← file-based memory backend (dev mode)
│   ├── hitl/                  ← human-in-the-loop approval system
│   │   ├── approval_store.py  ← stores pending approvals, resolves decisions
│   │   └── adapters/          ← internal approval adapter (extensible to Pega, ServiceNow)
│   ├── llm/
│   │   └── responder.py       ← shared LLM call utility used by responder nodes
│   ├── tools/
│   │   └── router.py          ← calls the tool gateway, handles tool responses
│   └── observability/
│       ├── tracer.py          ← execution trace recorder
│       └── tracing.py         ← trace schema and utilities
└── graph/
    └── build_graph.py         ← entry point — delegates to overlay's build_graph.py
```

### The rule

> If a file is in `services/agent-runtime/src/platform/` — it is platform code. Fixes go in the template, then copied to the repo. Never edit the repo version directly.

> If a file is in `overlays/` — it is usecase code. Edit it directly in the repo.

---

## Config Files — The Three Layers

Every agent behavior is controlled by three config files in the overlay. Understanding these three is enough to configure any agent without touching code.

### `agent.yaml` — What the agent can do

```yaml
agent:
  name: cm-chat-buddy-assess
  model: gpt-4o-mini
  tools:
    mode: selected          # selected = allowlist, auto = by tag
    allowed:
      - get_member_profile
      - get_open_cases
      - write_case_note
  risk:
    approval_required: true
    risk_levels:
      write_case_note: high
      get_member_profile: low
  retrieval:
    enabled: true
    strategy: semantic
    top_k: 5
```

### `memory.yaml` — What the agent remembers

```yaml
memory:
  enabled: true
  scopes:
    - short_term
    - episodic
    - semantic
  write_policies:
    episodic:
      enabled: true
      trigger: end_of_turn
    semantic:
      enabled: true
      trigger: on_insight
```

### `prompt-defaults.yaml` — How the agent thinks and talks

```yaml
system_prompt: |
  You are a care management assistant helping nurses prepare for member calls.
  ALWAYS use bullet points. Never respond in paragraph form.
  Group bullets under bold headers: **Member**, **Concerns**, **Tasks**, **Notes**.

persona:
  tone: clinical
  audience: registered_nurse
```

---

## Where Does Business Logic Go?

**For a `chat_agent` — business logic lives in `llm_planner.py`.**

This is where you put:
- Which tool to call for which user intent
- How to extract domain IDs (member ID, case ID, claim ID) from the message
- Hard-coded rules ("if user asks about medication, always call get_medication_history first")
- Conditional routing ("if no assessment ID found in context, ask the user before proceeding")

**Is it the same for all agent types? No.**

Every agent type has a `build_graph.py` — but it plays a different role depending on the agent type:

| Agent Type | Role of build_graph.py | Where business logic actually lives |
|---|---|---|
| `chat_agent` | Plumbing — always wires planner → executor → responder. You never change this wiring for business reasons. | `llm_planner.py` — tool selection, ID extraction, routing decisions |
| `summary_agent` | Logic — the fetch → synthesize → return sequence is itself a business decision. Changing what gets fetched means changing the graph. | `build_graph.py` + `summarizer.py` |
| `workflow_agent` | Logic — step ordering, parallel vs sequential, conditional branching are all business rules expressed as graph edges. | `build_graph.py` |
| `supervisor_agent` | Logic — which sub-agent gets the conversation and under what condition. | `build_graph.py` + `router.py` |

**The rule of thumb:**

> If you are changing *what decision gets made at runtime* → edit the planner or router.
> If you are changing *what steps happen and in what order* → edit `build_graph.py`.

---

## Summary — The Mental Model

```
Your repo
├── overlays/          ← WHAT you want the agent to do     (you own this)
│   ├── config/        ← HOW it's configured                (edit freely)
│   └── agents/        ← HOW it routes and responds         (edit carefully)
└── services/          ← HOW the platform runs it           (never edit)
```

Three questions to answer before touching any file:
1. Am I changing **behavior** (what the agent says/does)? → `prompt-defaults.yaml`
2. Am I changing **tools or risk** (what it can call, what needs approval)? → `agent.yaml`
3. Am I changing **routing logic** (when to call which tool)? → `llm_planner.py`

Everything else is platform internals.
