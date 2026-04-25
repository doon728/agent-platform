from __future__ import annotations

from typing import Any, Dict, List

from platform_core.memory.memory_interface import MemoryBackend
from platform_core.memory.semantic_engine import extract_semantic_facts


def _check_write_locked(memory_type: str, type_cfg: Dict[str, Any]) -> None:
    """Hard-block write if write_locked is set. Raises regardless of caller."""
    if type_cfg.get("write_locked", False):
        raise PermissionError(
            f"Memory write blocked: write_locked=true for '{memory_type}'. "
            f"This is enforced by the agent type capability matrix and cannot be overridden."
        )


def write_raw_turns(
    store: MemoryBackend,
    tenant_id: str,
    thread_id: str,
    user_prompt: str,
    assistant_response: str,
    metadata: Dict[str, Any] | None = None,
    short_term_cfg: Dict[str, Any] | None = None,
) -> None:
    _check_write_locked("short_term", short_term_cfg or {})

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


def _domain_scope_names(domain: Dict[str, Any]) -> set:
    """Return scope names defined in domain.yaml — these are valid episodic write targets."""
    return {s["name"] for s in (domain.get("scopes") or []) if s.get("name")}


def write_episodic_event(
    store: MemoryBackend,
    tenant_id: str,
    scopes: List[Dict[str, Any]],
    content: str,
    metadata: Dict[str, Any] | None = None,
    episodic_cfg: Dict[str, Any] | None = None,
    domain: Dict[str, Any] | None = None,
) -> None:
    _check_write_locked("episodic", episodic_cfg or {})

    # Write only to domain scopes — derived from domain.yaml, not hardcoded.
    # Platform-internal scopes (conversation, user) are not in domain.yaml and are excluded.
    valid_scopes = _domain_scope_names(domain or {})

    for scope in scopes:
        if valid_scopes and scope["scope_type"] not in valid_scopes:
            continue
        # Fallback: if domain not provided, skip known platform-internal scopes
        if not valid_scopes and scope["scope_type"] in {"conversation", "user"}:
            continue
        store.write_memory(
            tenant_id=tenant_id,
            memory_type="episodic",
            scope_type=scope["scope_type"],
            scope_id=scope["scope_id"],
            content=content,
            metadata=metadata or {},
        )


def write_semantic_memories(
    store: MemoryBackend,
    tenant_id: str,
    ctx: Dict[str, Any],
    memory_cfg: Dict[str, Any],
    prompt: str,
    response: str,
    audit_metadata: Dict[str, Any] | None = None,
) -> None:
    semantic_cfg = ((memory_cfg.get("write_policies") or {}).get("semantic") or {})
    if not semantic_cfg.get("enabled", False):
        return

    _check_write_locked("semantic", semantic_cfg)

    facts = extract_semantic_facts(prompt, response)
    if not facts:
        return

    dedup_cfg = semantic_cfg.get("dedup") or {}
    dedup_enabled = dedup_cfg.get("enabled", False)

    for fact in facts:
        target_scope = fact["target_scope"]
        scope_id = None

        if target_scope == "member":
            scope_id = ctx.get("member_id")
        elif target_scope == "user":
            scope_id = ctx.get("user_id")

        if not scope_id:
            continue

        scope_id_str = str(scope_id)
        metadata = {
            "fact_type": fact["fact_type"],
            "source": "semantic_engine_llm",
            **(audit_metadata or {}),
        }

        if dedup_enabled:
            # Check if a fact with same fact_type already exists for this scope
            existing = store.list_memories(
                tenant_id=tenant_id,
                scope_type=target_scope,
                scope_id=scope_id_str,
                memory_type="semantic",
                top_k=100,
            )
            duplicate = next(
                (r for r in existing if (r.get("metadata") or {}).get("fact_type") == fact["fact_type"]),
                None,
            )
            if duplicate:
                # Update in place — replace all semantic entries of this fact_type
                store.replace_memory(
                    tenant_id=tenant_id,
                    memory_type="semantic",
                    scope_type=target_scope,
                    scope_id=scope_id_str,
                    content=fact["content"],
                    metadata={**metadata, "updated": True},
                )
                continue

        store.write_memory(
            tenant_id=tenant_id,
            memory_type="semantic",
            scope_type=target_scope,
            scope_id=scope_id_str,
            content=fact["content"],
            metadata=metadata,
        )