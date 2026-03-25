from __future__ import annotations

from typing import Any, Dict
from datetime import datetime, timezone

from src.platform.memory.memory_store import FileMemoryStore
from src.platform.memory.write_engine import write_episodic_event


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
            "requested_by": ctx.get("user_id", "nurse"),
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


def _build_scopes(ctx: Dict[str, Any]) -> Dict[str, str]:
    scopes = {}
    if ctx.get("assessment_id"):
        scopes["assessment"] = ctx["assessment_id"]
    if ctx.get("case_id"):
        scopes["case"] = ctx["case_id"]
    if ctx.get("member_id"):
        scopes["member"] = ctx["member_id"]
    return scopes
