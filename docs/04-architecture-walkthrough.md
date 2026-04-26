# Section 4 — Architecture Walkthrough

## The Full Picture

The platform has five layers. Every user message passes through all five in sequence:

```
┌──────────────────────────────────────────────────────────────────────┐
│  1. UI (React)                                                       │
│     User types a message → POST /invoke with member/case/thread IDs  │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ HTTP POST /invoke
┌───────────────────────────────▼──────────────────────────────────────┐
│  2. Agent Runtime — PRE-GRAPH (FastAPI / LangGraphRunner)            │
│                                                                      │
│   a. Auth + build ctx  (IDs, agent config, prompts, memory policy)  │
│                                                                      │
│   b. Memory READ ─────────────────────────────────► Memory Store    │
│      short-term / episodic / semantic / summary                      │
│      → injected into ctx["memory_context"]                           │
│                                                                      │
│   c. Pre-Graph RAG (if retrieval.pre_graph.enabled) ──► Vector DB   │
│      query KB with user message → inject chunks into ctx["rag_context"]│
│      (ambient enrichment — runs silently before planner sees input)  │
│                                                                      │
│   d. ctx = request + memory + rag_context + config → invoke graph   │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ graph.invoke(state)
┌───────────────────────────────▼──────────────────────────────────────┐
│  3. LangGraph — Overlay Graph                                        │
│                                                                      │
│   PLANNER  (llm_planner.py)                                          │
│   │  Input: prompt + history + full ctx (memory + rag_context)       │
│   │  Filters tool list: allowed list × context availability          │
│   │  LLM picks: TOOL_CALL (tool + args)  or  LLM_ROUTE (no tool)    │
│   │                                                                  │
│   ▼                                                                  │
│   EXECUTOR  (executor.py)  ← only node that calls Tool Gateway       │
│   │  Checks tool risk level from agent.yaml                          │
│   │                                                                  │
│   ├── low/medium risk ──► HTTP POST /invoke/{tool} ──► Tool Gateway  │
│   │                            result returned to responder          │
│   │                                                                  │
│   └── high risk (HITL) ──► store approval request                   │
│                             return APPROVAL_REQUIRED to responder    │
│                             Tool Gateway NOT called yet              │
│   ▼                                                                  │
│   RESPONDER  (chat_responder.py)                                     │
│      Input: tool result  OR  APPROVAL_REQUIRED signal                │
│      LLM formats final answer (or "awaiting approval" message)       │
│      Fires on EVERY turn — fires TWICE on HITL turns                 │
└──────────┬──────────────────────────────┬────────────────────────────┘
           │ (normal path)                │ (HITL path — async)
           │ answer returned              │ approval pending…
           ▼                             ▼
┌──────────────────────┐    ┌────────────────────────────────────────┐
│  4. Tool Gateway     │    │  Approval Store (SQLite)               │
│  Validates + routes  │    │  Admin UI: approver approves/rejects   │
│  to adapter          │    │  POST /approvals/{id}/decision         │
│  Epic / Pega /       │    │  → Executor resumes → Tool Gateway     │
│  Lambda / Vector DB  │    │  → Responder fires (call 2) → answer  │
└──────────┬───────────┘    └────────────────────────────────────────┘
           │ result
┌──────────▼───────────────────────────────────────────────────────────┐
│  5. Agent Runtime — POST-GRAPH (memory write)                        │
│                                                                      │
│   short-term  → every turn, always                                   │
│   episodic    → only on write-tool success (write_case_note etc.)    │
│   semantic    → extract key facts, store for future retrieval        │
│   summary     → compress older turns when threshold is hit           │
│                                                                      │
│   → See Section 7 (Memory) for full detail                           │
└──────────────────────────────────────────────────────────────────────┘
```

---

## The Complete Request Flow — Everything Together

Every user message goes through this exact sequence. No exceptions.

```
User message arrives
     │
     ▼ ─── PRE-GRAPH — no LLM calls ──────────────────────────────────
     │
     ├── 1. Auth + build ctx
     │      IDs (member, case, assessment, thread) + agent config + prompts
     │
     ├── 2. Memory READ (no LLM)
     │      fetch short-term turns, episodic events, semantic facts, summary
     │      → injected into ctx["memory_context"]
     │
     ├── 3. Pre-Graph RAG (no LLM) — if enabled
     │      embed query → search KB → inject chunks into ctx["rag_context"]
     │      3 dimensions apply here: strategy (Dim 1), which KB (Dim 2), pattern (Dim 3)
     │
     ├── 4. Domain context fetch (no LLM) — if IDs present in ctx
     │      case_id → fetch member summary, assessment summary
     │      → injected into ctx["domain_context"]
     │
     ▼ ─── IN-GRAPH ───────────────────────────────────────────────────
     │
     ├── 5. PLANNER (LLM call 1)
     │      reads: user message + memory + RAG chunks + domain context
     │      filters tool list: allowed list → context availability filter
     │      LLM decides:
     │        ├── TOOL_CALL → which tool + what arguments
     │        └── LLM_ROUTE → answer directly, no tool needed
     │
     ├── 6. EXECUTOR (no LLM)
     │      ├── if LLM_ROUTE → skip, pass through to responder
     │      │
     │      ├── if TOOL_CALL + low/medium risk
     │      │     → POST /tools/invoke to Tool Gateway
     │      │     → tool executes against backend (DB, Lambda, Epic, etc.)
     │      │     → result returned
     │      │
     │      └── if TOOL_CALL + high risk (HITL)
     │            → store approval request
     │            → return APPROVAL_REQUIRED (tool NOT executed yet)
     │
     ├── 7. RESPONDER (LLM call 2)
     │      always fires — on every path
     │      ├── tool result → format into response for nurse
     │      ├── LLM_ROUTE  → generate response directly from ctx
     │      └── APPROVAL_REQUIRED → generate "awaiting approval" message
     │
     ▼ ─── POST-GRAPH — no LLM calls ─────────────────────────────────
     │
     └── 8. Memory WRITE (no LLM)
            short-term  → always, if enabled
            episodic    → only if write-tool succeeded this turn
            semantic    → only if enabled (off by default)
            summary     → only if turn count threshold hit
```

**Key points:**
- Pre-graph (steps 1–4): pure assembly — fetch, embed, inject. **Zero LLM calls.**
- In-graph: exactly **two LLM calls** — planner and responder. Always two, no more.
- If no tool is needed (LLM_ROUTE): executor is skipped, planner feeds directly to responder.
- RAG dimensions (strategy, KB selection, pattern) apply only at step 3 (pre-graph) and when planner calls `search_kb` as its tool. Not anywhere else.
- Post-graph (step 8): pure writes. **Zero LLM calls** (unless semantic extraction is on — that adds one).
- HITL turns fire the responder **twice** — once immediately with "awaiting approval", once after the decision.

---

## Two Types of RAG — Know the Difference

The platform supports two distinct RAG mechanisms. They share the same vector DB and retrieval tool, but they serve completely different purposes and run at different points in the flow.

### Pre-Graph RAG (ambient enrichment)

Runs **before the graph starts**, in the Agent Runtime pre-graph phase (step 2c above).

- Triggered automatically on every turn if `retrieval.pre_graph.enabled: true` in `agent.yaml`
- Calls the configured retrieval tool (`search_kb`) with the user's raw message as the query
- Retrieved KB chunks are injected into `ctx["rag_context"]` — they become part of the full context the graph receives
- The planner and responder both see this content silently, without needing to make an explicit tool call
- Purpose: **ambient enrichment** — give the LLM relevant KB knowledge as background before it decides what to do

When to use: when the KB contains general protocols, guidelines, or reference content that should inform every response — regardless of whether the user is explicitly asking a KB question.

### Planner Tool RAG (explicit KB query)

Runs **inside the graph**, when the planner LLM decides to call `search_kb` as its chosen tool.

- Triggered only when the LLM decides the user's intent is a direct KB question (e.g. "What is the protocol for high-risk discharge?")
- The planner selects `search_kb` just like any other tool — it competes with `get_member`, `write_case_note`, etc.
- Retrieved chunks become the primary tool output for that turn — the responder formats them into the user-facing answer
- Purpose: **explicit KB query response** — the answer IS the KB content

When to use: always on — `search_kb` is always in the allowed tool list for agents that have KB access. The LLM decides when to call it based on intent.

### Key distinction

| | Pre-Graph RAG | Planner Tool RAG |
|---|---|---|
| When it runs | Before graph, every turn | Inside graph, intent-driven |
| Triggered by | Config flag | LLM decision |
| Output goes to | `ctx["rag_context"]` (background) | Responder answer (foreground) |
| User sees it | No — it enriches LLM context silently | Yes — it IS the response |
| Config location | `retrieval.pre_graph` in `agent.yaml` | `tools.allowed` includes `search_kb` |

Both can be active simultaneously. Pre-graph provides ambient enrichment; planner tool handles the case where KB content is the explicit answer. Section 8 (RAG) covers configuration, strategy options, embedding, and tuning in detail.

> **Current limitation — single KB only:** Both RAG paths today hit a single KB. Pre-graph RAG always calls the tool named in `retrieval.default_tool`. Planner tool RAG always calls `search_kb`, which points to one vector store. There is no routing logic — no rules, no LLM classification, no fan-out across multiple KBs. In a real-world scenario with multiple distinct knowledge sources (e.g. clinical guidelines, formulary, member history), the platform would need a multi-KB routing layer: classify the query, select the right KB (or fan out across several), merge and re-rank results. This applies equally to both RAG paths and is on the roadmap. See Section 8 (RAG) for the planned approach.

---

## Step-by-Step: What Happens on Every Message

### Step 1 — UI sends the message

The user types a message in the chat panel and hits send. The UI fires a `POST /invoke` to the agent runtime with:

```json
{
  "message": "What are the open cases for this member?",
  "thread_id": "thread-abc123",
  "member_id": "m-1001",
  "case_id": "case-001",
  "assessment_id": "asmt-001",
  "memory_policy_override": { "episodic": true, "semantic": false }
}
```

The UI sends the full context with every request — member ID, case ID, assessment ID. These come from wherever the user is in the app (which member they have open, which case they're viewing).

---

### Step 2 — Agent Runtime receives the request

The FastAPI server (`app.py`) handles the request. It does four things before handing off to the graph:

**Authentication** — validates the request token, identifies the user and tenant.

**Initial context assembly** — builds a `ctx` object with the request inputs:
- Member/case/assessment IDs from the request
- Agent config loaded from `agent.yaml` (tools, risk levels, retrieval params)
- Prompt config loaded from `prompt-defaults.yaml`
- Memory policy state (which scopes are on, which are overridden by the UI toggle)

**Memory retrieval** — reads from all enabled memory scopes before the graph runs:
- Short-term: recent conversation turns for this thread
- Episodic: past events for this case or member
- Semantic: relevant facts retrieved by similarity search
- Summary: compressed conversation summary if one exists

All retrieved memory is assembled into `memory_context` and injected into `ctx`.

**Pre-Graph RAG (if enabled)** — if `retrieval.pre_graph.enabled: true` in `agent.yaml`, the platform calls `search_kb` with the user's message before the graph runs. The returned KB chunks are stored in `ctx["rag_context"]` as ambient context. The planner and responder both see this content as background — they don't distinguish whether a fact came from memory, the KB, or the current request. See the "Two Types of RAG" section above for when to use this vs the planner tool approach.

**Final context assembly** — at this point `ctx` contains everything: request inputs + memory + RAG results + config. This is passed into the graph as the complete context object.

**Trace started** — a `run_id` is created and the tracer records the start of this execution.

---

### Step 3 — LangGraph runs the overlay graph

The `LangGraphRunner` invokes the overlay's compiled graph with the initial state:

```python
initial_state = {
    "prompt": "What are the open cases for this member?",
    "ctx": ctx,          # full context including memory
    "history": [...],    # recent turns from short-term memory
}
```

The graph executes three nodes in sequence:

**Planner node** (`llm_planner.py`)
- Receives the prompt, history, and full context (including memory + RAG results)
- Extracts domain IDs from the message if not already in context (`m-1001`, `asmt-001`)
- **Builds the filtered tool schema** — starts from the full Tool Gateway registry, applies two filters:
  1. `agent.yaml` allowed list — strips tools this agent is not permitted to use
  2. Context filter — removes tools that require a context field not present (e.g. `assessment_id` not in context means assessment-specific tools are excluded)
- Calls the LLM with the planner system prompt + the filtered tool schema
- LLM returns a structured decision: which tool to call and with what arguments, or `LLM_ROUTE` if no tool needed
- Returns `steps` (the plan) + `planner_trace` (for observability)

The LLM never sees the full tool registry — only the tools that are both allowed for this agent AND relevant given the current context. This is why the planner makes accurate decisions even when many tools are registered.

```
Planner output example:
  tool: get_open_cases
  input: { member_id: "m-1001" }
  route: TOOL_CALL
```

**Executor node** (`executor.py`)

The executor is always present. Its primary job is to call the Tool Gateway — that is the only place in the platform where a tool gets executed. HITL is a gate that sits before that call.

- Receives the plan from the planner
- Looks up the tool's risk level from `agent.yaml`
- **If risk level requires approval** → stores an approval request in the approval store, returns `APPROVAL_REQUIRED` to the responder. The Tool Gateway is NOT called yet. Execution pauses.
- **If no approval needed (normal path)** → calls the Tool Gateway via HTTP immediately, waits for the result, returns tool output + `executor_trace` to the responder
- This is the only node that ever calls the Tool Gateway — the planner and responder never call it directly

**Responder node** (`chat_responder.py`)
- Receives the tool output (or `APPROVAL_REQUIRED` signal from the executor)
- Calls the LLM with the responder system prompt from `prompt-defaults.yaml`
- LLM formats the tool output into a human-readable response following the persona and format rules
- Returns the final `answer` string

The responder fires **on every turn**, including when approval is required. When the executor returns `APPROVAL_REQUIRED`, the responder generates an immediate "pending approval" message so the user knows what's happening. After the approver acts, the responder fires a second time with the final outcome (approved + result, or rejected + reason). See the HITL Branch section below.

---

### Step 4 — Tool Gateway executes the tool

When the executor calls `POST /invoke/get_open_cases`, the Tool Gateway:

1. Looks up `get_open_cases` in its registry
2. Validates the tool exists and the calling agent is allowed to use it
3. Executes the tool — this could be a local Python function, a REST call to Epic/Pega, a Lambda invocation, or a vector DB query
4. Returns the result

The agent runtime never directly touches Epic, Pega, or any backend system. Everything goes through the Tool Gateway. This is the single point of control for all tool execution.

---

### Step 5 — Memory write happens after the graph

After the graph completes, the runtime writes memory based on the write policies in `memory.yaml`:

- **Short-term** — always written if enabled. Stores the raw user prompt + assistant response as a conversation turn.
- **Episodic** — written only on tool success for write-type tools (`write_case_note`, `complete_assessment`, `update_care_plan`). Not written on read queries.
- **Semantic** — written if enabled. Extracts key facts from the exchange and stores them for future similarity retrieval.
- **Summary** — evaluated against trigger conditions (e.g. every 10 turns). Compresses older conversation turns into a summary.

Memory writes happen **after** the response is returned — they do not block the user from getting their answer.

---

### Step 6 — Runtime returns to the UI

The agent runtime returns a single response object:

```json
{
  "answer": "Here are the open cases for member M-1001:\n• Case-001: ...\n• Case-002: ...",
  "ctx": { "thread_id": "...", "member_id": "m-1001", ... },
  "memory_policy": { "short_term": true, "episodic": true, ... },
  "memory_trace": {
    "retrieved": { "short_term_count": 4, "episodic_count": 1 },
    "written": { "short_term": "written", "episodic": "skipped" }
  }
}
```

The UI renders the answer in the chat panel. The memory trace populates the Memory Debug Panel. The execution trace (planner + executor steps) populates the Trace Graph.

---

## The HITL Branch — What Happens on Approval

The executor always runs. On a normal (no HITL) turn it calls the Tool Gateway directly. On a high-risk tool, it pauses and stores an approval request instead. The responder fires **twice** in the HITL path.

```
Normal path (no approval required):

  Planner → Executor → Tool Gateway → Responder → answer returned


HITL path (high-risk tool):

  Turn 1 — user sends message
       │
       ▼
  Planner selects: write_case_note  [high-risk tool]
       │
       ▼
  Executor: risk check → APPROVAL_REQUIRED
       │    stores request in approval_store (SQLite)
       │    does NOT call Tool Gateway yet
       ▼
  Responder (call 1)
       │    LLM generates: "Awaiting approval for write_case_note"
       ▼
  Response returned to UI immediately ← user sees pending message

  ── wait for approver ──────────────────────────────────────────

  UI polls  GET /approvals/pending
  Approver sees request in Admin UI and acts
       │
       ▼
  POST /approvals/{id}/decision
       │
       │
       ├─── APPROVED ────────────────────────────────────────────
       │         │
       │         ▼
       │    Executor resumes: calls Tool Gateway
       │         │
       │         ▼
       │    Responder (call 2): "Case note written successfully"
       │    Memory written: short-term + episodic
       │
       └─── REJECTED ────────────────────────────────────────────
                 │
                 ▼
            Responder (call 2): "Request rejected. Reason: ..."
            Memory written: short-term only
```

The conversation can continue between call 1 and call 2 — the approval resolves asynchronously. The `thread_id` routes the post-decision response back to the correct conversation.

> **Current limitation:** Risk is determined by tool name only — the executor looks up the tool in `risk_levels` and that's it. In a more advanced setup, routing rules could consider the actual argument values (e.g. only require approval if the case note contains certain keywords, or if the member is flagged high-risk). That is not implemented today. Risk is purely tool-level config. See Section 6 (HITL) for the full deep dive and roadmap.

---

## Startup — What Happens When the Container Starts

When the agent runtime Docker container starts (`app.py` at the top):

1. `load_config()` — reads `base.yaml` + environment overrides
2. `register_tools()` — loads local tool definitions from the overlay
3. `load_tools_from_gateway()` — pulls the full tool registry from the Tool Gateway, builds the dynamic LLM schema
4. `approval_store.init_db()` — initializes the SQLite approval database
5. FastAPI starts listening on port 8080

The tool schema the LLM uses is built at startup from the live Tool Gateway registry. This is why adding a new tool to the gateway makes it available to the agent without a code change — just a restart.

---

## What Each Config File Controls at Runtime

| Config File | Controls |
|---|---|
| `agent.yaml` — tools.allowed | Which tools appear in the LLM's tool schema |
| `agent.yaml` — risk.risk_levels | Whether executor pauses for approval before calling the tool |
| `agent.yaml` — retrieval.pre_graph | Whether pre-graph ambient RAG is enabled, top_k, similarity threshold |
| `agent.yaml` — tools.allowed (search_kb) | Whether planner tool RAG is available; LLM decides when to call it |
| `memory.yaml` — scopes | Which memory types are read before the graph runs |
| `memory.yaml` — write_policies | Which memory types are written after the graph completes |
| `prompt-defaults.yaml` — system_prompt | What the planner and responder LLM calls receive as system context |
| `overlay.yaml` | Which overlay folder the platform loads, capability/usecase identity |

No code changes needed to modify any of these behaviors — only config changes.
