# Section 8 — RAG / Retrieval

## What RAG Is and Why It Matters

RAG (Retrieval-Augmented Generation) solves a fundamental problem with LLMs: they don't know your content. A general-purpose LLM doesn't know your clinical protocols, your care management policies, your formulary, or your internal guidelines. RAG fixes this by retrieving relevant content from your knowledge base at query time and injecting it into the LLM's context.

Without RAG: LLM answers from training data → generic, potentially wrong answers for clinical workflows.
With RAG: LLM answers from your KB + training data → grounded, policy-compliant answers.

---

## Three Independent Dimensions of RAG

Before anything else — understand that RAG has three completely independent dimensions. Confusing them leads to bad configuration decisions.

### Dimension 1 — Search Method (Strategy)

**How** retrieval works inside a single KB tool. This is about the retrieval technology and the database behind it.

| Strategy | How it works | Requires | Best for |
|---|---|---|---|
| Semantic (Vector) | Embed query → cosine similarity over vectors | Vector DB (pgvector, Pinecone, Weaviate) | Clinical protocols, guidelines, narrative content |
| Hybrid (Vector + BM25) | Dense vector search + sparse keyword matching, merged | Vector DB + Keyword index (Elasticsearch) | Mixed content — some narrative, some exact lookups |
| Keyword (BM25) | Tokenize → inverted index lookup | Elasticsearch / OpenSearch | Drug names, codes, structured lookups |
| Graph RAG | Entity extraction → graph traversal | Graph DB (Neo4j) | Provider networks, relationships, hierarchies |

Strategy is determined by the KB tool's backing database. You can't choose "hybrid" if you only have a vector DB — it requires a keyword index alongside. **Today only Semantic is implemented.**

### Dimension 2 — Which KB Tool (Knowledge Base Selection)

**What** to retrieve from. Which knowledge base to query. An agent can have access to multiple KB tools, each backed by a different knowledge base:

```
search_clinical_kb    → Clinical protocols and care management guidelines
search_formulary_kb   → Drug formulary, tier levels, prior auth criteria
search_policy_kb      → Internal policies, compliance documents
search_provider_kb    → Provider directory, network status
```

Each tool has its own Dimension 1 strategy. With multiple KB tools, a **router** decides which tool(s) to call based on query intent — routing rules, LLM classification, or semantic matching over tool descriptions.

**Today only a single KB tool exists (`search_kb`).** Multi-KB routing is on the roadmap.

### Dimension 3 — RAG Pattern (Architecture)

**How retrieval integrates into the reasoning flow.** This is about how many times retrieval happens, whether the LLM evaluates results, and whether it can iterate.

| Pattern | How it works | Cost | Latency | Best for |
|---|---|---|---|---|
| Naive | Retrieve once → inject → respond | Low | Fast | Simple direct KB questions, time-pressured workflows |
| Self-Corrective | Retrieve → LLM grades relevance → re-query if poor → respond | Medium | Medium | When retrieval quality is unreliable |
| Multi-Hop | Retrieve → reason → identify gap → retrieve again → chain → respond | High | Slow | Complex questions needing multiple KB lookups |
| HyDE | LLM generates hypothetical answer → embed it → use as query → retrieve | Medium | Medium | Vague or poorly phrased user queries |
| Agentic | LLM decides when/how many times to retrieve mid-reasoning | Highest | Slowest | Open-ended research tasks |

**Today only Naive RAG is implemented** (implicitly — there is no explicit pattern selection). Each pattern will be built once as a platform file (`src/platform/rag/patterns/`) and selected via config — zero agent code touch.

**Multiple patterns in one agent:** yes, possible. A router selects the pattern per query — rule-based (query length, keywords) or LLM classification. Alternatively, self-corrective naturally degrades to naive when first retrieval is good enough, making it a safe default that handles both simple and complex cases.

**Admin guidance:**
- Nurses on time-pressured workflows → Naive or Self-Corrective
- Research-heavy workflows (appeals, complex prior auth) → Multi-Hop
- Users who phrase queries vaguely → HyDE
- Open-ended investigative tasks → Agentic

---

## All Three Dimensions Are Completely Independent

Each dimension operates independently. Any combination is valid:

```
Dimension 2: Which KB?       Dimension 1: How?          Dimension 3: Pattern?
──────────────────────────   ────────────────────────   ─────────────────────
search_clinical_kb       →   semantic (vector)      →   self_corrective
search_formulary_kb      →   keyword (BM25)         →   naive
search_policy_kb         →   hybrid                 →   multi_hop
search_provider_kb       →   graph                  →   naive
```

- Changing Dimension 1 (strategy) does not affect which KBs exist or the retrieval pattern
- Adding KB tools (Dimension 2) does not affect strategy or pattern
- Changing Dimension 3 (pattern) does not affect which KBs are queried or how each retrieves

**Configuration principle:** each dimension is configured independently in `agent.yaml` and from the UI. All three apply at both RAG stages (pre-graph and planner tool) independently.

**Built once in platform, configured per agent** — no agent code touch to switch any dimension on any agent.

---

## Two RAG Stages — Both Dimensions Apply at Both

The platform has two RAG stages. Both dimensions (strategy + KB selection) apply independently at both stages.

### Stage 1 — Pre-Graph RAG (Ambient Enrichment)

Runs **before the graph**, every turn, silently.

- Triggered if `retrieval.pre_graph.enabled: true` in `agent.yaml`
- Embeds the user's raw message → retrieves KB chunks → injects into `ctx["rag_context"]`
- Planner and responder both see this content as background without any explicit tool call
- User never sees the retrieval happen

**Dimension 1 at pre-graph:** the KB tool(s) called have their own strategy — if `search_clinical_kb` uses semantic, pre-graph retrieval is semantic.

**Dimension 2 at pre-graph:** today one tool is called (`retrieval.default_tool`). With multi-KB routing, pre-graph could fan out to multiple KB tools — e.g. always enrich context with both clinical protocols AND relevant formulary entries before the planner runs.

**When to use:** when KB content should enrich every response regardless of what the user asks. Keep top_k low — this runs every turn and adds to every LLM call.

### Stage 2 — Planner Tool RAG (Explicit Query)

Runs **inside the graph**, intent-driven.

- Triggered when the planner LLM decides the user's intent is a direct KB question
- The KB tool is called like any other tool — competes with `get_member`, `write_case_note` etc.
- Retrieved chunks become the primary response for that turn
- User sees the KB answer directly

**Dimension 1 at planner tool:** the called KB tool has its own strategy — same principle as pre-graph.

**Dimension 2 at planner tool:** today one tool (`search_kb`) handles all KB queries. With multi-KB routing, the router (rule-based or LLM) decides: "this is a formulary question → call `search_formulary_kb`", "this is a protocol question → call `search_clinical_kb`". Each call uses that tool's own strategy.

**When to use:** always on for agents with KB access. The LLM decides when to call it — you configure how it retrieves, not when.

### Both stages, all three dimensions — full picture

```
Pre-Graph RAG (Stage 1)                    Planner Tool RAG (Stage 2)
────────────────────────                   ──────────────────────────
Fires: every turn, before graph            Fires: when planner selects a KB tool

Dim 2 today: single default_tool           Dim 2 today: single search_kb tool
Dim 2 future: router → multiple KB tools   Dim 2 future: router → multiple KB tools

Dim 1: each tool has its own strategy      Dim 1: each tool has its own strategy

Dim 3 today: naive (implicit)             Dim 3 today: naive (implicit)
Dim 3 future: pattern per config          Dim 3 future: pattern per config
              (self_corrective, multi_hop…)              (can differ from Stage 1)

Output: ctx["rag_context"] (silent)        Output: primary response for that turn
```

The two stages are **completely independent** — pre-graph and planner tool each have their own Dimension 2 router, Dimension 1 strategy per tool, and Dimension 3 pattern. You could run self-corrective at pre-graph and naive at planner tool, or fan out to different KB sets at each stage.

---

## How Retrieval Works — Step by Step (Semantic, Today)

```
User message: "What is the protocol for high-risk discharge?"
     │
     ▼
Tool Gateway — search_kb handler
     │
     ▼  1. Embed the query
OpenAI Embeddings API (text-embedding-3-small)
     │    query text → 1536-dimensional vector
     │◄──────────────────────────────────────── embedding returned
     │
     ▼  2. Vector similarity search
PostgreSQL + pgvector
     │    SELECT ... FROM kb_documents
     │    ORDER BY embedding <=> query_vector
     │    LIMIT top_k
     │◄──────────────────────────────────────── top-k rows returned
     │
     ▼  3. Threshold filter
     │    score = 1 - cosine_distance
     │    drop chunks where score < threshold
     │
     ▼  4. Return chunks
[
  { id, doc_id, title, chunk_index, score, snippet },
  ...
]
```

The query is embedded using the same model used to embed KB documents at ingestion time. If the models don't match, retrieval produces meaningless results — this is a common misconfiguration.

---

## Embedding — What It Is and Where It Happens

Embedding converts text into a vector of numbers (1536 dimensions for `text-embedding-3-small`). Semantically similar text produces vectors that are close together in that space. This is what makes similarity search work — "high-risk discharge protocol" and "criteria for discharging complex patients" produce nearby vectors even though they share no keywords.

**Two places embedding happens:**

| | When | What gets embedded | Who calls it |
|---|---|---|---|
| Ingestion | Once, offline | KB document chunks | `ingest.py` bootstrap script |
| Retrieval | Every query | User message / prompt | `retriever.py` in Tool Gateway |

Both must use the same model. Today: `text-embedding-3-small` (OpenAI). Configurable via `OPENAI_EMBED_MODEL` env var on the Tool Gateway container.

---

## Document Ingestion — How KB Content Gets In

KB documents are plain `.txt` files placed in `data/synth/policy_ingest/`. The bootstrap script reads them, splits into chunks, embeds each chunk, and stores in PostgreSQL.

**Chunking:**
- Chunk size: 500 characters
- Overlap: 100 characters (chunks overlap to avoid cutting context at boundaries)
- Each chunk gets its own row in `kb_documents` with its own embedding vector

**Ingestion flow:**
```
.txt file → split_text() → chunks
     │
     ▼ for each chunk
embed_text(chunk) → OpenAI → 1536-dim vector
     │
     ▼
INSERT INTO kb_documents (id, doc_id, title, content, chunk_index, embedding)
ON CONFLICT → upsert (safe to re-run)
```

**To add a new KB document:**
1. Add `.txt` file to `data/synth/policy_ingest/`
2. Run `python src/rag/ingest.py` inside the Tool Gateway container
3. Done — immediately searchable, no restart needed

---

## The RAG Tab in the Admin UI — Every Control Explained

### Knowledge Bases — Dimension 1 (Search Method)

Shows all KB tools registered in the gateway with their `db_type` and `strategy`. This is read from `ToolSpec` — it tells you what strategy each KB tool uses. **Today this is informational** — switching strategy requires changing the retriever implementation and potentially the infrastructure. It is not a runtime toggle.

The strategy cards (Hybrid, Keyword, Graph RAG) explain what each requires — they are educational, not selectable unless the backing infrastructure exists.

### Pre-Graph RAG (Ambient Enrichment)

| Control | Config field | Guidance |
|---|---|---|
| Pre-Graph RAG Enabled | `retrieval.pre_graph.enabled` | Off by default. Turn on only if KB should enrich every response silently. |
| Top K | `retrieval.pre_graph.top_k` | Keep low (2-3). Runs every turn — higher = more noise + token cost. |
| Similarity Threshold | `retrieval.pre_graph.similarity_threshold` | Keep higher (0.5+). Only inject clearly relevant content silently. |

### Planner Tool RAG (Explicit Query)

| Control | Config field | Guidance |
|---|---|---|
| Default Tool | `retrieval.default_tool` | Which KB tool to call. `search_kb` today. |
| Top K | `retrieval.top_k` | Can be higher (5). This IS the response — more context helps. |
| Similarity Threshold | `retrieval.similarity_threshold` | Lower is OK (0.35). Better to return marginal result than nothing when user explicitly asks. |
| Allow No-Results Response | `retrieval.fallback.allow_no_results_response` | If true, LLM responds gracefully when KB returns nothing. If false, returns a fixed "no results" message. |

### Key tuning principle

```
Pre-Graph RAG:  higher threshold + lower top_k  → only inject clearly relevant chunks silently
Planner Tool:   lower threshold  + higher top_k  → return more when user explicitly asks
```

---

## Top K and Similarity Threshold — How to Tune

**Top K** — how many chunks to retrieve.
- Too low (1-2): may miss relevant content if KB has multiple docs on the topic
- Too high (10+): fills context window, increases cost, can confuse LLM
- Starting point: 3 for pre-graph, 5 for planner tool

**Similarity Threshold** — minimum cosine similarity score (0 to 1).
- Score of 1.0 = exact match (never happens in practice)
- Score ~0.35 = loosely related
- Score ~0.7+ = highly relevant
- Too low (0.1-0.2): returns irrelevant chunks, adds noise
- Too high (0.8+): returns almost nothing, RAG effectively disabled
- Starting point: 0.5 for pre-graph, 0.35 for planner tool

**Signs your threshold is wrong:**
- Generic answers despite relevant KB content → threshold too high, lower it
- Answers filled with irrelevant KB content → threshold too low, raise it
- No KB results ever returned → threshold too high, OR docs not ingested, OR embedding model mismatch

---

## Current Limitations & Roadmap

**Single KB only (Dimension 2 gap)**
Both stages hit one KB tool today. No router, no fan-out. Clinical protocol queries and formulary queries hit the same index.

**Semantic strategy only (Dimension 1 gap)**
Hybrid, keyword, and Graph RAG are not implemented. Strategy field on ToolSpec documents intent but doesn't switch behavior.

**Fixed chunk size**
500 chars / 100 overlap — not configurable per document. Clinical documents vary widely; fixed chunking may split content at bad boundaries.

**No re-ranking**
Results returned in similarity score order. A cross-encoder re-ranker would improve precision on the top-k results. Not implemented.

**Embedding model lock-in**
Swapping models invalidates all existing embeddings — full KB re-ingestion required.

**No multi-KB router**
Needs query classifier (rule-based or LLM) → select KB(s) → retrieve → merge + re-rank. Applies to both pre-graph and planner tool stages independently.

### Roadmap summary

| Gap | Dimension | What's needed |
|---|---|---|
| Multi-KB routing | Dimension 2 | Router (rule-based or LLM) at both pre-graph and planner stages independently |
| Hybrid retrieval | Dimension 1 | Add Elasticsearch, merge with vector results |
| Keyword retrieval | Dimension 1 | Elasticsearch / OpenSearch |
| Graph RAG | Dimension 1 | Neo4j or similar graph DB |
| Self-Corrective RAG | Dimension 3 | `src/platform/rag/patterns/self_corrective.py` |
| Multi-Hop RAG | Dimension 3 | `src/platform/rag/patterns/multi_hop.py` |
| HyDE | Dimension 3 | `src/platform/rag/patterns/hyde.py` |
| Agentic RAG | Dimension 3 | `src/platform/rag/patterns/agentic.py` |
| Pattern router | Dimension 3 | Rule-based or LLM classifier to select pattern per query |
| Config-driven pattern selection | Platform | `retrieval.pattern` in agent.yaml → auto-instantiates correct pattern |
| Configurable chunking | Ingestion | Per-doc or per-KB chunk size/overlap config |
| Re-ranking | Retrieval | Cross-encoder on top-k results |
| Tool Admin UI for KB | Tooling | Upload docs, trigger ingestion, view chunks, manage all 3 dimensions from browser |

---

## These Capabilities Are Platform-Owned — Not Replaced by AgentCore

AgentCore handles orchestration and infrastructure. It does not provide:

- Multi-KB routing and fan-out
- RAG patterns (self-corrective, multi-hop, HyDE, agentic)
- Hybrid, keyword, or Graph RAG strategies
- Re-ranking, configurable chunking, or embedding model management
- Pre-graph ambient enrichment tied to your clinical KB

These are your platform's retrieval capabilities — built once in `src/platform/rag/`, configured per agent, owned by you. Swapping to AgentCore as the orchestrator does not replace them. The `RAGPattern` interface ensures the swap is clean — patterns run the same way regardless of what orchestration engine calls them.

> **All three RAG dimensions (strategy, KB routing, pattern) must be built regardless of whether AgentCore is eventually adopted.**
