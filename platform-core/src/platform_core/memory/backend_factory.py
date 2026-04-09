from __future__ import annotations

from typing import Any, Dict

from platform_core.memory.memory_interface import MemoryBackend
from platform_core.memory.memory_store import FileMemoryStore


def get_backend(memory_cfg: Dict[str, Any], memory_type: str | None = None) -> MemoryBackend:
    """
    Return the memory backend for a given memory type.
    Reads backend: from write_policies.<memory_type>.backend in memory.yaml.
    Falls back to file if not configured.

    Usage:
        store = get_backend(memory_cfg, "episodic")
        store = get_backend(memory_cfg)   # global fallback
    """
    backend_name = "file"

    if memory_type:
        type_cfg = ((memory_cfg.get("write_policies") or {}).get(memory_type) or {})
        backend_name = type_cfg.get("backend", "file")
    else:
        backend_name = (memory_cfg.get("backend") or "file")

    if backend_name == "file":
        return FileMemoryStore()

    if backend_name == "s3":
        raise NotImplementedError("S3Backend not yet implemented — set backend: file for now")

    if backend_name in ("dynamodb", "dynamo"):
        raise NotImplementedError("DynamoDBBackend not yet implemented — set backend: file for now")

    if backend_name in ("pgvector", "postgres", "postgresql"):
        raise NotImplementedError("pgvectorBackend not yet implemented — set backend: file for now")

    if backend_name == "redis":
        raise NotImplementedError("RedisBackend not yet implemented — set backend: file for now")

    raise ValueError(f"Unknown memory backend: '{backend_name}'")
