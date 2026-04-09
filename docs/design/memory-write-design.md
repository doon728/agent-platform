# Memory Write — Complete Design

> Status: Design complete. Implementation pending (backlog items 6c–6n).
> Scope: `chat_agent` and `summary_agent` only. `workflow_agent` deferred — see backlog 6d.

---

## What This Document Covers

Complete design for memory write across all memory types, all backends, all agent types (in scope), reasoning strategy interactions, semantic extraction patterns, and admin UI configurability. Everything in this document should be implementable without changing the design — it is the reference for building.

---

## Agent Type Scope

| Agent Type | Memory Write Status |
|---|---|
| `chat_agent` | Full design below |
| `summary_agent` | Full design below |
| `workflow_agent` | **Deferred** — per-step memory config requires workflow builder UI first (backlog 6d) |

---

## Phase 1 — Write Gate (every write passes through this first)

Every write attempt — regardless of memory type — checks these gates in order:

1. `memory.enabled` globally on for this agent?
2. `memory.<type>.write.enabled` on for this memory type?
3. `memory.<type>.write.locked` — hard block, cannot be overridden by admin
4. Agent type capability matrix — does this agent type allow writes for this memory type?
5. Is the write scope present and active in domain.yaml?

**If any gate fails → skip and log reason. Never silent drop.**

### write_locked — how it works

`write_locked: true` is NOT set by the developer in a config file. It is set by the **platform automatically based on agent type at scaffold/registration time**. The agent type capability matrix is the source of truth.

- `summary_agent` registered → platform sets `write_locked: true` on episodic + semantic automatically
- Admin sees the toggle grayed out with a lock icon + tooltip: "summary_agent cannot write episodic memory"
- Runtime enforces it independently — `write_engine.py` checks `write_locked` and hard-blocks regardless of what's in the YAML
- Developer never touches `write_locked` directly

---

## Phase 2 — Write Triggers Per Memory Type

Triggers differ per memory type. Not all are configurable.

| Memory Type | Trigger | Configurable? | Where in execution |
|---|---|---|---|
| Short-term | Every turn — post-final always. Mid-loop if `write_intermediate_steps: true` | Toggle only | Post-graph (final). In-graph (intermediate steps). |
| Episodic | Event-driven — tool call completes, turn completes | Which tools trigger via `write_on_tool_call.tools` | In-graph (post-tool). Post-graph (post-final). |
| Semantic | Post-final — LLM extracts facts after every turn | Extraction model + dedup threshold only. Trigger not configurable. | Post-graph always |
| Summary | Threshold-driven | `trigger: explicit \| turn_count \| token_threshold \| never` | Post-graph hook in app.py |

### Three execution moments

**A. In-graph — post-tool (executor node, any strategy)**
- Fires after any tool call completes (HITL or direct)
- Episodic write only
- HITL-conditioned: approved → write outcome. Rejected → write rejection only, no result.
- Config: `write_on_tool_call.tools: write_only | all | [explicit list]`
- Default: `write_only` — read tools (get_member, search_kb) produce no episodic entry

**B. In-graph — mid-loop (executor loop, ReAct / multi_hop only)**
- Fires after each think → act → observe iteration
- Short-term write if `write_intermediate_steps: true`
- Episodic write if `write_mode: per_iteration`
- **Dependency:** multi_hop not yet built — wire this when multi_hop is implemented (backlog 10n)

**C. Post-graph — post-final-response (app.py, every turn, every strategy)**
- Short-term: final user + assistant message pair
- Episodic: post_final write (if not already written per-iteration)
- Semantic: LLM extraction → dedup → write facts
- Summary: check trigger threshold → invoke summary_agent if threshold hit

### Where writes live in code
- **In-graph writes (A + B)** — inside executor node in `build_graph.py`. Must be here — post-graph has lost per-tool/per-iteration context.
- **Post-graph writes (C)** — in `app.py` after `graph.invoke()` completes. Today's location for all writes.

---

## Phase 3 — What Gets Written Per Memory Type

### Short-term

| Property | Value |
|---|---|
| What | Final user message + assistant response |
| Extra (opt-in) | Intermediate thought/action/observation steps (ReAct/multi_hop only) |
| Backend | memory (session-scoped) → SQLite → PostgreSQL (LangGraph checkpointer) |
| Lifetime | Session only (memory backend) / persistent by thread_id (SQLite/Postgres) |
| Pruning | TTL + session count — only when backend is SQLite/Postgres |

Config:
```yaml
memory:
  short_term:
    write:
      enabled: true
      write_intermediate_steps: false    # true = write thought/action/observation per ReAct iteration
      max_content_tokens: 1000
      truncation: tail                   # head | tail | smart
    backend: memory                      # memory | sqlite | postgres
    pruning:
      ttl_days: 28
      max_sessions: 4
```

`write_intermediate_steps` UI: shown only when `reasoning.strategy` is `react` or `multi_hop`.

---

### Episodic

| Property | Value |
|---|---|
| What | Events: tool calls, HITL outcomes, key exchanges |
| Scope | All active scopes from domain.yaml — no hardcoded scope names |
| Write mode | `post_final` (default) or `per_iteration` (react/multi_hop only) |
| Backend | file → S3 → DynamoDB |
| Lifetime | Persistent across sessions |
| Pruning | TTL + max entries per scope |

Config:
```yaml
memory:
  episodic:
    write:
      enabled: true
      write_locked: false               # set by platform based on agent type, not by admin
      write_mode: post_final            # post_final | per_iteration
      write_on_tool_call:
        enabled: true
        tools: write_only
      max_content_tokens: 500
      truncation: tail
    backend: file
    pruning:
      ttl_days: 30
      max_entries: 100
```

`write_mode: per_iteration` UI: shown only when strategy is `react` or `multi_hop`.

**Agent type rules:**
- `chat_agent` — R/W, both modes available
- `summary_agent` — `write_locked: true` (platform-set), episodic write blocked entirely

---

### Semantic

| Property | Value |
|---|---|
| What | Persistent facts extracted from the exchange |
| Scope | Driven by fact's `target_scope` (member, user, or any domain scope from domain.yaml) |
| Extraction | LLM-based with RAG Dim 3 pattern — not keyword rules |
| Dedup | Vector similarity check before write — update in place if similar fact exists |
| Backend | file → pgvector (required for vector dedup + retrieval) |
| Lifetime | Persistent across sessions |
| Pruning | Relevance scoring |

**Semantic write is NOT a RAG operation.** Dim 3 patterns are for KB retrieval only — they do not apply here.

**How the system knows what is a fact:** LLM call using a cheap model (Claude Haiku) after every turn:
> "Extract any persistent facts about the member or user from this conversation. Facts are things that remain true beyond this session — preferences, barriers, medical context, behavioral patterns. Return structured JSON."

The LLM decides what is a fact. Platform writes what comes back. This replaces the current broken approach in `semantic_engine.py` (3 hardcoded keyword rules).

Write pipeline: LLM extracts facts → dedup check against existing facts for this scope → write new / update existing.

Config:
```yaml
memory:
  semantic:
    write:
      enabled: true
      write_locked: false               # set by platform based on agent type
      extraction:
        model: claude-haiku-4-5         # cheap model for extraction
      dedup:
        enabled: true
        threshold: 0.85                 # cosine similarity — update existing fact if above this
      max_content_tokens: 200
    backend: file                       # file | pgvector (pgvector required for vector dedup)
    pruning:
      relevance_threshold: 0.4
```

**Agent type rules:**
- `chat_agent` — R/W, full extraction + dedup
- `summary_agent` — `write_locked: true` (platform-set), semantic write blocked entirely

---

### Summary

| Property | Value |
|---|---|
| What | Compressed narrative of a session or case period |
| Written by | `summary_agent` only — `chat_agent` has `write_locked: true` for summary |
| Trigger | turn_count / token_threshold / explicit / never |
| Backend | file → S3 |
| Lifetime | Persistent, TTL-pruned |

Config:
```yaml
memory:
  summary:
    write:
      enabled: true
      write_locked: true                # chat_agent: always locked. summary_agent: unlocked
      trigger: explicit                 # turn_count | token_threshold | explicit | never
      turn_count_threshold: 20          # write summary every N turns (turn_count mode)
      token_threshold: 8000             # write when short-term exceeds N tokens (token_threshold mode)
    backend: file
    pruning:
      ttl_days: 7
```

**Trigger modes:**
- `explicit` — only when nurse/admin clicks "Generate Summary" (today's behavior)
- `turn_count` — platform auto-invokes summary_agent every N turns (not yet built)
- `token_threshold` — platform auto-invokes when short-term exceeds token budget (not yet built)
- `never` — summary agent disabled for this usecase

`turn_count` and `token_threshold` require platform-level hooks in `app.py` post-graph lifecycle — not yet built.

**Agent type rules:**
- `summary_agent` — write unlocked, this is its purpose
- `chat_agent` — `write_locked: true` (platform-set), cannot write summary

---

## Phase 4 — Audit Metadata (always stamped, no toggle)

Every write — regardless of memory type — stamps:

```python
{
    "agent_id": ctx["agent_id"],
    "agent_type": ctx["agent_type"],              # chat_agent | summary_agent
    "reasoning_strategy": ctx["reasoning_strategy"],  # react | simple | plan_execute
    "turn_id": ctx["turn_id"],
    "thread_id": ctx["thread_id"],
    "tenant_id": ctx["tenant_id"],
    "timestamp": datetime.now(timezone.utc).isoformat(),
    "scope_type": scope["scope_type"],
    "scope_id": scope["scope_id"],
}
```

These fields must be carried through `ctx` from `app.py` through the full lifecycle into all write calls. Not configurable — always on.

---

## Phase 5 — Reasoning Strategy × Memory Write

| Strategy | Mid-loop (Phase A) | Post-tool (Phase B) | Post-final (Phase C) | Notes |
|---|---|---|---|---|
| `simple` | ✗ | ✅ single tool | ✅ | |
| `react` | ✅ if per_iteration | ✅ each iteration | ✅ | `write_intermediate_steps` config applies |
| `plan_execute` | ✗ | ✅ each step | ✅ | |
| `multi_hop` | ✅ if per_iteration | ✅ each hop | ✅ | `write_intermediate_steps` config applies |
| `reflection` | ✗ | ✅ | ✅ | reflection content written to episodic |
| `tree_of_thought` | ✗ | ✅ per branch | ✅ best branch only | only winning branch written |

**Key rule:** `per_iteration` episodic write mode only meaningful for `react` and `multi_hop`. UI hides this option for all other strategies.

**Dependency:** when `multi_hop` and `reflection` strategies are built, `memory_writer.py` must be updated to support `per_iteration` write mode. Do not build those strategies without also updating memory writer.

---

## Phase 6 — Agent Type × Memory Type Write Matrix

| | Short-term write | Episodic write | Semantic write | Summary write |
|---|---|---|---|---|
| `chat_agent` | ✅ always | ✅ configurable | ✅ configurable | ✗ locked off |
| `summary_agent` | ✗ locked off | ✗ locked off | ✗ locked off | ✅ always |
| `workflow_agent` | **deferred** | **deferred** | **deferred** | **deferred** |

`locked off` = `write_locked: true` set by platform at registration time based on agent type. Admin sees grayed toggle + lock icon. Runtime hard-blocks independently.

---

## Admin UI — Agent Registry Memory Tab

Everything below is per memory type. UI filters what's shown based on agent type capability matrix.

| Config | UI control | Shown when |
|---|---|---|
| `write.enabled` | Toggle | Always (grayed + locked icon if write_locked) |
| `write_mode` | Dropdown: post_final / per_iteration | Strategy = react or multi_hop |
| `write_on_tool_call.tools` | Dropdown: write_only / all / custom list | Episodic only |
| `extraction.pattern` | Dropdown: naive / self_corrective / multi_hop | Semantic only |
| `extraction.threshold` | Slider 0–1 | Semantic, self_corrective pattern |
| `dedup.enabled` + `dedup.threshold` | Toggle + slider | Semantic only |
| `write_intermediate_steps` | Toggle | Short-term, strategy = react or multi_hop |
| `summary.trigger` | Dropdown: explicit / turn_count / token_threshold / never | Summary only |
| `summary.turn_count_threshold` | Number input | Summary, trigger = turn_count |
| `summary.token_threshold` | Number input | Summary, trigger = token_threshold |
| `max_content_tokens` | Number input | All types |
| `truncation` | Dropdown: head / tail / smart | All types |
| `backend` | Dropdown | All types (options vary per type) |
| Pruning config | Fields vary per type | All types |

---

## What's Not UI Configurable

| Item | Why |
|---|---|
| `write_locked` | Platform-set from agent type — admin cannot override |
| Audit metadata fields | Always stamped, no toggle |
| Write scopes | Come from `domain.yaml` — developer-defined per capability |
| Agent type capability matrix | Platform contract — not per-agent config |

---

## Backlog Items Covering This Design

| Item | What |
|---|---|
| 6c | Memory Read/Write Split — base toggle separation |
| 6d | workflow_agent per-step memory — deferred |
| 6e | Semantic write with RAG Dim 3 extraction patterns |
| 6f | Semantic write deduplication |
| 6g | Write scope enforcement from domain.yaml |
| 6h | write_locked runtime enforcement |
| 6i | Write conditioned on HITL outcome |
| 6j | Write audit metadata |
| 6k | Direct tool call episodic write |
| 6l | Short-term intermediate steps write config |
| 6m | Summary write trigger config |
| 6n | Write size limits + truncation |
| 10n | Reasoning strategies — memory write dependency documented there |
