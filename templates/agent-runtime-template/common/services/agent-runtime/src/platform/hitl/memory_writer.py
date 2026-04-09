from __future__ import annotations

from typing import Any, Dict
from datetime import datetime, timezone

from src.platform.memory.memory_store import FileMemoryStore
from src.platform.memory.write_engine import write_episodic_event

_PLATFORM_ID_KEYS = {"tenant_id", "user_id", "thread_id", "correlation_id", "run_id"}


def _build_scopes(ctx: Dict[str, Any]) -> list:
    """Build scope list from active domain scope IDs in ctx."""
    scopes = []
    domain = ctx.get("domain") or {}
    domain_scopes = domain.get("scopes") or []

    if domain_scopes:
        for scope_def in domain_scopes:
            id_field = scope_def.get("id_field") or ""
            scope_name = scope_def.get("name") or ""
            if id_field and scope_name and ctx.get(id_field):
                scopes.append({"scope_type": scope_name, "scope_id": ctx[id_field]})
    else:
        # Fallback: infer from *_id keys in ctx
        for key, val in ctx.items():
            if key.endswith("_id") and key not in _PLATFORM_ID_KEYS and val:
                scopes.append({"scope_type": key[:-3], "scope_id": str(val)})

    return scopes


def _scope_metadata(ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Build metadata dict of all active scope IDs from domain.yaml."""
    metadata: Dict[str, Any] = {}
    domain = ctx.get("domain") or {}
    domain_scopes = domain.get("scopes") or []

    if domain_scopes:
        for scope_def in domain_scopes:
            id_field = scope_def.get("id_field") or ""
            if id_field and ctx.get(id_field):
                metadata[id_field] = ctx[id_field]
    else:
        for key, val in ctx.items():
            if key.endswith("_id") and key not in _PLATFORM_ID_KEYS and val:
                metadata[key] = val

    return metadata


def write_hitl_requested(
    approval_id: str,
    tool_name: str,
    risk_level: str,
    ctx: Dict[str, Any],
):
    store = FileMemoryStore()
    tenant_id = ctx.get("tenant_id", "default")
    scopes = _build_scopes(ctx)
    write_episodic_event(
        store=store,
        tenant_id=tenant_id,
        scopes=scopes,
        content=f"HITL approval requested for tool '{tool_name}' (risk: {risk_level}). Approval ID: {approval_id}",
        metadata={
            "type": "hitl_requested",
            "approval_id": approval_id,
            "tool": tool_name,
            "risk_level": risk_level,
            "requested_by": ctx.get("user_id", "unknown"),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )


def write_hitl_decision(
    approval_id: str,
    tool_name: str,
    decision: str,
    decided_by: str,
    reason: str,
    tool_result: Any,
    ctx: Dict[str, Any],
):
    store = FileMemoryStore()
    tenant_id = ctx.get("tenant_id", "default")
    scopes = _build_scopes(ctx)

    if decision == "approved":
        content = (
            f"HITL approval APPROVED for tool '{tool_name}' by {decided_by}. "
            f"Reason: {reason}. Result: {tool_result}"
        )
        event_type = "hitl_approved"
    else:
        content = (
            f"HITL approval REJECTED for tool '{tool_name}' by {decided_by}. "
            f"Reason: {reason}"
        )
        event_type = "hitl_rejected"

    write_episodic_event(
        store=store,
        tenant_id=tenant_id,
        scopes=scopes,
        content=content,
        metadata={
            "type": event_type,
            "approval_id": approval_id,
            "tool": tool_name,
            "decided_by": decided_by,
            "reason": reason,
            "tool_result": str(tool_result) if tool_result else None,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )


def write_hitl_tool_executed(
    tool_name: str,
    tool_input: Dict[str, Any],
    tool_result: Any,
    ctx: Dict[str, Any],
):
    """Write a clean episodic event after a HITL-approved tool executes."""
    store = FileMemoryStore()
    tenant_id = ctx.get("tenant_id", "default")
    scopes = _build_scopes(ctx)

    input_summary = ", ".join(f"{k}: {v}" for k, v in tool_input.items() if k not in ("tenant_id",))
    content = (
        f"Tool '{tool_name}' executed after supervisor approval. "
        f"Input: {input_summary}. "
        f"Result: {tool_result}"
    )

    write_episodic_event(
        store=store,
        tenant_id=tenant_id,
        scopes=scopes,
        content=content,
        metadata={
            "type": "tool_executed_post_hitl",
            "tool": tool_name,
            "tool_input": tool_input,
            "source": "tool_success",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            **_scope_metadata(ctx),
        },
    )
