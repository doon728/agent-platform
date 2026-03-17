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
SIMILARITY_THRESHOLD = float(os.getenv("KB_SCORE_THRESHOLD", "0.35"))


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

    resp = client.embeddings.create(
        model=EMBED_MODEL,
        input=text,
    )
    return resp.data[0].embedding


def retrieve(query: str, top_k: int | None = None) -> List[Dict[str, Any]]:
    if top_k is None:
        top_k = int(os.getenv("KB_TOP_K", "3"))
    emb = embed_text(query)

    sql = """
    SELECT
        id,
        doc_id,
        title,
        content,
        chunk_index,
        1 - (embedding <=> %s::vector) AS score
    FROM kb_documents
    ORDER BY embedding <=> %s::vector
    LIMIT %s
    """

    with psycopg.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
    ) as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (str(emb), str(emb), top_k))
            rows = cur.fetchall()

    results: List[Dict[str, Any]] = []

    for row in rows:
        row_id, doc_id, title, content, chunk_index, score = row

        score = float(score) if score is not None else 0.0

        if score < SIMILARITY_THRESHOLD:
            continue

        results.append(
            {
                "id": row_id,
                "doc_id": doc_id,
                "title": title,
                "chunk_index": chunk_index,
                "score": score,
                "snippet": content[:500],
            }
        )

    return results