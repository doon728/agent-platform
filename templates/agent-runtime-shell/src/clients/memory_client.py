from __future__ import annotations

from typing import Any, Dict, List

from src.clients.base import post


def read(ctx: Dict[str, Any], usecase_cfg: Dict[str, Any]) -> Dict[str, Any]:
    """
    Pre-graph memory read.
    Returns: {memory_cfg, active_scopes, memory_context}
    """
    resp = post("/memory/read", {"ctx": ctx, "usecase_cfg": usecase_cfg})
    return {
        "memory_cfg": resp.get("memory_cfg") or {},
        "active_scopes": resp.get("active_scopes") or [],
        "memory_context": resp.get("memory_context") or {},
    }


def write(
    prompt: str,
    response: str,
    ctx: Dict[str, Any],
    memory_cfg: Dict[str, Any],
    active_scopes: List[Any],
    memory_policy_state: Dict[str, bool],
    planner_trace: Dict[str, Any],
    usecase_cfg: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Post-graph memory write.
    Returns: {written, skipped}
    """
    resp = post("/memory/write", {
        "prompt": prompt,
        "response": response,
        "ctx": ctx,
        "memory_cfg": memory_cfg,
        "active_scopes": active_scopes,
        "memory_policy_state": memory_policy_state,
        "planner_trace": planner_trace,
        "usecase_cfg": usecase_cfg,
    })
    return resp
