from pathlib import Path
from dotenv import load_dotenv

env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(env_path, override=True)

import os
import subprocess

DB_NAME = os.getenv("KB_PG_DB", "agentdb")
DB_USER = os.getenv("KB_PG_USER", "postgres")

BASE_DIR = Path(__file__).resolve().parent
SQL_DIR = BASE_DIR / "data" / "sql"
STRUCTURED_DIR = BASE_DIR / "data" / "synth" / "structured"


def _postgres_container() -> str:
    result = subprocess.run(
        ["docker", "compose", "ps", "-q", "postgres"],
        capture_output=True,
        text=True,
        check=True,
    )
    container_id = result.stdout.strip()
    if not container_id:
        raise RuntimeError("Postgres container is not running. Run 'docker compose up -d' first.")
    return container_id


def run() -> None:
    postgres_container = _postgres_container()

    schema_sql = SQL_DIR / "structured_tables.sql"
    load_sql = SQL_DIR / "load_structured_data.sql"

    if not schema_sql.exists():
        raise RuntimeError(f"Missing schema file: {schema_sql}")
    if not load_sql.exists():
        raise RuntimeError(f"Missing load file: {load_sql}")
    if not STRUCTURED_DIR.exists():
        raise RuntimeError(f"Missing structured data dir: {STRUCTURED_DIR}")

    subprocess.run(
        [
            "docker",
            "exec",
            "-i",
            postgres_container,
            "psql",
            "-U",
            DB_USER,
            "-d",
            DB_NAME,
        ],
        input=schema_sql.read_text(encoding="utf-8"),
        text=True,
        check=True,
    )

    copy_targets = [
        "assessment_questions.csv",
        "assessment_responses.csv",
        "assessments.csv",
        "auths.csv",
        "care_plans.csv",
        "case_notes.csv",
        "claims.csv",
        "members.csv",
        "providers.csv",
    ]

    for name in copy_targets:
        src = STRUCTURED_DIR / name
        if not src.exists():
            raise RuntimeError(f"Missing CSV file: {src}")
        subprocess.run(
            ["docker", "cp", str(src), f"{postgres_container}:/tmp/{name}"],
            check=True,
        )

    subprocess.run(
        ["docker", "cp", str(load_sql), f"{postgres_container}:/tmp/load_structured_data.sql"],
        check=True,
    )

    subprocess.run(
        [
            "docker",
            "exec",
            "-i",
            postgres_container,
            "psql",
            "-U",
            DB_USER,
            "-d",
            DB_NAME,
            "-f",
            "/tmp/load_structured_data.sql",
        ],
        check=True,
    )


if __name__ == "__main__":
    run()
    print("Structured bootstrap complete")