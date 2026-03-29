# Section 9 — Memory

## What Memory Is and Why It Matters

Without memory, every message the agent receives is the first message it has ever seen. The nurse says "write the case note we discussed" — the agent has no idea what was discussed. The nurse opens the same case tomorrow — the agent has no history.

Memory gives the agent continuity. It knows what happened in this conversation, what happened in previous conversations on this case, and what stable facts it has learned about this member. The right memory in context at the right time is what makes an agent feel intelligent rather than amnesiac.

---

## Four Memory Types

Each type serves a different purpose and operates at a different time horizon.

### Short-Term Memory

**What it is:** raw conversation turns — every user message and agent response in the current thread.

**Scope:** conversation (thread-level)

**Written:** every turn, always, if enabled

**Read back:** next turn — the agent sees recent turns as its conversation history

**Purpose:** conversational continuity within a session. Without this, every message is a cold start.

```
Turn 1: "What are the open tasks for this assessment?"
Turn 2: "Show me the member summary"
Turn 3: "Write a case note summarizing what we found"  ← agent knows what "we found" refers to
```

**Config:**
```yaml
write_policies:
  short_term:
    enabled: true
    trigger: every_turn
    primary_scope: conversation
    retain_last_n_turns: 12
```

---

### Episodic Memory

**What it is:** significant clinical events — tool executions, workflow checkpoints, completed assessments.

**Scope:** case or assessment level

**Written:** only on write-tool success (`write_case_note`, `complete_assessment`, `update_care_plan`) — not on every turn

**Read back:** when the same case or assessment is in context — surfaced as past events the agent can reference

**Purpose:** cross-session clinical continuity. A different nurse picks up the case tomorrow and the agent already knows "a case note was written on March 15, an assessment was completed on March 20."

```yaml
write_policies:
  episodic:
    enabled: true
    triggers:
      - tool_success
      - workflow_checkpoint
      - assessment_completed
    allowed_scopes:
      - case
      - assessment
```

---

### Semantic Memory

**What it is:** stable facts extracted from conversations — member preferences, recurring patterns, important clinical observations.

**Scope:** member or user level

**Written:** when enabled, after each turn — an LLM extractor identifies stable facts worth keeping

**Read back:** when the same member is in context — surfaced as known facts about this member

**Purpose:** long-horizon member knowledge. "This member prefers morning calls." "Member has repeatedly declined medication changes." Facts that don't change turn to turn but are worth remembering across sessions.

```yaml
write_policies:
  semantic:
    enabled: false          # off by default — LLM extraction has cost
    trigger: extractor
    extractor_profile: stable_fact_extractor_v1
    confidence_threshold: 0.85
    allowed_scopes:
      - member
      - user
```

**Why off by default:** semantic extraction requires an LLM call on every turn. Cost and latency add up. Turn it on only when the usecase genuinely benefits from long-horizon member facts.

---

### Summary Memory

**What it is:** a compressed summary of older conversation turns — replaces raw turns to keep context window manageable.

**Scope:** conversation level

**Written:** triggered when turn count hits a threshold (every 10 turns by default)

**Read back:** injected as a single summary item instead of the full raw turn history

**Purpose:** context window management. After 10+ turns, the raw history is too long. The summary compresses it into a concise narrative the LLM can use.

```yaml
write_policies:
  summary:
    enabled: true
    triggers:
      every_n_turns: 10
    allowed_scopes:
      - conversation
      - case
```

---

## Memory Scopes — Where Memory Lives

Each memory record is stored under a **scope** — a named context boundary. The scope determines which memory is visible and to whom.

### Scope Taxonomy

```
conversation  → thread-level (one per chat session)
user          → the logged-in nurse/user
member        → the patient/member
case          → a specific case for a member
assessment    → a specific assessment within a case
care_plan     → a specific care plan
```

### Scope Hierarchy

Scopes form a hierarchy. Memory rolls up from child to parent:

```
member
  └── case
        └── assessment
```

When a nurse opens a **case**, the platform reads:
- Short-term: turns from this conversation thread
- Episodic: events from this case AND all assessments under it (rollup)

When a nurse opens a **member** profile, the platform reads:
- Semantic: facts about this member
- Episodic: events from all cases under this member AND all assessments under those cases (full rollup)

This rollup is automatic — the `register_child_scope` call in the write engine links child scopes to parents at write time, so retrieval can traverse the hierarchy.

### How Scopes Are Resolved

At the start of each request, `scope_resolver.py` looks at `ctx` and builds the active scope list from whatever IDs are present:

```python
if thread_id:   → scope: conversation
if user_id:     → scope: user
if member_id:   → scope: member
if case_id:     → scope: case
if assessment_id: → scope: assessment
if care_plan_id:  → scope: care_plan
```

Only scopes with IDs in context are active. If the nurse is on the Member page (no case open), `case` and `assessment` scopes are not active — no case or assessment memory is retrieved.

---

## Memory Flow — Write and Retrieve

This is the most important section. For each memory type: **when** it is written, **how** it is written, **where** it is stored, **when** it is retrieved, **how** it is retrieved, and **what** is retrieved.

---

### Short-Term Memory

| Dimension | Detail |
|---|---|
| **When written** | Every turn, unconditionally, if enabled |
| **How written** | `write_raw_turns(user_prompt, assistant_response)` — one record per turn, appended to store |
| **Where stored** | File today (`/app/state/memory/<thread_id>/short_term.json`). Swap-in: Redis (fast, TTL support) |
| **When retrieved** | Every turn, pre-graph, before the graph runs |
| **How retrieved** | Simple recency-ordered fetch — the last N records by turn index. No similarity search, no scoring |
| **What retrieved** | The last `retain_last_n_turns` turns (default: 12). **Flat fetch — not "retrieve all then pick top 12"**. If turn 13 exists, turn 1 is dropped entirely |

**Context window note:** the platform fetches N turns unconditionally — it does not check token count. If 12 turns are long (large tool outputs, KB results), they can consume significant context before the system prompt, RAG context, and tool schema are added. `retain_last_n_turns` must be set conservatively. Token-budgeted retrieval is a roadmap item (see Context Engineering, backlog item 7).

---

### Episodic Memory

| Dimension | Detail |
|---|---|
| **When written** | Only on **write-tool success** — `write_case_note`, `complete_assessment`, `update_care_plan`. Not on every turn. Not on read-only tools. |
| **How written** | `write_episodic_event(content, scopes)` — structured record: tool name, arguments, outcome, timestamp, scope IDs. `register_child_scope` links assessment → case → member for rollup. |
| **Where stored** | File today (`/app/state/memory/<scope_id>/episodic.json`). **Not a vector DB.** Structured JSON records. Swap-in: DynamoDB, PostgreSQL |
| **When retrieved** | Pre-graph, when `case_id` or `assessment_id` is present in `ctx`. Not retrieved if no case is in context. |
| **How retrieved** | **Scope-based lookup — not similarity search.** Fetch all episodic records under the active case scope + roll up from child assessment scopes. `top_k: 5` caps how many are injected. |
| **What retrieved** | The most recent N episodic events under this case and its assessments. Ordered by recency. No embedding, no cosine similarity. |

**Why not a vector DB today:** episodic events are retrieved by case identity, not by semantic relevance. If the nurse is on case `c-1234`, retrieve events for case `c-1234`. Scope-based lookup is sufficient and cheap. Vector retrieval becomes useful only at high volume ("find past events similar to this query") — that is a roadmap item.

---

### Semantic Memory

| Dimension | Detail |
|---|---|
| **When written** | When enabled: after each turn, post-graph. Extractor runs on the full turn (prompt + response). |
| **How written** | `write_semantic_memories(prompt, response)` — `stable_fact_extractor_v1` scans for stable facts using pattern matching (not LLM). Each extracted fact is a separate record stored under the member scope. |
| **Where stored** | File today (`/app/state/memory/<member_id>/semantic.json`). **Not a vector DB.** Flat JSON records. Swap-in: PostgreSQL with pgvector (for similarity retrieval at scale), DynamoDB |
| **When retrieved** | Pre-graph, when `member_id` is in context. |
| **How retrieved** | **Scope-based lookup today — not similarity search.** Fetch all semantic facts for this member. `top_k: 3` caps how many are injected. At low fact counts, this is fine. At scale (50+ facts per member), similarity-based retrieval is needed. |
| **What retrieved** | Up to `top_k` semantic facts for this member. Ordered by recency today — not by relevance to the current query. |

**Roadmap gap:** as fact volume grows, fetching all facts and capping at top_k by recency is a poor strategy. The right approach: embed each fact at write time, embed the query at retrieval time, retrieve top-k by cosine similarity. This requires a vector-capable backend (pgvector on PostgreSQL). Not built today.

---

### Summary Memory

| Dimension | Detail |
|---|---|
| **When written** | Triggered when turn count crosses `every_n_turns` threshold (default: 10). Evaluated post-graph on every turn — only fires when threshold is hit. |
| **How written** | `maybe_write_conversation_summary()` — today: concatenates the last N raw turns into a single text block (rule-based, not LLM). Stored as a single summary record, replacing the raw turns it covers. |
| **Where stored** | File today (`/app/state/memory/<thread_id>/summary.json`). Same store as short-term. Swap-in: same backend. |
| **When retrieved** | Pre-graph, every turn, alongside short-term. If a summary exists, `prefer_summaries_over_raw: true` means the summary replaces the raw turns it covers — not both. |
| **How retrieved** | Simple fetch — one summary record. No search. Injected as a single context item. |
| **What retrieved** | The most recent summary. The LLM sees: `[summary of turns 1–10] + [raw turns 11–12–13…]` rather than losing older context entirely. |

---

### Read Flow (Pre-Graph)

Memory is read **before the graph runs**:

```
Request received
     │
     ▼
scope_resolver: build active scopes from ctx IDs
     │
     ▼
context_builder: read from each active scope
     │
     ├── conversation scope → fetch last N short_term turns (recency order)
     │                        + fetch summary if exists
     │
     ├── case scope         → fetch top_k episodic events (recency order)
     │                        + roll up from child assessment scopes
     │
     ├── assessment scope   → fetch episodic events for this assessment
     │
     └── member scope       → fetch top_k semantic facts (recency order today)
                              + roll up episodic from all cases + assessments
     │
     ▼
memory_context assembled → deduplicated → capped at max_total_items
     │
     ▼
Graph runs with full memory context in ctx
```

### Write Flow (Post-Graph)

Memory is written **after the graph completes and the response is returned** — writes never block the user:

```
Graph completes, response returned to user
     │
     ├── short_term → always, if enabled
     │   append_raw_turn(user_prompt, assistant_response)
     │
     ├── episodic → only if a write-tool succeeded this turn
     │   write_episodic_event(tool_name, outcome, scopes)
     │   register_child_scope(assessment_id → case_id → member_id)
     │
     ├── semantic → only if enabled (off by default)
     │   stable_fact_extractor_v1 scans turn for stable facts
     │   write each extracted fact as a separate record under member scope
     │
     └── summary → evaluate trigger condition
         if turn_count % every_n_turns == 0:
             write_conversation_summary(last_n_turns)
```

---

## Context Assembly — What the LLM Actually Sees

After all memory types are retrieved, `context_builder` assembles them into a single `memory_context` object. Config controls how this is assembled:

```yaml
context_assembly:
  max_total_items: 12              # cap total memory items across all types
  prefer_summaries_over_raw: true  # use summary instead of raw turns if both exist
  deduplicate: true                # remove duplicate content across scopes
```

The LLM sees memory as part of its input alongside the user prompt, RAG context, and tool schema. It doesn't know whether a fact came from short-term, episodic, or semantic — it's all context.

---

## Memory Config — Full Reference

All memory behavior is controlled by `memory.yaml` in the agent overlay. No code changes needed.

```yaml
enabled: true                    # master switch — false disables all memory

scope_taxonomy:                  # which scopes exist for this agent
  - conversation
  - user
  - member
  - case
  - assessment
  - care_plan

write_policies:
  short_term:
    enabled: true
    trigger: every_turn
    retain_last_n_turns: 12      # rolling window kept in file store

  episodic:
    enabled: true
    triggers:
      - tool_success             # write_case_note, complete_assessment etc.
      - workflow_checkpoint
    allowed_scopes:
      - case
      - assessment
    link_to_parent_scope: true   # register child → parent for rollup

  semantic:
    enabled: false
    trigger: extractor
    extractor_profile: stable_fact_extractor_v1
    confidence_threshold: 0.85
    allowed_scopes:
      - member
      - user

  summary:
    enabled: true
    triggers:
      every_n_turns: 10
    allowed_scopes:
      - conversation

retrieval_policies:
  conversation:
    short_term:
      include: true
      max_turns: 12
    summary:
      include: true
      max_items: 1
  case:
    episodic:
      include: true
      top_k: 5
  member:
    semantic:
      include: false
      top_k: 3

context_assembly:
  max_total_items: 12
  prefer_summaries_over_raw: true
  deduplicate: true
```

---

## UI Toggle — Memory Policy Override

The Memory tab in the Agent Registry UI (and the Memory Debug Panel in the chat UI) allows toggling each memory type on/off per session. This is a runtime override — it does not change `memory.yaml`.

Each toggle maps to a `memory_policy_override` field sent with the request:

```json
{
  "memory_policy_override": {
    "short_term": true,
    "episodic": false,
    "semantic": false,
    "summary": true
  }
}
```

The override affects both **read and write** for that turn:
- Toggle short_term OFF → platform clears retrieved history AND skips writing this turn
- Toggle episodic OFF → no episodic events written even if tool succeeds

**Current limitation:** read and write are toggled together. A future improvement is splitting them — `memory.read.enabled` and `memory.write.enabled` independently. Example: summary_agent should read episodic (optional enrichment) but NEVER write to it. See backlog item 6c.

---

## The Adapter Pattern — Swapping the Memory Backend

Today memory is file-based (`FileMemoryStore`) — JSON files on disk under `/app/state/memory/`. This works for dev and demo but does not scale for production.

The same adapter pattern used for HITL applies here. `memory_interface.py` defines the abstract interface:

```python
# src/platform/memory/memory_interface.py ← never modify
class MemoryBackend(ABC):
    def append_raw_turn(...) -> Dict: ...
    def list_recent_turns(...) -> List: ...
    def write_memory(...) -> Dict: ...
    def list_memories(...) -> List: ...
    def register_child_scope(...) -> None: ...
    def list_child_scope_ids(...) -> List: ...
```

Today: `FileMemoryStore` implements this. To swap to DynamoDB or Redis — create a new file, implement the interface, change one import. Zero agent code touch.

| Backend | Status | Notes |
|---|---|---|
| File (JSON) | Today | Works for dev/demo. Not scalable, not multi-instance safe. |
| Redis | Swap in | Fast, TTL support, good for short-term. |
| DynamoDB | Swap in | Scalable, serverless, good for episodic/semantic at scale. |
| PostgreSQL | Swap in | If already running Tool Gateway DB, add memory tables. |
| S3 | Swap in | Cheap long-term storage for summaries and episodic history. |

---

## Current Limitations & Roadmap

**File-based storage**
JSON files on disk. Not multi-instance safe (two containers = race conditions). Not queryable. Not scalable. Fine for dev, not for production.

**Read and write toggled together**
UI toggle turns both read and write on/off. Needed: independent `memory.read.enabled` and `memory.write.enabled`. See backlog item 6c.

**Summary engine is rule-based**
Today summary is built by concatenating recent turns — not an LLM summarization. It's fast and cheap but produces a low-quality summary. An LLM-based summarizer would produce much better output.

**Semantic extraction is rule-based**
`stable_fact_extractor_v1` uses pattern matching, not LLM extraction. Misses nuanced facts, prone to false positives on ambiguous text.

**No memory pruning**
Old episodic and semantic entries accumulate indefinitely. No TTL, no relevance scoring, no max-size eviction. Memory bloat will degrade context quality over time.

**No intelligent retrieval**
All enabled memory types are retrieved on every turn regardless of whether the query needs them. A smarter approach: conditional retrieval based on query intent (e.g. only retrieve episodic if case_id present AND query seems to reference past events). See backlog item 6b.

### Roadmap summary

| Gap | What's needed |
|---|---|
| Production backend | Memory backend adapter (Redis / DynamoDB / PostgreSQL) |
| Read/write split | Independent `memory.read` and `memory.write` config |
| LLM summarization | Replace rule-based summary engine with LLM call |
| LLM semantic extraction | Replace pattern-based extractor with LLM |
| Memory pruning | TTL-based expiry, relevance scoring, max-size eviction |
| Intelligent retrieval | Conditional memory retrieval based on query intent |
| Config-driven backend selection | `memory.backend: dynamodb` in agent.yaml → auto-selects |

---

## These Capabilities Are Platform-Owned — Not Replaced by AgentCore

AgentCore (or any other orchestration engine) handles **how the graph runs** — node execution, state flow, managed LLM calls, infrastructure scaling. It does not provide:

- A memory model with scope hierarchy, rollup, and write policies
- Token-budgeted context assembly
- Read/write split per memory type
- Intelligent retrieval (conditional, similarity-based at scale)
- Memory pruning and eviction
- Semantic fact extraction

All of the above are your platform's capabilities — built once, configured per agent, owned by you. Swapping the orchestration engine underneath does not replace them. When running on AgentCore, some pieces wire differently (e.g. the memory backend may point at a managed store, traces go to CloudWatch) — but the memory model, scope design, write policies, and retrieval logic all still need to exist and be built.

The adapter pattern ensures this swap is clean: `MemoryBackend` sits behind an interface. When AgentCore is the orchestrator, you point the adapter at an AgentCore-compatible backend. The rest of the memory system — scopes, policies, context assembly — is unchanged.

> **The roadmap items in this section must be built regardless of whether AgentCore is eventually adopted.**
