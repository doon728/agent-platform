# Section 2 — Agent Types

## Overview

The platform supports four agent types. Each is designed for a different interaction pattern. Choosing the right type upfront determines the structure of your overlay, your graph, and where your business logic lives.

---

## The Four Types

| Agent Type | Interaction Pattern | Triggered by | Has Memory | Has HITL | Has RAG |
|---|---|---|---|---|---|
| `chat_agent` | Back-and-forth conversation | User message | Yes | Yes | Yes |
| `summary_agent` | One-shot fetch and synthesize | UI event (page load, button) | No | No | No |
| `workflow_agent` | Fixed multi-step process | Event or schedule | Optional | Optional | Optional |
| `supervisor_agent` | Routes to other agents | User message | Optional | Optional | Optional |

---

## chat_agent

**What it is:** A conversational agent. The user sends a message, the agent decides what to do, does it, and responds. Stateful — it remembers context across turns.

**When to use it:**
- Any interactive chat interface
- User needs to ask questions, get answers, request actions
- The conversation can go in many directions depending on what the user says

**How it works:**
```
User message → Planner (what tool?) → Executor (call tool + HITL check) → Responder (format answer) → User
```

**What you own in the overlay:**
- `llm_planner.py` — tool selection, context extraction, routing logic
- `agent.yaml` — which tools are allowed, risk levels
- `prompt-defaults.yaml` — persona, tone, format rules
- `memory.yaml` — what to remember across turns

**Real example:** A nurse asks "what are the open cases for member M-1001?" The planner identifies `get_open_cases` as the right tool, extracts `M-1001`, the executor calls the tool gateway, the responder formats the result as bullets.

---

## summary_agent

**What it is:** A stateless, one-shot agent. It receives a scope (assessment, case, member), fetches all relevant data in parallel, synthesizes it into a structured summary, and returns. No conversation, no memory, no HITL.

**When to use it:**
- Auto-generate a summary when a page loads
- Triggered by a button ("Summarize this case")
- Pre-call prep, pre-meeting briefing, daily digest
- Anywhere you need a synthesized view without user interaction

**How it works:**
```
Trigger (scope_type + scope_id) → Fetch (parallel tool calls) → Summarize (LLM synthesis) → Structured output
```

The graph is fixed — always fetch, then summarize. The business logic is in `summarizer.py`: which tools to call for each scope type, and what the LLM is asked to produce.

**What you own in the overlay:**
- `summarizer.py` — which tools to call per scope, synthesis prompt
- `build_graph.py` — fetch → summarize sequence
- `prompt-defaults.yaml` — summarization instructions, output format

**What is intentionally OFF:**
- Memory write — summary_agent never writes to memory (read is optional)
- HITL — no approval needed, it only reads data
- RAG — not applicable, data comes directly from tools

**Real example:** Nurse opens an assessment page. UI fires a `/summary` call with `scope_type=assessment`, `scope_id=asmt-001`. The agent calls `get_assessment_summary` and `get_assessment_tasks` in parallel, passes results to LLM, returns `{ summary, key_concerns, last_action, next_steps }`. The UI renders this in the Summary Panel.

---

## workflow_agent

**What it is:** An agent that executes a predefined sequence of steps. The steps, their order, and the conditions between them are defined as a LangGraph graph. Unlike `chat_agent`, the flow is not driven by user input — it follows a fixed process.

**When to use it:**
- Multi-step business processes: intake → assessment → care plan → notification
- Anything where step A must always complete before step B starts
- Processes with conditional branching: "if risk score > 8, escalate; else continue"
- Automated pipelines triggered by events (admission, discharge, enrollment)

**How it works:**
```
Trigger → Step 1 (node) → Step 2 (node) → [conditional branch] → Step 3a or Step 3b → End
```

The graph IS the business logic. Each node is a discrete action. Edges define the flow. Conditional edges define branching.

**What you own in the overlay:**
- `build_graph.py` — the entire workflow definition: nodes, edges, conditions
- Individual step functions (one per node) — what each step does
- `agent.yaml` — tools and risk levels for steps that call tools

**Real example:** A post-discharge workflow — Step 1: fetch discharge summary. Step 2: run risk assessment. Step 3: if high risk → create urgent care plan; if low risk → schedule follow-up call. Step 4: send notification. Each step is a node, the branching is a conditional edge.

---

## supervisor_agent

**What it is:** An orchestrator agent that routes conversations to specialized sub-agents. The supervisor decides which agent is best equipped to handle the current message and hands off to it. Each sub-agent handles its domain, then hands back.

**When to use it:**
- Complex products with multiple distinct domains (clinical, billing, scheduling, benefits)
- When one agent can't handle everything but the user experiences a single conversation
- Specialist escalation — "I can't answer this, routing to clinical specialist"

**How it works:**
```
User message → Supervisor (which agent?) → Sub-agent A or B or C → Response → Back to Supervisor
```

**What you own in the overlay:**
- `build_graph.py` — which agents exist, handoff conditions
- `router.py` — the routing decision logic (LLM-based or rule-based)
- Each sub-agent has its own full overlay

**Real example:** A healthcare assistant that handles both clinical questions and billing questions. The supervisor sees "what's my copay?" and routes to the billing_agent. It sees "what are my member's medications?" and routes to the clinical_agent. The user never knows there are two agents.

---

## Choosing the Right Type

| If you need... | Use |
|---|---|
| A chat interface where users ask questions | `chat_agent` |
| Auto-generate a summary when a screen loads | `summary_agent` |
| A fixed business process with defined steps | `workflow_agent` |
| One conversation that spans multiple domains | `supervisor_agent` |
| A summary triggered mid-conversation | `chat_agent` calling `summary_agent` as a tool |
| Parallel processing within a workflow | `workflow_agent` with fan-out nodes |

---

## How They Coexist in One Repo

Multiple agent types can live in the same repo under separate overlay folders:

```
overlays/
├── chat_agent/        ← interactive chat
└── summary_agent/     ← one-shot summaries
```

The platform loads the correct overlay based on the `agent_type` field in the API request. Both share the same tool gateway, the same memory backend, and the same platform runtime — only the overlay graph differs.

This is why the care management repo has both `chat_agent` and `summary_agent` — they serve different interaction patterns but share all the underlying infrastructure.
