from __future__ import annotations

# Simple reasoning strategy for chat_agent.
#
# Single-pass: plan once → execute → respond.
# No loops, no retries, no multi-step reasoning.
# Default strategy for Q&A, lookup, and conversational use cases.

from typing import Any, Dict, List, Optional, TypedDict

from langgraph.graph import END, START, StateGraph

from overlays.chat_agent_simple.agents.chat_responder import build_chat_answer
from overlays.chat_agent_simple.agents.executor import execute
from overlays.chat_agent_simple.agents.llm_planner import plan


class GraphState(TypedDict, total=False):
    prompt: str
    ctx: Dict[str, Any]
    history: List[Dict[str, Any]]
    steps: List[str]
    result: Any
    answer: str
    planner_trace: Dict[str, Any]
    router_trace: Dict[str, Any]
    executor_trace: Dict[str, Any]
    hard_route_matched: bool


def _match_hard_route(prompt: str, hard_routes: List[Dict[str, Any]]) -> Dict[str, Any] | None:
    """Return the first hard route whose trigger phrase matches the prompt (case-insensitive substring)."""
    p = prompt.strip().lower()
    for route in (hard_routes or []):
        trigger = (route.get("trigger") or route.get("phrase") or "").strip().lower()
        if trigger and trigger in p:
            return route
    return None


def _hard_route_check(state: GraphState) -> GraphState:
    prompt = state.get("prompt", "") or ""
    ctx = state.get("ctx") or {}
    hard_routes = ctx.get("hard_routes") or []
    matched = _match_hard_route(prompt, hard_routes)
    if matched:
        tool = matched.get("tool") or ""
        # Use active scope ID as argument
        domain = ctx.get("domain") or {}
        scopes = domain.get("scopes") or []
        arg = ""
        for s in scopes:
            id_field = s.get("id_field") or ""
            if id_field and ctx.get(id_field):
                arg = ctx[id_field]
                break
        print(f"[hard_route] matched trigger='{matched.get('trigger')}' tool={tool} arg={arg}", flush=True)
        return {"steps": [f"{tool}:{arg}"], "hard_route_matched": True,
                "planner_trace": {"tool": tool, "argument": arg, "source": "hard_route"}}
    return {"hard_route_matched": False}


def _after_hard_route_check(state: GraphState) -> str:
    return "executor" if state.get("hard_route_matched") else "planner"


def _planner(state: GraphState) -> GraphState:
    prompt = state.get("prompt", "") or ""
    history = state.get("history") or []
    ctx = state.get("ctx") or {}
    result = plan(prompt, history, ctx)
    if isinstance(result, tuple):
        steps, planner_trace = result
    else:
        steps, planner_trace = result, {}
    return {"steps": steps, "planner_trace": planner_trace}


def _executor(state: GraphState) -> GraphState:
    ctx = dict(state.get("ctx") or {})
    ctx["history"] = state.get("history") or []
    result = execute(state.get("steps") or [], ctx)

    router_trace = {}
    executor_trace = {}
    if isinstance(result, dict):
        tool = result.get("tool", "")
        tool_input = result.get("input", {})
        router_trace = {
            "tool": tool,
            "resolved_input": tool_input,
            "mode": result.get("mode", ""),
        }
        is_approval = result.get("result") == "APPROVAL_REQUIRED"
        raw_output = result.get("output") or result.get("answer") or ""
        if isinstance(raw_output, dict):
            raw_output = raw_output.get("answer") or raw_output.get("result") or str(raw_output)
        output_text = str(raw_output).strip().replace("\n", " ")
        output_snippet = output_text[:120] + "…" if len(output_text) > 120 else output_text
        executor_trace = {
            "tool": tool,
            "status": "approval_required" if is_approval else ("success" if tool else ""),
            "mode": result.get("mode", ""),
            "output_snippet": output_snippet if not is_approval else "[awaiting approval]",
        }

    return {"result": result, "router_trace": router_trace, "executor_trace": executor_trace}


def _after_executor(state: GraphState) -> str:
    result = state.get("result")
    if isinstance(result, dict) and result.get("result") == "APPROVAL_REQUIRED":
        return "end"
    return "chat_responder"


def _chat_responder(state: GraphState) -> GraphState:
    result = state.get("result")

    if isinstance(result, dict) and isinstance(result.get("answer"), str):
        return {"answer": result["answer"]}

    answer = build_chat_answer(
        prompt=state.get("prompt", "") or "",
        history=state.get("history") or [],
        result=result,
    )
    return {"answer": answer}


def build_graph(checkpointer: Optional[object] = None):
    g = StateGraph(GraphState)
    g.add_node("hard_route_check", _hard_route_check)
    g.add_node("planner", _planner)
    g.add_node("executor", _executor)
    g.add_node("chat_responder", _chat_responder)

    g.add_edge(START, "hard_route_check")
    g.add_conditional_edges(
        "hard_route_check",
        _after_hard_route_check,
        {"executor": "executor", "planner": "planner"},
    )
    g.add_edge("planner", "executor")

    g.add_conditional_edges(
        "executor",
        _after_executor,
        {
            "chat_responder": "chat_responder",
            "end": END,
        },
    )

    g.add_edge("chat_responder", END)

    if checkpointer is None:
        return g.compile()
    return g.compile(checkpointer=checkpointer)
