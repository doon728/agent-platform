# services/rag — RAG Service

Standalone RAG (Retrieval-Augmented Generation) service. Indexes documents, exposes vector + keyword + hybrid retrieval over HTTP.

## Why standalone

Used to live in-process inside the tool-policy-gateway (C3). Split out as part of Pattern A′:
- C3 = policy + governance only.
- RAG = its own service callable by any tool (e.g., `search_kb`) or any agent.
- Independent deployment + scaling profile (RAG is heavier than policy enforcement).

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/healthz` | Liveness check. |
| `POST` | `/retrieve` | Vector / keyword / hybrid search over the KB. Returns top-k results. |
| `POST` | `/ingest` | Chunk + embed + upsert a document. |

## `POST /retrieve` — request

```json
{
  "query": "what is the protocol for hypertension",
  "top_k": 5,
  "threshold": 0.35,
  "strategy": "semantic"
}
```

Strategies: `semantic` (default), `keyword`, `hybrid`.

## Run locally

```bash
cd services/rag
poetry install
KB_PG_HOST=localhost KB_PG_PORT=5433 OPENAI_API_KEY=sk-... \
  poetry run uvicorn src.main:app --port 8082 --reload
```

Postgres + pgvector (port 5433) must already be running — typically via the tool-policy-gateway docker-compose stack which provisions it.

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `KB_PG_HOST` | `host.docker.internal` | Postgres host. |
| `KB_PG_PORT` | `5432` | Postgres port. |
| `KB_PG_DB` | `agentdb` | Database name. |
| `KB_PG_USER` | `postgres` | Database user. |
| `KB_PG_PASSWORD` | `postgres` | Database password. |
| `OPENAI_API_KEY` | (required) | For embedding generation. |
| `OPENAI_EMBED_MODEL` | `text-embedding-3-small` | Embedding model. |
| `KB_TOP_K` | `3` | Default top-k. |
| `KB_SCORE_THRESHOLD` | `0.35` | Default similarity threshold. |
