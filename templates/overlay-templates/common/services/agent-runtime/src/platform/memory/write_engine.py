from __future__ import annotations

from typing import Any, Dict, List

from src.platform.memory.memory_store import FileMemoryStore
from src.platform.memory.semantic_engine import extract_semantic_facts


def write_raw_turns(
    store: FileMemoryStore,
    tenant_id: str,
    thread_id: str,
    user_prompt: str,
    assistant_response: str,
    metadata: Dict[str, Any] | None = None,
) -> None:
    if not thread_id:
        return

    store.append_raw_turn(
        tenant_id=tenant_id,
        thread_id=thread_id,
        role="user",
        content=user_prompt,
        metadata=metadata or {},
    )
    store.append_raw_turn(
        tenant_id=tenant_id,
        thread_id=thread_id,
        role="assistant",
        content=assistant_response,
        metadata=metadata or {},
    )


def write_episodic_event(
    store: FileMemoryStore,
    tenant_id: str,
    scopes: List[Dict[str, Any]],
    content: str,
    metadata: Dict[str, Any] | None = None,
) -> None:
    for scope in scopes:
        if scope["scope_type"] in {"case", "assessment"}:
            store.write_memory(
                tenant_id=tenant_id,
                memory_type="episodic",
                scope_type=scope["scope_type"],
                scope_id=scope["scope_id"],
                content=content,
                metadata=metadata or {},
            )


def write_semantic_memories(
    store: FileMemoryStore,
    tenant_id: str,
    ctx: Dict[str, Any],
    memory_cfg: Dict[str, Any],
    prompt: str,
    response: str,
) -> None:
    semantic_cfg = ((memory_cfg.get("write_policies") or {}).get("semantic") or {})
    if not semantic_cfg.get("enabled", False):
        return

    facts = extract_semantic_facts(prompt, response)

    for fact in facts:
        target_scope = fact["target_scope"]
        scope_id = None

        if target_scope == "member":
            scope_id = ctx.get("member_id")
        elif target_scope == "user":
            scope_id = ctx.get("user_id")

        if not scope_id:
            continue

        store.write_memory(
            tenant_id=tenant_id,
            memory_type="semantic",
            scope_type=target_scope,
            scope_id=str(scope_id),
            content=fact["content"],
            metadata={
                "fact_type": fact["fact_type"],
                "source": "semantic_engine_rule_based",
            },
        )