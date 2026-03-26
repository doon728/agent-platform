# RAG Dimensions — Platform Design Reference

## Overview

When we say "different kinds of RAG" in this platform, we mean two completely independent
dimensions. Understanding this split is important because each dimension is configured
and changed differently.

---

## Dimension 1 — Search Method (how you search a KB)

**Determined by the type of database/knowledge base being searched.**
One-to-one relationship: DB type → search method. You do not freely choose the strategy —
the database you have dictates it.

| Strategy | DB / KB Type | How It Works |
|---|---|---|
| **Semantic / Vector** | Vector DB (pgvector, Pinecone, Weaviate) | Converts query to embedding vector, finds closest matches by meaning |
| **Hybrid (Vector + BM25)** | Vector DB + Keyword index | Dense vector search + sparse keyword matching combined |
| **Keyword (BM25)** | Elasticsearch, OpenSearch, Solr | Exact and fuzzy word matching, scored by frequency |
| **Graph** | Graph DB (Neo4j, Amazon Neptune) | Traverses entity relationships to find connected nodes |

### Key rules for Dimension 1

- The DB type determines the strategy. If your KB is a vector DB → strategy is semantic. Period.
- Multiple KBs of the same type (e.g. 3 vector KBs) all use the same strategy.
  The system routes to the right KB based on **tool descriptions** — the planner LLM reads them
  and picks the correct tool.
- Dimension 1 is **configurable** in `agent.yaml` under `retrieval.strategy`.
- Dimension 1 metadata (`db_type`, `strategy`) lives in the **tool spec** in the tool gateway,
  because the tool is what connects to the DB.

### How it is configured (agent.yaml)

```yaml
retrieval:
  enabled: true
  default_tool: search_kb      # which tool to call for retrieval
  strategy: semantic           # Dimension 1 — set to match your KB type
  top_k: 5
  similarity_threshold: 0.35
```

### How it is coded

Dimension 1 is implemented inside the **tool gateway** — each tool (`search_kb`, `graph_search`,
etc.) is hardwired to its database and search method. The agent calls the tool; the tool
handles the DB query using the appropriate search method.

### Visible in Agent Registry

The RAG tab in Agent Registry shows:
- Which retrieval tools are assigned to this agent
- The `db_type` and `strategy` for each tool (read from tool gateway spec)
- Education panel explaining what the active strategy means and what other strategies require

---

## Dimension 2 — Pipeline Design (how you build around retrieval)

**Independent of DB type. Determined by the agent overlay graph design (LangGraph nodes).**
This is the logic around retrieval — when to retrieve, how many times, what to do with results.

| Pattern | What It Does | Complexity |
|---|---|---|
| **Naive RAG** | Retrieve once → pass results to LLM → done | Low |
| **Advanced RAG** | Rewrite query before retrieval, rerank/filter results after | Medium |
| **Multi-hop RAG** | Retrieve → read result → retrieve again based on finding → repeat | High |
| **Agentic RAG** | Agent decides when to retrieve, what to search, whether to retry | High |
| **Self-RAG** | LLM grades its own retrieved results, retries if quality is low | High |

### Key rules for Dimension 2

- Dimension 2 is **code, not config**. You cannot toggle it with a YAML value.
- It is implemented in the LangGraph graph structure inside the agent overlay.
- Changing Dimension 2 means building a **different overlay**, not editing agent.yaml.
- Same usecase, different Dimension 2 = two separate overlays, selected by `AGENT_TYPE` env var:

```
overlays/
  chat_agent/              ← Naive RAG  (current)
  chat_agent_multihop/     ← Multi-hop RAG  (future)
  chat_agent_agentic/      ← Agentic RAG    (future)
```

### How it is declared (agent_manifest.yaml)

Since Dimension 2 cannot be configured, it is declared as **read-only metadata**
in the agent manifest so it is visible in the Agent Registry:

```yaml
rag_dimension2:
  pattern: naive
  description: "Single retrieval pass. Query → search_kb → results handed directly to LLM."
  other_patterns:
    - pattern: advanced
      description: "..."
    - pattern: multi_hop
      description: "..."
```

This is documentation metadata only — it does not affect runtime behavior.

### Visible in Agent Registry

The Overview tab in Agent Registry shows:
- The active Dimension 2 pattern (read-only, color-coded)
- A description of what that pattern does
- All other patterns with descriptions (educational, non-clickable)

---

## Dimension 1 and Dimension 2 — Independence and Cardinality

### They are independent of each other

Dimension 1 and Dimension 2 are completely independent. Any D2 pipeline can call any D1 tool.
You do not need to change D2 to add a new KB (D1). You do not need to change D1 to upgrade
the pipeline (D2).

### Dimension 1 scales horizontally — one per KB

You can have as many Dimension 1 strategies as you have KBs. Each KB has exactly one tool,
and each tool has exactly one strategy (determined by its DB type).

```
KB 1 (vector DB)  → tool: search_clinical_kb   → strategy: semantic
KB 2 (graph DB)   → tool: search_graph_kb      → strategy: graph
KB 3 (keyword DB) → tool: search_drug_kb       → strategy: keyword
```

Three KBs = three D1 strategies active simultaneously. The D2 pipeline calls whichever
tool it needs at each step.

### Dimension 2 is exactly one per agent

**Each agent has exactly one D2 pipeline** — because D2 is the LangGraph graph structure
of the agent itself. There is only one graph running per agent instance.

However, **one D2 pipeline can call multiple D1 tools** across multiple hops:

```
Multi-hop RAG (D2 = one pipeline)
    ↓
  Hop 1 → calls search_clinical_kb  (D1 = semantic)
    ↓ reads result, forms next query
  Hop 2 → calls search_graph_kb     (D1 = graph)
    ↓
  LLM generates final answer
```

### To have a different D2, you need a different agent

If you want Naive RAG and Multi-hop RAG for the same use case, that is two separate
overlays — two separate agent types. You pick which one to deploy via `AGENT_TYPE`.

```
overlays/
  chat_agent/              ← D2: Naive RAG
  chat_agent_multihop/     ← D2: Multi-hop RAG
  chat_agent_agentic/      ← D2: Agentic RAG
```

Both overlays can use the same KB tools (same D1 strategies). The pipeline around them differs.

### Can a router choose between D2 pipelines at runtime?

Yes — but not inside one agent. The way to do this is a **supervisor / multi-agent architecture**:

```
Supervisor Agent (router)
    ↓ reads query, decides complexity
    ├── simple question  → routes to chat_agent          (D2: Naive RAG)
    └── complex question → routes to chat_agent_multihop (D2: Multi-hop RAG)
```

Each sub-agent has its own overlay and its own D2. The supervisor routes to the right one
based on the query. This is a multi-agent pattern — **not** multiple D2s inside one agent.

**Inside a single agent, there is always exactly one D2.** There is no concept of
switching pipelines mid-agent based on a query. That routing happens at the supervisor level,
between agents.

---

## Choosing a Dimension 2 Pattern

The right D2 pattern depends on the nature of the questions your agent needs to answer.
Use the following factors to decide:

### Factor 1 — Answer complexity

| Question type | Example | Recommended D2 |
|---|---|---|
| Single-fact lookup | "What is the member's diagnosis?" | Naive RAG |
| Multi-part question | "What are the guidelines for this diagnosis and are they met?" | Advanced or Multi-hop |
| Chained reasoning | "Given the diagnosis, find related drugs, then find interactions with current meds" | Multi-hop or Agentic |
| Open-ended research | "Summarise everything relevant about this member across all KBs" | Agentic |

### Factor 2 — Number of KBs involved

- **One KB, one retrieval pass** → Naive or Advanced RAG is sufficient
- **Multiple KBs, query depends on earlier results** → Multi-hop RAG (each hop informs the next)
- **Agent decides which KB to search and when** → Agentic RAG

### Factor 3 — Tolerance for latency

Each additional retrieval hop adds latency (another LLM call + DB query).

| Pattern | Retrieval passes | Relative latency |
|---|---|---|
| Naive | 1 | Lowest |
| Advanced | 1 (with rewrite + rerank) | Low–Medium |
| Multi-hop | 2–4 | Medium–High |
| Agentic | Dynamic (1–N) | High |
| Self-RAG | 1–3 (with grading retries) | Medium–High |

### Factor 4 — Query predictability

- **Predictable, well-scoped queries** (nurse asking structured clinical questions) → Naive or Advanced
- **Unpredictable, open-ended queries** (user can ask anything) → Agentic or Self-RAG

### Factor 5 — Result quality requirements

- **High-stakes domain** (clinical, legal, compliance) where wrong answers are costly → Self-RAG
  (LLM grades its own results and retries before answering)
- **Standard quality acceptable** → Naive or Advanced

### Decision summary

```
Is the answer found in a single retrieval pass?
  YES → Does query quality matter a lot?
          YES → Advanced RAG (rewrite + rerank)
          NO  → Naive RAG
  NO  → Does the agent need to decide what to search dynamically?
          YES → Agentic RAG
          NO  → Multi-hop RAG
              → Is answer quality critical enough to grade and retry?
                  YES → Self-RAG
```

---

## How the Two Dimensions Relate

```
User Query
    ↓
[DIMENSION 2 — Pipeline Logic]
e.g. rewrite query? how many retrieval passes? retry?
    ↓
Call Retrieval Tool (search_kb, graph_search, ...)
    ↓
[DIMENSION 1 — Search Method inside the tool]
e.g. semantic vector search against pgvector
    ↓
Results returned to pipeline
    ↓
[DIMENSION 2 — Post-retrieval logic]
e.g. rerank? grade quality? loop again?
    ↓
Final context handed to LLM → answer generated
```

Dimension 1 sits **inside** the tool call.
Dimension 2 wraps **around** the tool call.

---

## Multiple KBs of the Same Type

If you have multiple vector KBs:

```
KB 1 — Clinical guidelines     → tool: search_clinical_kb  (vector, semantic)
KB 2 — Member care history     → tool: search_member_kb    (vector, semantic)
KB 3 — Drug interactions       → tool: search_drug_kb      (vector, semantic)
```

All three use the same strategy (semantic). The planner routes to the right tool based on
**tool descriptions**. There is no magic — the planner is an LLM that reads descriptions
and picks the most relevant tool for the question.

---

## Practical Configuration Model

The recommended starting point for this platform:

```
chat_agent_naive     (D2: Naive RAG)    → D1: search_clinical_kb, search_drug_kb, search_member_kb
chat_agent_advanced  (D2: Advanced RAG) → D1: search_clinical_kb, search_drug_kb, search_member_kb
chat_agent_multihop  (D2: Multi-hop)    → D1: search_clinical_kb, search_graph_kb
```

- Each agent has **one D2** — single pipeline, coded in the overlay
- Each agent can have **multiple D1 tools** — multiple KBs, planner picks the right one per query
- Different agents can share the same D1 tools — KBs live in the tool gateway and are reusable across any agent

---

## Quick Reference

| | Dimension 1 | Dimension 2 |
|---|---|---|
| **What it is** | Search method | Pipeline design |
| **Determined by** | DB / KB type | Agent overlay code |
| **Configurable?** | Yes — `retrieval.strategy` in agent.yaml | No — it is code |
| **Change requires** | Edit agent.yaml, restart agent | New overlay, redeploy |
| **Visible in Registry** | RAG tab — editable | Overview tab — read-only |
| **Examples** | semantic, hybrid, keyword, graph | naive, multi-hop, agentic, self-rag |
| **One-to-one with DB?** | Yes | No |
| **Applies to** | KB / retrieval tools only | Whole agent graph |
