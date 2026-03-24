from __future__ import annotations

from typing import Any, Dict, List

from src.platform.memory.memory_store import FileMemoryStore


def build_memory_context(
    scopes: List[Dict[str, Any]],
    memory_cfg: Dict[str, Any],
    tenant_id: str = "default-tenant",
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

    store = FileMemoryStore()

    recent_turns: List[Dict[str, Any]] = []
    conversation_summary = None
    episodic_memories: List[Dict[str, Any]] = []
    semantic_memories: List[Dict[str, Any]] = []

    retrieval_cfg = memory_cfg.get("retrieval_policies") or {}
    conv_cfg = retrieval_cfg.get("conversation") or {}
    case_cfg = retrieval_cfg.get("case") or {}
    member_cfg = retrieval_cfg.get("member") or {}

    for scope in scopes:
        if scope["scope_type"] == "conversation":
            max_turns = ((conv_cfg.get("short_term") or {}).get("max_turns", 8))

            all_recent = store.list_recent_turns(
                tenant_id=tenant_id,
                thread_id=scope["scope_id"],
                max_turns=max_turns + 10,
            )
            recent_turns = [r for r in all_recent if r.get("memory_type") == "short_term"][-max_turns:]

            summary_items = store.list_memories(
                tenant_id=tenant_id,
                scope_type="conversation",
                scope_id=scope["scope_id"],
                memory_type="summary",
                top_k=1,
            )
            conversation_summary = summary_items[-1]["content"] if summary_items else None

        if scope["scope_type"] == "case":
            top_k = ((case_cfg.get("episodic") or {}).get("top_k", 5))
            # Read case-level episodic
            episodic_memories.extend(
                store.list_memories(
                    tenant_id=tenant_id,
                    scope_type="case",
                    scope_id=scope["scope_id"],
                    memory_type="episodic",
                    top_k=top_k,
                )
            )
            # Roll up episodic from all assessments under this case
            child_assessment_ids = store.list_child_scope_ids(
                tenant_id=tenant_id,
                parent_type="case",
                parent_id=scope["scope_id"],
                child_type="assessment",
            )
            for asmt_id in child_assessment_ids:
                episodic_memories.extend(
                    store.list_memories(
                        tenant_id=tenant_id,
                        scope_type="assessment",
                        scope_id=asmt_id,
                        memory_type="episodic",
                        top_k=top_k,
                    )
                )

        if scope["scope_type"] == "assessment":
            top_k = ((case_cfg.get("episodic") or {}).get("top_k", 5))
            episodic_memories.extend(
                store.list_memories(
                    tenant_id=tenant_id,
                    scope_type="assessment",
                    scope_id=scope["scope_id"],
                    memory_type="episodic",
                    top_k=top_k,
                )
            )

        if scope["scope_type"] == "member":
            top_k_semantic = ((member_cfg.get("semantic") or {}).get("top_k", 3))
            top_k_episodic = ((case_cfg.get("episodic") or {}).get("top_k", 5))
            # Member-level semantic
            semantic_memories.extend(
                store.list_memories(
                    tenant_id=tenant_id,
                    scope_type="member",
                    scope_id=scope["scope_id"],
                    memory_type="semantic",
                    top_k=top_k_semantic,
                )
            )
            # Roll up episodic from all cases under this member
            child_case_ids = store.list_child_scope_ids(
                tenant_id=tenant_id,
                parent_type="member",
                parent_id=scope["scope_id"],
                child_type="case",
            )
            for case_id in child_case_ids:
                episodic_memories.extend(
                    store.list_memories(
                        tenant_id=tenant_id,
                        scope_type="case",
                        scope_id=case_id,
                        memory_type="episodic",
                        top_k=top_k_episodic,
                    )
                )
                # Roll up episodic from all assessments under each case
                child_assessment_ids = store.list_child_scope_ids(
                    tenant_id=tenant_id,
                    parent_type="case",
                    parent_id=case_id,
                    child_type="assessment",
                )
                for asmt_id in child_assessment_ids:
                    episodic_memories.extend(
                        store.list_memories(
                            tenant_id=tenant_id,
                            scope_type="assessment",
                            scope_id=asmt_id,
                            memory_type="episodic",
                            top_k=top_k_episodic,
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