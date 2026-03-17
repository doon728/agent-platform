from pathlib import Path
from dotenv import load_dotenv

env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(env_path, override=True)

import os
import psycopg
from src.rag.ingest import ingest_folder

DB_HOST = os.getenv("KB_PG_HOST", "localhost")
DB_PORT = int(os.getenv("KB_PG_PORT", "5432"))
DB_NAME = os.getenv("KB_PG_DB", "agentdb")
DB_USER = os.getenv("KB_PG_USER", "postgres")
DB_PASSWORD = os.getenv("KB_PG_PASSWORD", "postgres")
KB_SOURCE_DIR = os.getenv(
    "KB_SOURCE_DIR",
    str(Path(__file__).resolve().parent / "data" / "synth" / "policy_ingest"),
)


def ensure_kb_schema() -> None:
    sql = """
    CREATE EXTENSION IF NOT EXISTS vector;

    CREATE TABLE IF NOT EXISTS kb_documents (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      title TEXT,
      content TEXT NOT NULL,
      chunk_index INT NOT NULL,
      embedding vector(1536)
    );

    CREATE INDEX IF NOT EXISTS idx_kb_documents_doc_id ON kb_documents(doc_id);
    """
    with psycopg.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
    ) as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()


def kb_count() -> int:
    with psycopg.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
    ) as conn:
        with conn.cursor() as cur:
            cur.execute("select count(*) from kb_documents;")
            row = cur.fetchone()
            return int(row[0] if row else 0)


if __name__ == "__main__":
    print(f"DB_HOST={DB_HOST} DB_PORT={DB_PORT} DB_NAME={DB_NAME}")
    print(f"KB_SOURCE_DIR={KB_SOURCE_DIR}")

    source_path = Path(KB_SOURCE_DIR)
    if not source_path.exists():
        raise RuntimeError(f"KB source folder does not exist: {source_path}")

    files = sorted(source_path.glob("*.txt"))
    print(f"Found {len(files)} KB files")
    for f in files:
        print(f" - {f.name}")

    ensure_kb_schema()
    total = ingest_folder(KB_SOURCE_DIR)
    print(f"KB bootstrap complete: {total} chunks")

    final_count = kb_count()
    print(f"kb_documents row count: {final_count}")

    if final_count == 0:
        raise RuntimeError("KB bootstrap finished but kb_documents is still empty")