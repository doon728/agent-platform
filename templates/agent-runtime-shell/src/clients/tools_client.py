from __future__ import annotations

from typing import Any, Dict, List

from src.clients.base import get, post


def list_tools() -> List[Dict[str, Any]]:
    """Fetch all registered tool specs from Container 2."""
    resp = get("/tools/list")
    return resp.get("tools") or []


def invoke(tool_name: str, tool_input: Dict[str, Any], ctx: Dict[str, Any], bypass_hitl: bool = False) -> Any:
    """
    Invoke a tool via Container 2.
    Used for approved HITL tool execution — bypass_hitl=True skips HITL check.
    """
    resp = post("/tools/invoke", {
        "tool_name": tool_name,
        "tool_input": tool_input,
        "ctx": ctx,
        "bypass_hitl": bypass_hitl,
    })
    if not resp.get("ok"):
        raise RuntimeError(resp.get("error") or "Tool invocation failed")
    return resp.get("result")
