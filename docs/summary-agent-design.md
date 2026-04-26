# Summary Agent — Design Spec

## Overview

A second agent overlay within the same usecase (`UC_PreCall_Assess`) that generates structured
summaries at three levels: assessment, case, and member. Triggered by UI page loads and
explicit refresh — not by chat.

---

## Placement in Repo

```
usecases/UC_PreCall_Assess/cm-chat-buddy-assess/
  overlays/
    chat_agent/          ← existing nurse chat agent
    summary_agent/       ← new
      agents/
        summarizer.py    ← single-node graph (no planner)
      config/
        agent.yaml
        prompt-defaults.yaml
```

Same usecase, same repo, second agent type. The `AGENT_TYPE` env var selects which
overlay to load at runtime. A separate agent-runtime instance (or route prefix) runs
`summary_agent`.

---

## Graph Design

Unlike `chat_agent` (planner → router → executor), the summary agent has a flat 2-node graph:

```
fetch_node
    ↓  (parallel tool calls, results merged)
summarize_node
    ↓  (LLM synthesizes into structured narrative)
return summary
```

No planner. No router. Deterministic — always fetches the same data for a given scope,
always summarizes.

### fetch_node
- Calls existing tools in parallel: `get_member`, `get_assessment_summary`, `get_assessment_tasks`
- For case-level: calls `get_member` + all assessments under the case
- For member-level: calls `get_member` + all cases + their assessments (rollup)
- Uses existing tool gateway — no new data pipeline

### summarize_node
- Takes all fetched tool results as context
- Calls LLM with a scope-specific prompt (assessment / case / member)
- Returns structured output:
  ```json
  {
    "scope": "assessment",
    "scope_id": "asmt-000001",
    "summary": "...",
    "key_concerns": ["...", "..."],
    "last_action": "...",
    "next_steps": ["..."],
    "generated_at": "2026-03-24T..."
  }
  ```

---

## Summary Levels

| Level | Triggered from | Tools called | Scope |
|---|---|---|---|
| Assessment | AssessmentView page load | `get_assessment_summary`, `get_assessment_tasks` | Single assessment |
| Case | CaseView page load | `get_member` + all assessments under case | All assessments in case |
| Member | MemberProfile page load | `get_member` + all cases + assessments | Full member history |

Each level rolls up from the one below — member summary is informed by case summaries,
case summary is informed by assessment summaries.

---

## Caching Strategy (Hybrid)

```
Page opens
    ↓
Check memory store for existing summary (scope_type + scope_id)
    ↓
Exists + fresh (< 30 min)?  → show immediately
Stale or missing?           → generate now (spinner), cache result
    ↓
User clicks Refresh         → force regenerate, update cache
    ↓
Auto-invalidate trigger     → regenerate after write_case_note or
                              complete_assessment succeeds
```

Cache stored in the existing `FileMemoryStore` under scope `assessment`, `case`, or `member`.
Key: `summary:{scope_type}:{scope_id}`.

---

## API

New endpoint on agent-runtime (or a second instance):

```
POST /summarize
{
  "scope_type": "assessment" | "case" | "member",
  "scope_id": "asmt-000001",
  "tenant_id": "t1",
  "force_refresh": false
}

→ {
  "summary": "...",
  "key_concerns": [...],
  "last_action": "...",
  "next_steps": [...],
  "generated_at": "...",
  "cached": true | false
}
```

---

## UI Integration

### Collapsible Summary Panel (shared component)

```
┌─ AI Summary ──────────────────────────────── refreshed 4 min ago  [Refresh] ─┐
│ Member has 3 active cases. Primary concern is uncontrolled hypertension...    │
│                                                                                │
│ Key concerns:  • Medication non-compliance  • Missed follow-up appt           │
│ Last action:   Case note written 2026-03-22                                   │
│ Next steps:    • Schedule follow-up call  • Confirm pharmacy refill           │
└───────────────────────────────────────────────────────────────────────────────┘
[existing structured data continues below]
```

- Collapsed by default, expands on click
- Shows `generated_at` timestamp so nurse knows freshness
- `[Refresh]` button triggers `POST /summarize` with `force_refresh: true`
- Spinner while generating
- Error state if agent fails (shows last cached version if available)

### Pages that get the panel

| Page | scope_type | scope_id source |
|---|---|---|
| `AssessmentView` | `assessment` | URL param `:assessmentId` |
| `CaseView` | `case` | URL param `:caseId` |
| `MemberProfile` | `member` | URL param `:memberId` |

---

## agent.yaml for summary_agent

```yaml
agent:
  type: summary_agent
  planner_mode: none       # no planner — deterministic graph

tools:
  mode: selected
  allowed:
    - get_member
    - get_assessment_summary
    - get_assessment_tasks

features:
  memory: true
  rag: false               # no RAG — summarizes structured tool output
  hitl: false              # summaries don't need approval
  observability: true
```

---

## Prompt Design (prompt-defaults.yaml)

```yaml
assessment_summary_prompt: |
  You are a clinical documentation assistant. Given the following assessment data,
  produce a concise clinical summary for a care manager reviewing before a call.

  Focus on:
  - Current status and key clinical concerns
  - Most recent action taken
  - Recommended next steps

  Return JSON with keys: summary, key_concerns (list), last_action, next_steps (list).
  Be concise. Clinical language. No filler.

case_summary_prompt: |
  Summarize the following case across all its assessments.
  Identify patterns, outstanding issues, and overall trajectory.
  Return JSON: summary, key_concerns, last_action, next_steps.

member_summary_prompt: |
  Provide a holistic member summary across all cases and assessments.
  Identify the member's primary health concerns, engagement level,
  and overall care plan status.
  Return JSON: summary, key_concerns, last_action, next_steps.
```

---

## Implementation Steps (when ready to build)

1. Create `overlays/summary_agent/` directory structure
2. Write `summarizer.py` — 2-node LangGraph (fetch + summarize)
3. Add `agent.yaml` and `prompt-defaults.yaml` for summary_agent
4. Add `POST /summarize` endpoint to `app.py` with cache check
5. Build `SummaryPanel` React component (collapsible, refresh button, spinner)
6. Wire into `AssessmentView`, `CaseView`, `MemberProfile` pages
7. Add auto-invalidation hook in executor when `write_case_note` succeeds

---

## RAG and Memory — Architecture Decisions

### No RAG (Dimension 1 or Dimension 2)

The summary agent has no RAG — neither D1 nor D2.

**Dimension 1** (search strategy — vector, keyword, graph) only applies when doing unstructured
document search against a knowledge base. The summary agent fetches structured records by known
IDs (`assessment_id`, `case_id`, `member_id`) via direct tool calls. That is a direct lookup,
not a vector search. No D1.

**Dimension 2** (pipeline design — naive, multi-hop, agentic) only applies when there is a
retrieval pipeline over a KB. Since there is no KB search at all in this agent, there is no D2.

The `overlay.yaml` for `summary_agent` will have no `rag_dimension2` field. As a result,
the RAG section will not appear in the Agent Factory UI when this agent type is selected.

### Tools Yes — But Hardcoded, Not LLM-Planned

The fetch_node calls tools from the tool gateway — but unlike `chat_agent`, the tool calls are
hardcoded in code, not decided by an LLM planner. The planner in `chat_agent` decides dynamically
which tools to call based on the user's question. In `summary_agent`, fetch_node always calls the
same fixed set of tools in parallel.

| | chat_agent | summary_agent |
|---|---|---|
| Who decides which tools to call | LLM planner | hardcoded in fetch_node |
| Tool calls per turn | 1 at a time, iterative | All in parallel, one shot |
| RAG tools (KB search) | Yes | No |

### No memory.yaml, HITL, or Risk Config — In This Platform

In this platform today, `summary_agent` has no `memory.yaml`, no `hitl` config, and no risk config:

- **No memory** — no conversation to remember; each summary call is stateless
- **No HITL** — read-only fetch + summarize, no write operations that need approval
- **No risk config** — no actions that could modify data

The only config files needed are `agent.yaml` (tools + feature flags) and `prompt-defaults.yaml`
(summarize prompt templates).

### Real World — Memory Would Apply

In production, the summary agent would also pull from **episodic memory** (past case interactions)
and **semantic memory** (accumulated member facts) to enrich the summary beyond what the structured
tool calls return. In that case, `memory.yaml` would be needed and the summary would incorporate
vector-retrieved context alongside the structured records.

This is not built today because the platform uses flat file memory storage, not a vector DB.
In the platform today, the summary is generated entirely from structured tool call results.

---

## Open Questions

- Should member-level summary be generated lazily (only when viewed) or eagerly
  (triggered whenever a case under that member changes)?
- Should `key_concerns` and `next_steps` be clickable — e.g. clicking a next step
  pre-fills the nurse chat with that action?
- Should summaries be versioned so nurses can see how the member's status changed
  over time?
