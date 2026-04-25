from __future__ import annotations

from typing import Any, Dict, List, Optional

from src.platform.memory.memory_store import FileMemoryStore


def _children_of(domain: Dict[str, Any], scope_type: str) -> List[str]:
    """Return scope names whose parent == scope_type."""
    return [
        s["name"]
        for s in (domain.get("scopes") or [])
        if s.get("parent") == scope_type and s.get("name")
    ]


def _is_top_level(domain: Dict[str, Any], scope_type: str) -> bool:
    """True if this scope has no parent in the domain hierarchy."""
    for s in (domain.get("scopes") or []):
        if s.get("name") == scope_type:
            return s.get("parent") is None
    return False


def _top_k(retrieval_cfg: Dict[str, Any], scope_type: str, memory_type: str, default: int = 5) -> int:
    scope_cfg = (retrieval_cfg.get(scope_type) or {}).get(memory_type) or {}
    return scope_cfg.get("top_k", default)


def _collect_episodic(
    store: FileMemoryStore,
    tenant_id: str,
    scope_type: str,
    scope_id: str,
    domain: Dict[str, Any],
    retrieval_cfg: Dict[str, Any],
    depth: int = 3,
) -> List[Dict[str, Any]]:
    """Episodic from this scope + recursively from all child scopes."""
    results = store.list_memories(
        tenant_id=tenant_id,
        scope_type=scope_type,
        scope_id=scope_id,
        memory_type="episodic",
        top_k=_top_k(retrieval_cfg, scope_type, "episodic"),
    )
    if depth > 0:
        for child_type in _children_of(domain, scope_type):
            child_ids = store.list_child_scope_ids(
                tenant_id=tenant_id,
                parent_type=scope_type,
                parent_id=scope_id,
                child_type=child_type,
            )
            for child_id in child_ids:
                results.extend(
                    _collect_episodic(
                        store, tenant_id, child_type, child_id, domain, retrieval_cfg, depth - 1
                    )
                )
    return results


def build_memory_context(
    scopes: List[Dict[str, Any]],
    memory_cfg: Dict[str, Any],
    tenant_id: str = "default-tenant",
    domain: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    if not memory_cfg.get("enabled", False):
        return {
            "enabled": False,
            "scopes": [],
            "recent_turns": [],
            "conversation_summary": None,
            "episodic_memories": [],
            "semantic_memories": [],
        }

    if domain is None:
        try:
            from src.platform.usecase_config_loader import load_domain_config
            domain = load_domain_config()
        except Exception:
            domain = {}

    store = FileMemoryStore()
    retrieval_cfg = memory_cfg.get("retrieval_policies") or {}
    conv_cfg = retrieval_cfg.get("conversation") or {}

    recent_turns: List[Dict[str, Any]] = []
    conversation_summary = None
    episodic_memories: List[Dict[str, Any]] = []
    semantic_memories: List[Dict[str, Any]] = []

    for scope in scopes:
        scope_type = scope["scope_type"]
        scope_id = scope["scope_id"]

        if scope_type == "conversation":
            max_turns = ((conv_cfg.get("short_term") or {}).get("max_turns", 8))
            all_recent = store.list_recent_turns(
                tenant_id=tenant_id,
                thread_id=scope_id,
                max_turns=max_turns + 10,
            )
            recent_turns = [r for r in all_recent if r.get("memory_type") == "short_term"][-max_turns:]

            summary_items = store.list_memories(
                tenant_id=tenant_id,
                scope_type="conversation",
                scope_id=scope_id,
                memory_type="summary",
                top_k=1,
            )
            conversation_summary = summary_items[-1]["content"] if summary_items else None
            continue

        if scope_type in ("user",):
            continue

        # For all domain scopes: collect episodic + roll up from children
        episodic_memories.extend(
            _collect_episodic(store, tenant_id, scope_type, scope_id, domain, retrieval_cfg)
        )

        # Top-level scopes (no parent) also get semantic memories
        if _is_top_level(domain, scope_type):
            top_k_semantic = _top_k(retrieval_cfg, scope_type, "semantic", default=3)
            semantic_memories.extend(
                store.list_memories(
                    tenant_id=tenant_id,
                    scope_type=scope_type,
                    scope_id=scope_id,
                    memory_type="semantic",
                    top_k=top_k_semantic,
                )
            )

    return {
        "enabled": True,
        "scopes": scopes,
        "recent_turns": recent_turns,
        "conversation_summary": conversation_summary,
        "episodic_memories": episodic_memories,
        "semantic_memories": semantic_memories,
    }
