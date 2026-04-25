from __future__ import annotations

import importlib

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from platform_core.tools.bootstrap import register_tools
from platform_core.tools.discovery import load_tools_from_gateway

router = APIRouter()

_VALID_STRATEGIES = {"simple", "react", "self_corrective", "chain_of_thought", "multi_hop", "plan_execute", "reflection", "tree_of_thought"}

# Bootstrap tools once on import so strategies can call them
try:
    register_tools()
    load_tools_from_gateway()
except Exception as _e:
    print(f"[reasoning/router] tool bootstrap warning: {_e}", flush=True)


@router.post("/run")
async def reasoning_run(payload: dict) -> JSONResponse:
    """
    Run a full reasoning cycle (plan → execute → respond) for a given strategy.

    Input:
      prompt   : user message
      history  : conversation history [{role, content}]
      ctx      : full request context — must include:
                   domain, tool_policy, retrieval, hitl, prompts, reasoning,
                   memory_context (from /memory/read),
                   rag_context   (from /rag/retrieve),
                   tenant_id, thread_id, and all active scope IDs

    Output:
      ok           : bool
      answer       : final text response
      result       : raw executor result dict
      needs_hitl   : bool (true if a tool requires human approval)
      tool_name    : str (present when needs_hitl=true)
      tool_input   : dict (present when needs_hitl=true)
      risk_level   : str (present when needs_hitl=true)
      planner_trace, router_trace, executor_trace
    """
    prompt = payload.get("prompt") or ""
    history = payload.get("history") or []
    ctx = payload.get("ctx") or {}

    reasoning = ctx.get("reasoning") or {}
    strategy = (reasoning.get("strategy") or "simple").strip()

    if strategy not in _VALID_STRATEGIES:
        print(f"[reasoning/run] unknown strategy '{strategy}', falling back to simple", flush=True)
        strategy = "simple"

    print(f"[reasoning/run] strategy={strategy}", flush=True)

    try:
        mod = importlib.import_module(f"src.services.reasoning.strategies.{strategy}")
        graph = mod.build_graph()
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "error": f"Strategy load failed: {e}"})

    initial_state = {
        "prompt": prompt,
        "ctx": ctx,
        "history": history,
    }

    try:
        out = graph.invoke(initial_state)
    except Exception as e:
        import traceback
        print(traceback.format_exc(), flush=True)
        return JSONResponse(status_code=500, content={"ok": False, "error": f"Reasoning failed: {e}"})

    result = out.get("result") if isinstance(out, dict) else out

    # Surface NEEDS_HITL to Container 1 for local approval_store submission
    if isinstance(result, dict) and result.get("result") == "NEEDS_HITL":
        return JSONResponse({
            "ok": True,
            "needs_hitl": True,
            "tool_name": result.get("tool_name"),
            "tool_input": result.get("tool_input"),
            "risk_level": result.get("risk_level"),
            "planner_trace": out.get("planner_trace") or {},
            "router_trace": out.get("router_trace") or {},
            "executor_trace": out.get("executor_trace") or {},
        })

    answer = out.get("answer") if isinstance(out, dict) else str(out)

    return JSONResponse({
        "ok": True,
        "needs_hitl": False,
        "answer": answer,
        "result": result,
        "planner_trace": out.get("planner_trace") or {},
        "router_trace": out.get("router_trace") or {},
        "executor_trace": out.get("executor_trace") or {},
    })
