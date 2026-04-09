from __future__ import annotations

from typing import Any, Dict, List


class MemoryBackend:
    """Base interface for all memory backends. Swap via memory.yaml backend: field."""

    def append_raw_turn(
        self,
        tenant_id: str,
        thread_id: str,
        role: str,
        content: str,
        metadata: Dict[str, Any] | None = None,
        max_short_term_records: int = 100,
    ) -> Dict[str, Any]:
        raise NotImplementedError

    def list_recent_turns(
        self,
        tenant_id: str,
        thread_id: str,
        max_turns: int = 8,
    ) -> List[Dict[str, Any]]:
        raise NotImplementedError

    def write_memory(
        self,
        tenant_id: str,
        memory_type: str,
        scope_type: str,
        scope_id: str,
        content: str,
        metadata: Dict[str, Any] | None = None,
    ) -> Dict[str, Any]:
        raise NotImplementedError

    def replace_memory(
        self,
        tenant_id: str,
        memory_type: str,
        scope_type: str,
        scope_id: str,
        content: str,
        metadata: Dict[str, Any] | None = None,
    ) -> Dict[str, Any]:
        """Replace existing record matching memory_type + fact_type (if set), or all of memory_type."""
        raise NotImplementedError

    def list_memories(
        self,
        tenant_id: str,
        scope_type: str,
        scope_id: str,
        memory_type: str | None = None,
        top_k: int = 5,
    ) -> List[Dict[str, Any]]:
        raise NotImplementedError

    def register_child_scope(
        self,
        tenant_id: str,
        parent_type: str,
        parent_id: str,
        child_type: str,
        child_id: str,
    ) -> None:
        raise NotImplementedError

    def list_child_scope_ids(
        self,
        tenant_id: str,
        parent_type: str,
        parent_id: str,
        child_type: str,
    ) -> List[str]:
        raise NotImplementedError
