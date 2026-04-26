from __future__ import annotations

import os
from typing import Any, Dict, List

import psycopg
from openai import OpenAI

DB_HOST = os.getenv("KB_PG_HOST", "host.docker.internal")
DB_PORT = int(os.getenv("KB_PG_PORT", "5432"))
DB_NAME = os.getenv("KB_PG_DB", "agentdb")
DB_USER = os.getenv("KB_PG_USER", "postgres")
DB_PASSWORD = os.getenv("KB_PG_PASSWORD", "postgres")

EMBED_MODEL = os.getenv("OPENAI_EMBED_MODEL", "text-embedding-3-small")
DEFAULT_THRESHOLD = float(os.getenv("KB_SCORE_THRESHOLD", "0.35"))
DEFAULT_TOP_K = int(os.getenv("KB_TOP_K", "3"))


def get_openai_client() -> OpenAI:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set in tool-gateway container")
    return OpenAI(api_key=api_key)


def embed_text(text: str) -> List[float]:
    text = (text or "").strip()
    if not text:
        return [0.0] * 1536
    client = get_openai_client()
    resp = client.embeddings.create(model=EMBED_MODEL, input=text)
    return resp.data[0].embedding


def _conn():
    return psycopg.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
        user=DB_USER, password=DB_PASSWORD,
    )


# ── Dim 1: Strategy implementations ──────────────────────────────────────────

def retrieve_semantic(query: str, top_k: int, threshold: float) -> List[Dict[str, Any]]:
    """Vector similarity search using pgvector cosine distance."""
    emb = embed_text(query)
    sql = """
    SELECT id, doc_id, title, content, chunk_index,
           1 - (embedding <=> %s::vector) AS score
    FROM kb_documents
    ORDER BY embedding <=> %s::vector
    LIMIT %s
    """
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (str(emb), str(emb), top_k))
            rows = cur.fetchall()

    results = []
    for row in rows:
        row_id, doc_id, title, content, chunk_index, score = row
        score = float(score) if score is not None else 0.0
        if score < threshold:
            continue
        results.append({
            "id": row_id, "doc_id": doc_id, "title": title,
            "chunk_index": chunk_index, "score": score, "snippet": content[:500],
        })
    return results


def retrieve_keyword(query: str, top_k: int, threshold: float) -> List[Dict[str, Any]]:
    """PostgreSQL full-text search using tsvector/tsquery."""
    sql = """
    SELECT id, doc_id, title, content, chunk_index,
           ts_rank(to_tsvector('english', content), plainto_tsquery('english', %s)) AS score
    FROM kb_documents
    WHERE to_tsvector('english', content) @@ plainto_tsquery('english', %s)
    ORDER BY score DESC
    LIMIT %s
    """
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (query, query, top_k))
            rows = cur.fetchall()

    results = []
    for row in rows:
        row_id, doc_id, title, content, chunk_index, score = row
        score = float(score) if score is not None else 0.0
        results.append({
            "id": row_id, "doc_id": doc_id, "title": title,
            "chunk_index": chunk_index, "score": score, "snippet": content[:500],
        })
    return results


def retrieve_hybrid(query: str, top_k: int, threshold: float) -> List[Dict[str, Any]]:
    """Reciprocal Rank Fusion (RRF) merge of semantic + keyword results."""
    k = 60  # RRF constant

    semantic = retrieve_semantic(query, top_k * 2, threshold * 0.7)
    keyword = retrieve_keyword(query, top_k * 2, 0.0)

    # Build RRF score per chunk id
    scores: Dict[str, float] = {}
    meta: Dict[str, Dict] = {}

    for rank, item in enumerate(semantic):
        cid = item["id"]
        scores[cid] = scores.get(cid, 0.0) + 1.0 / (k + rank + 1)
        meta[cid] = item

    for rank, item in enumerate(keyword):
        cid = item["id"]
        scores[cid] = scores.get(cid, 0.0) + 1.0 / (k + rank + 1)
        if cid not in meta:
            meta[cid] = item

    ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)[:top_k]

    results = []
    for cid, rrf_score in ranked:
        item = dict(meta[cid])
        item["score"] = round(rrf_score, 6)
        results.append(item)
    return results


# ── Public entry point ────────────────────────────────────────────────────────

def retrieve(
    query: str,
    top_k: int | None = None,
    threshold: float | None = None,
    strategy: str | None = None,
) -> List[Dict[str, Any]]:
    """Dispatch to correct Dim 1 strategy. Defaults come from env vars."""
    top_k = top_k if top_k is not None else DEFAULT_TOP_K
    threshold = threshold if threshold is not None else DEFAULT_THRESHOLD
    strategy = (strategy or "semantic").lower()

    if strategy == "keyword":
        return retrieve_keyword(query, top_k, threshold)
    elif strategy == "hybrid":
        return retrieve_hybrid(query, top_k, threshold)
    else:
        return retrieve_semantic(query, top_k, threshold)
