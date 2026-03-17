from __future__ import annotations

import os
from pathlib import Path
from typing import List

import psycopg
from openai import OpenAI

DB_HOST = os.getenv("KB_PG_HOST", "host.docker.internal")
DB_PORT = int(os.getenv("KB_PG_PORT", "5432"))
DB_NAME = os.getenv("KB_PG_DB", "agentdb")
DB_USER = os.getenv("KB_PG_USER", "postgres")
DB_PASSWORD = os.getenv("KB_PG_PASSWORD", "postgres")
EMBED_MODEL = os.getenv("OPENAI_EMBED_MODEL", "text-embedding-3-small")

KB_SOURCE_DIR = os.getenv("KB_SOURCE_DIR", "/app/data/synth/policy_ingest")
CHUNK_SIZE = 500
CHUNK_OVERLAP = 100


def get_openai_client() -> OpenAI:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set")
    return OpenAI(api_key=api_key)


def embed_text(text: str) -> List[float]:
    client = get_openai_client()
    resp = client.embeddings.create(
        model=EMBED_MODEL,
        input=text,
    )
    return resp.data[0].embedding


def split_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> List[str]:
    text = (text or "").strip()
    if not text:
        return []

    chunks: List[str] = []
    start = 0
    n = len(text)

    while start < n:
        end = min(start + chunk_size, n)
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)

        if end >= n:
            break

        start = max(0, end - overlap)

    return chunks


def upsert_chunk(row_id: str, doc_id: str, title: str, content: str, chunk_index: int) -> None:
    emb = embed_text(content)

    sql = """
    INSERT INTO kb_documents (id, doc_id, title, content, chunk_index, embedding)
    VALUES (%s, %s, %s, %s, %s, %s::vector)
    ON CONFLICT (id)
    DO UPDATE SET
      doc_id = EXCLUDED.doc_id,
      title = EXCLUDED.title,
      content = EXCLUDED.content,
      chunk_index = EXCLUDED.chunk_index,
      embedding = EXCLUDED.embedding
    """

    with psycopg.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
    ) as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (row_id, doc_id, title, content, chunk_index, str(emb)))
        conn.commit()


def ingest_folder(folder: str) -> int:
    root = Path(folder)
    if not root.exists():
        raise RuntimeError(f"KB source folder does not exist: {folder}")

    total_chunks = 0

    for path in sorted(root.glob("*.txt")):
        content = path.read_text(encoding="utf-8").strip()
        if not content:
            continue

        doc_id = path.stem
        title = path.stem.replace("_", " ").replace("-", " ").title()

        chunks = split_text(content)

        for i, chunk in enumerate(chunks):
            row_id = f"{doc_id}::chunk::{i}"
            upsert_chunk(row_id, doc_id, title, chunk, i)
            total_chunks += 1
            print(f"ingested: {row_id}")

    return total_chunks


if __name__ == "__main__":
    total = ingest_folder(KB_SOURCE_DIR)
    print(f"ingest complete: {total} chunks")