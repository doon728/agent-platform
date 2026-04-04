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


def write_hitl_tool_executed(
    tool_name: str,
    tool_input: Dict[str, Any],
    tool_result: Any,
    ctx: Dict[str, Any],
):
    """Write a clean clinical episodic event after a HITL-approved tool executes.
    This is separate from the audit trail written by write_hitl_decision and mirrors
    what langgraph_runner would have written for a non-HITL tool_success."""
    store = FileMemoryStore()
    tenant_id = ctx.get("tenant_id", "default")
    scopes = _build_scopes(ctx)

    # Build a readable clinical summary from the tool input
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
            "case_id": ctx.get("case_id"),
            "member_id": ctx.get("member_id"),
            "assessment_id": ctx.get("assessment_id"),
        },
    )


def _build_scopes(ctx: Dict[str, Any]) -> list:
    scopes = []
    if ctx.get("assessment_id"):
        scopes.append({"scope_type": "assessment", "scope_id": ctx["assessment_id"]})
    if ctx.get("case_id"):
        scopes.append({"scope_type": "case", "scope_id": ctx["case_id"]})
    if ctx.get("member_id"):
        scopes.append({"scope_type": "member", "scope_id": ctx["member_id"]})
    return scopes
