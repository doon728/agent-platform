# Memory Architecture — Platform Design Reference

## Overview

The agent memory system has four types. Each serves a different purpose and operates differently
at read and write time.

| Memory Type | Scope | What it stores | Retrieval method |
|---|---|---|---|
| **Short-term** | Conversation | Last N turns of dialogue | Recency — no search |
| **Episodic** | Case / Session | What happened in past interactions for this case | Vector similarity search |
| **Semantic** | Member / Entity | Facts about a member that accumulate over time | Vector similarity search |
| **Summary** | Thread | Compressed summary of a long conversation | Direct key lookup |

---

## How Each Type is Retrieved

### Short-term — no search
Returns the last N turns in order. Pure recency, no similarity, no ranking.
N is configured by `retain_last_n_turns` in `memory.yaml`.
**Always retrieved. No decision needed. True in both this platform and real world.**

### Summary — no search
Returns the latest summary keyed by `thread_id`. One record, direct lookup.
No search involved.

### Episodic and Semantic — vector similarity search
This is where real retrieval happens:

```
1. Take the current user query
       ↓
2. Convert query to an embedding vector (LLM embedding call)
       ↓
3. Compare that vector against all stored memory vectors
       ↓
4. Return top K most similar by cosine distance
```

The "best match" is determined by semantic closeness — not keyword matching.
Quality of retrieval depends on: how memory was written, chunk size, embedding model quality,
top_k value, and similarity threshold.

---

## Memory Retrieval — Today vs Real World

### Today in this platform
All enabled memory types are retrieved on every turn, unconditionally:

```python
if memory.enabled and short_term.enabled:
    load short-term       # always, no decision
if memory.enabled and episodic.enabled:
    search episodic       # always, no decision
if memory.enabled and semantic.enabled:
    search semantic       # always, no decision
if memory.enabled and summary.enabled:
    load summary          # always, no decision
```

No LLM involved. No "do I need this?" check. If enabled in config — it runs every turn.

### Real world enterprise
Short-term is always retrieved (same as today — always needed, no decision required).

For episodic, semantic, and summary — retrieval should be conditional. Same two options
as tool calling:

**Rule-based:**
- Only search episodic if `case_id` is present in the request
- Only search semantic if session is longer than N turns
- Only load summary if conversation exceeds context window threshold

**LLM-based:**
- Ask a cheap LLM: "Does this query need past case history to answer it? Yes/No"
- More flexible, handles any phrasing, but costs an extra LLM call

**Hybrid (most common in enterprise):**
Rule-based pre-filter catches obvious cases cheaply. LLM handles ambiguous cases.

---

## Memory Storage — Today vs Real World

### Today in this platform
Episodic and semantic memory are written to flat JSON files:

```
memory/
  episodic/
    case_123_episode_1.json
  semantic/
    member_456_fact_1.json
```

No embeddings. No vector DB. Retrieval is by `case_id` / `member_id` filter + recency.
Not truly semantic retrieval.

### Real world enterprise
Episodic and semantic must be stored in a **vector DB**:

| Layer | Technology |
|---|---|
| Vector storage | Pinecone, Weaviate, pgvector, Qdrant |
| Embedding model | OpenAI `text-embedding-3-small`, Cohere, Bedrock Titan |
| Metadata filter | `case_id`, `member_id`, `tenant_id` alongside the vector |
| Retrieval | Similarity search + metadata pre-filter combined |

**Metadata filtering is critical in enterprise** — you never search all vectors.
You filter by `tenant_id` + `member_id` / `case_id` first, then similarity search within
that filtered set. Otherwise memory from one patient could leak to another — a compliance violation.

```sql
find top K vectors
WHERE tenant_id = "acme"
AND member_id = "12345"
ORDER BY cosine_similarity(query_vector, stored_vector) DESC
```

---

## Memory Writing — When to Write

### Today in this platform
Every interaction is written unconditionally. Every turn, all enabled memory types, no decision.

### Real world enterprise
Writing is also conditional. Same two options:

**Rule-based triggers:**
- Only write episodic if a tool was called (pure conversation turns not worth storing)
- Only write semantic if a new fact was stated about the member
- Only write on specific events (e.g. `write_case_note` called → definitely write episodic)

**LLM-based triggers:**
Ask a cheap LLM after each turn:
```
"Did anything happen in this turn worth remembering long term?
Did a new fact emerge about this member? Yes/No + what."
```
If yes → write. If no → skip.

**Hybrid (most common):** Rule-based for obvious cases, LLM for subtle cases.

---

## The Fact Extraction Problem

Defining "a new fact worth storing" is harder than it sounds:

```
"The member has diabetes"           → clearly a fact, store it
"The member seemed tired today"     → observation, maybe store?
"The member said they feel better"  → transient state, probably not
"The member's A1C is 7.2"          → clinical fact, definitely store
"Ok thanks"                         → nothing, skip
"The member mentioned their son"    → personal context, maybe store?
```

**Three approaches in enterprise:**

**1. Human-defined schema (rule-based)**
Domain experts define exactly what facts to extract:
```yaml
extract_if_present:
  - diagnosis
  - medication
  - lab_values
  - allergies
  - family_context
```
LLM looks specifically for those fields. Structured and predictable but requires upfront
domain work and misses anything not in the schema.

**2. LLM open extraction**
Ask LLM after every turn:
```
"Extract any new facts about this member from this turn. Return empty if nothing new."
```
Flexible, catches anything — but inconsistent. Same fact stored differently each time = noisy retrieval.

**3. Hybrid — schema + LLM (most reliable)**
Schema defines categories. LLM fills them in:
```
Categories: diagnosis, medication, lifestyle, preferences, family
For each category — did this turn add anything new?
```

---

## The Deduplication Problem

Even after extracting a fact, you need to know if it was already stored.
The problem is not just deduplication — it is distinguishing between:

```
1. True duplicate      → same fact, same value       → skip
2. Update              → same fact, new value         → overwrite old
3. Contradiction       → same fact, opposite value    → flag conflict
4. New related fact    → related but genuinely new    → write alongside
```

**Example of why similarity threshold alone fails:**

| Scenario | Similarity | What should happen |
|---|---|---|
| "Member has diabetes" vs "Member is diabetic" | High | Correctly skip — duplicate |
| "A1C was 7.2 in January" vs "A1C is 8.1 in March" | High | Wrongly skipped — should overwrite |
| "Member takes metformin" vs "Member stopped taking metformin" | High | Wrongly skipped — should flag contradiction |

**Three approaches to handle this:**

**Option 1 — Versioning**
Never overwrite. Every fact gets a timestamp. At retrieval return most recent version.
Simple but storage grows forever.

**Option 2 — LLM reconciliation**
Before writing, retrieve similar existing facts and ask LLM:
```
"Existing: Member A1C 7.2 from January. New: A1C is 8.1 from March.
Is this a duplicate, update, contradiction, or new fact?"
```
Accurate but expensive — LLM call before every memory write.

**Option 3 — Entity-attribute model (most production-ready)**
Store memory as structured entities not free text:
```json
{
  "entity": "member_456",
  "attribute": "A1C",
  "value": "8.1",
  "date": "2026-03",
  "supersedes": "fact_id_123"
}
```
New value for same entity + attribute → automatically overwrites old.
Requires schema design upfront + LLM to extract structured entities from free text.

**Best practice in enterprise: Option 3 + versioning as fallback.**

---

## Which Memory Types for Which Usecase

Not all usecases need all memory types. Decision at agent creation time:

```
Is the agent conversational at all?
  YES → Short-term (always)

Does the agent work on something that evolves across multiple sessions?
  YES → Episodic

Does the agent need to know facts about a person that accumulate over time?
  YES → Semantic

Can a single session get long enough to overflow the context window?
  YES → Summary
```

**Examples:**

| Usecase | Short-term | Episodic | Semantic | Summary |
|---|---|---|---|---|
| Nurse pre-call assessment | ✅ | ✅ case history | ✅ member facts | ✅ long sessions |
| One-time drug lookup | ✅ | ❌ | ❌ | ❌ |
| Claims processing agent | ✅ | ✅ claim history | ❌ | ✅ |
| Customer support bot | ✅ | ✅ ticket history | ✅ customer profile | ✅ |
| SQL query agent | ✅ | ❌ | ❌ | ❌ |

---

## AgentCore and Memory

AgentCore is a **storage and retrieval infrastructure layer only**. It does not solve
the fact extraction, deduplication, or contradiction problems — those remain your responsibility.

**AgentCore solves:**
- ✅ Proper vector storage (replaces flat files in this platform)
- ✅ Embedding at write time
- ✅ Similarity search at retrieval time
- ✅ Metadata filtering (tenant, member, case scoping)
- ✅ TTL / expiry on short-term memory

**AgentCore does NOT solve:**
- ❌ When to write (your agent logic)
- ❌ What counts as a fact (your domain definition)
- ❌ Deduplication and contradiction detection (your agent logic)
- ❌ Dynamic top_k decisions (your agent logic)

AgentCore is infrastructure, not intelligence.

---

## Memory Retrieval vs RAG Retrieval

Memory retrieval (episodic/semantic) and RAG retrieval (KB search) work the same way
under the hood — both use vector similarity search with embeddings. The difference is
what is being searched and who triggers it:

| | Memory Retrieval | RAG / KB Retrieval |
|---|---|---|
| Who triggers it | Platform (automatic, before LLM sees query) | LLM (explicit tool call) |
| When | Before LLM reasoning | During LLM reasoning |
| What is searched | Past interactions and member facts | Documents, policies, guidelines |
| LLM can skip it | No (platform loads it) — today. Should be conditional in production | Yes — planner decides |
| Underlying mechanism | Vector similarity search | Vector similarity search |

Both face the same challenges: dynamic top_k, similarity threshold tuning, embedding quality,
and the decision of whether to retrieve at all.

---

## Gaps in This Platform Today

| Gap | Impact | Backlog Item |
|---|---|---|
| Flat file storage for episodic/semantic | Not truly semantic retrieval | AgentCore compatibility |
| Unconditional retrieval every turn | Wasteful at scale | Intelligent Memory Retrieval |
| Unconditional writing every turn | Memory bloat, noise | Memory Pruning |
| No deduplication or contradiction detection | Data quality degrades over time | Memory Pruning |
| Fixed top_k and threshold | Suboptimal retrieval | Context Engineering |
