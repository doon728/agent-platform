from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List
from uuid import uuid4
from datetime import datetime, timezone


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class FileMemoryStore:

    def __init__(self, base_dir: str = "/app/state/memory") -> None:
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _scope_file(self, tenant_id: str, scope_type: str, scope_id: str) -> Path:
        tenant_dir = self.base_dir / tenant_id / scope_type
        tenant_dir.mkdir(parents=True, exist_ok=True)
        safe_scope_id = scope_id.replace("/", "_")
        return tenant_dir / f"{safe_scope_id}.json"

    def _read_records(self, tenant_id: str, scope_type: str, scope_id: str) -> List[Dict[str, Any]]:
        path = self._scope_file(tenant_id, scope_type, scope_id)
        if not path.exists():
            return []
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return []

    def _write_records(
        self,
        tenant_id: str,
        scope_type: str,
        scope_id: str,
        records: List[Dict[str, Any]],
    ) -> None:
        path = self._scope_file(tenant_id, scope_type, scope_id)
        path.write_text(json.dumps(records, indent=2), encoding="utf-8")

    def append_raw_turn(
        self,
        tenant_id: str,
        thread_id: str,
        role: str,
        content: str,
        metadata: Dict[str, Any] | None = None,
        max_short_term_records: int = 100,
    ) -> Dict[str, Any]:
        record = {
            "memory_id": f"mem_{uuid4().hex[:12]}",
            "memory_type": "short_term",
            "scope_type": "conversation",
            "scope_id": thread_id,
            "role": role,
            "content": content,
            "metadata": metadata or {},
            "created_at": _utc_now(),
        }
        records = self._read_records(tenant_id, "conversation", thread_id)
        records.append(record)
        # Keep non-short_term records (summary etc.) plus a rolling window of short_term
        non_st = [r for r in records if r.get("memory_type") != "short_term"]
        short_term = [r for r in records if r.get("memory_type") == "short_term"]
        short_term = short_term[-max_short_term_records:]
        self._write_records(tenant_id, "conversation", thread_id, non_st + short_term)
        return record

    def list_recent_turns(
        self,
        tenant_id: str,
        thread_id: str,
        max_turns: int = 8,
    ) -> List[Dict[str, Any]]:
        records = self._read_records(tenant_id, "conversation", thread_id)
        records = [r for r in records if r.get("memory_type") == "short_term"]
        return records[-max_turns:]

    def write_memory(
        self,
        tenant_id: str,
        memory_type: str,
        scope_type: str,
        scope_id: str,
        content: str,
        metadata: Dict[str, Any] | None = None,
    ) -> Dict[str, Any]:
        record = {
            "memory_id": f"mem_{uuid4().hex[:12]}",
            "memory_type": memory_type,
            "scope_type": scope_type,
            "scope_id": scope_id,
            "content": content,
            "metadata": metadata or {},
            "created_at": _utc_now(),
        }
        records = self._read_records(tenant_id, scope_type, scope_id)
        records.append(record)
        self._write_records(tenant_id, scope_type, scope_id, records)
        return record

    def replace_memory(
        self,
        tenant_id: str,
        memory_type: str,
        scope_type: str,
        scope_id: str,
        content: str,
        metadata: Dict[str, Any] | None = None,
    ) -> Dict[str, Any]:
        """Write a single memory record, replacing any existing records of the same type."""
        record = {
            "memory_id": f"mem_{uuid4().hex[:12]}",
            "memory_type": memory_type,
            "scope_type": scope_type,
            "scope_id": scope_id,
            "content": content,
            "metadata": metadata or {},
            "created_at": _utc_now(),
        }
        # Keep all records except existing ones of this memory_type
        existing = self._read_records(tenant_id, scope_type, scope_id)
        kept = [r for r in existing if r.get("memory_type") != memory_type]
        kept.append(record)
        self._write_records(tenant_id, scope_type, scope_id, kept)
        return record

    def list_memories(
        self,
        tenant_id: str,
        scope_type: str,
        scope_id: str,
        memory_type: str | None = None,
        top_k: int = 5,
    ) -> List[Dict[str, Any]]:
        records = self._read_records(tenant_id, scope_type, scope_id)
        if memory_type:
            records = [r for r in records if r.get("memory_type") == memory_type]
        return records[-top_k:]

    # ── Scope index (parent → children) ────────────────────────────────────────

    def _index_file(self, tenant_id: str, parent_type: str, parent_id: str) -> Path:
        idx_dir = self.base_dir / tenant_id / "_index" / parent_type
        idx_dir.mkdir(parents=True, exist_ok=True)
        return idx_dir / f"{parent_id.replace('/', '_')}.json"

    def register_child_scope(
        self,
        tenant_id: str,
        parent_type: str,
        parent_id: str,
        child_type: str,
        child_id: str,
    ) -> None:
        """Register a child scope under a parent (e.g. assessment under case)."""
        path = self._index_file(tenant_id, parent_type, parent_id)
        try:
            index: Dict[str, List[str]] = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        except Exception:
            index = {}
        children = index.get(child_type, [])
        if child_id not in children:
            children.append(child_id)
            index[child_type] = children
            path.write_text(json.dumps(index, indent=2), encoding="utf-8")

    def list_child_scope_ids(
        self,
        tenant_id: str,
        parent_type: str,
        parent_id: str,
        child_type: str,
    ) -> List[str]:
        """Return all child scope IDs of given type under a parent."""
        path = self._index_file(tenant_id, parent_type, parent_id)
        if not path.exists():
            return []
        try:
            index: Dict[str, List[str]] = json.loads(path.read_text(encoding="utf-8"))
            return index.get(child_type, [])
        except Exception:
            return []