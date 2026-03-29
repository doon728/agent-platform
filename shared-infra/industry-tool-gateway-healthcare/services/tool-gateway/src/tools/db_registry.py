from __future__ import annotations

from typing import List
from dataclasses import dataclass, field

from src.data.pg_store import _conn


@dataclass
class ToolRecord:
    name: str
    description: str
    endpoint_url: str
    primary_arg: str
    mode: str
    tags: List[str]
    db_type: str | None
    strategy: str | None
    input_schema: dict | None
    output_schema: dict | None
    status: str = "active"


_cache: dict[str, ToolRecord] | None = None


def load_registry() -> dict[str, ToolRecord]:
    """Load tool registry from DB. Called once at startup."""
    global _cache

    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT name, description, endpoint_url, primary_arg, mode,
                       tags, db_type, strategy, input_schema, output_schema, status
                FROM tools
                WHERE enabled = true AND status = 'active'
                ORDER BY name
                """
            )
            rows = cur.fetchall()

    _cache = {
        row[0]: ToolRecord(
            name=row[0],
            description=row[1],
            endpoint_url=row[2],
            primary_arg=row[3],
            mode=row[4],
            tags=list(row[5] or []),
            db_type=row[6],
            strategy=row[7],
            input_schema=row[8],
            output_schema=row[9],
            status=row[10],
        )
        for row in rows
    }

    print(f"[db_registry] loaded {len(_cache)} tools from DB", flush=True)
    return _cache


def get_registry() -> dict[str, ToolRecord]:
    """Return cached registry. Raises if load_registry() was not called."""
    if _cache is None:
        raise RuntimeError("Tool registry not loaded — call load_registry() at startup")
    return _cache


def reload_registry() -> dict[str, ToolRecord]:
    """Force reload from DB (used after add/edit/delete via admin API)."""
    global _cache
    _cache = None
    return load_registry()
