from __future__ import annotations

from typing import Any, Dict, List, Optional, TypedDict

from langgraph.graph import END, START, StateGraph

from overlays.chat_agent.agents.chat_responder import build_chat_answer
from overlays.chat_agent.agents.executor import execute
from overlays.chat_agent.agents.llm_planner import plan


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


def _planner(state: GraphState) -> GraphState:
    prompt = state.get("prompt", "") or ""
    history = state.get("history") or []
    ctx = state.get("ctx") or {}
    result = plan(prompt, history, ctx)
    # plan() returns (steps, planner_trace) tuple
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
        # Build output snippet from tool output
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
    g.add_node("planner", _planner)
    g.add_node("executor", _executor)
    g.add_node("chat_responder", _chat_responder)

    g.add_edge(START, "planner")
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