from __future__ import annotations

from typing import Any, Dict, List

from src.clients.base import post


def run(
    prompt: str,
    history: List[Dict[str, Any]],
    ctx: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Run the full reasoning cycle in Container 2.

    ctx must include: domain, tool_policy, retrieval, hitl, prompts, reasoning,
                      memory_context, rag_context, tenant_id, thread_id, scope IDs.

    Returns:
      needs_hitl     : bool
      answer         : str (when needs_hitl=false)
      result         : dict (raw executor result)
      tool_name      : str (when needs_hitl=true)
      tool_input     : dict (when needs_hitl=true)
      risk_level     : str (when needs_hitl=true)
      planner_trace, router_trace, executor_trace
    """
    resp = post("/reasoning/run", {
        "prompt": prompt,
        "history": history,
        "ctx": ctx,
    })
    return resp
