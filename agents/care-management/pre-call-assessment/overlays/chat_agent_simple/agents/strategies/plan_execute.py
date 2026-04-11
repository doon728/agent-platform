from __future__ import annotations

# Plan-Execute reasoning strategy for chat_agent.
#
# Two-phase:
#   Phase 1 — Plan: LLM decides ALL tools and order upfront in one shot.
#   Phase 2 — Execute: run each planned tool sequentially, no re-planning.
#   Phase 3 — Respond: synthesize all observations into final answer.
#
# Key difference from react:
#   react re-plans after each observation (N planner LLM calls).
#   plan_execute plans once, then executes without any more planner LLM calls (always 2 LLM calls).
#   Step N does NOT know what step N-1 returned during planning — only during respond.
#
# Best for: queries where steps are predictable and independent of each other's output.
#   e.g. "summarize the assessment and check the member profile"
#        "get open tasks and search policy for medication guidelines"
#
# NOT good for: queries where the next tool depends on what the previous tool returned.
#   Use react for those.
#
# Config (agent.yaml):
#   reasoning:
#     strategy: plan_execute

import os
from typing import Any, Dict, List, Optional, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, create_model

from overlays.chat_agent_simple.agents.executor import execute
from overlays.chat_agent_simple.agents.llm_planner import (
    _active_scope_context,
    _get_allowed_tools,
    _get_planner_prompt,
    _get_tool_descriptions,
    _history_text,
)

_MAX_STEPS = 6


class GraphState(TypedDict, total=False):
    prompt: str
    ctx: Dict[str, Any]
    history: List[Dict[str, Any]]
    # plan_execute specific
    planned_steps: List[Dict]       # [{thought, tool, argument}] — decided upfront
    current_step_index: int         # which step we're executing next
    observations: List[Dict]        # [{step, tool, argument, output}] — accumulated
    # output
    result: Any
    answer: str
    planner_trace: Dict[str, Any]
    router_trace: Dict[str, Any]
    executor_trace: Dict[str, Any]


def _build_plan_schema(allowed_tools: List[str]):
    """Schema for the planning phase — LLM outputs a full ordered list of tool calls."""
    from typing import Literal

    if len(allowed_tools) == 1:
        tool_type = Literal[allowed_tools[0]]  # type: ignore
    else:
        tool_type = Literal[tuple(allowed_tools)]  # type: ignore

    class ToolStep(BaseModel):
        thought: str    # why this step is needed
        tool: tool_type  # type: ignore
        argument: str   # tool input

    class Plan(BaseModel):
        overall_thought: str        # high-level reasoning about the full plan
        steps: List[ToolStep]       # ordered list of tool calls

    return Plan


def _planner(state: GraphState) -> GraphState:
    prompt = state.get("prompt", "") or ""
    history = state.get("history") or []
    ctx = state.get("ctx") or {}

    allowed_tools = _get_allowed_tools(ctx)
    planner_prompt = _get_planner_prompt(ctx)
    active_scopes = _active_scope_context(ctx, history)
    history_text = _history_text(history)
    tools_text = _get_tool_descriptions(allowed_tools)

    scope_context_lines = "\n".join(
        f"Active {scope}: {scope_id}" for scope, scope_id in active_scopes.items()
    ) or "(no scope context)"

    rag_chunks = ctx.get("rag_context") or []
    if rag_chunks:
        rag_lines = "\n\n".join(
            f"[KB {i+1}] {chunk.get('title', '')} — {chunk.get('content', chunk.get('snippet', ''))}"
            for i, chunk in enumerate(rag_chunks)
        )
        rag_section = f"\n\nKnowledge base context:\n{rag_lines}"
    else:
        rag_section = ""

    model_name = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    api_key = os.getenv("OPENAI_API_KEY", "")
    llm = ChatOpenAI(model=model_name, temperature=0, api_key=api_key)

    PlanSchema = _build_plan_schema(allowed_tools)
    structured_llm = llm.with_structured_output(PlanSchema)

    system = SystemMessage(content=f"""
{planner_prompt}

You are in the PLANNING phase. Decide ALL the tools you need to answer the user's question — in the correct order.
You will NOT be able to re-plan after seeing tool outputs. Plan carefully upfront.
Only include steps that are truly needed. Do not add unnecessary tool calls.

Active context:
{scope_context_lines}{rag_section}

Available tools:
{tools_text}
""")

    human = HumanMessage(content=(
        f"Conversation history:\n{history_text or '(none)'}\n\n"
        f"User question:\n{prompt}\n\n"
        "Output your overall reasoning and the full ordered list of tool calls needed."
    ))

    try:
        result = structured_llm.invoke([system, human])
        steps = [
            {"thought": s.thought, "tool": s.tool, "argument": s.argument}
            for s in (result.steps or [])
        ]
        # Cap at _MAX_STEPS
        steps = steps[:_MAX_STEPS]
        overall_thought = result.overall_thought or ""
    except Exception as e:
        print(f"[plan_execute] planning failed: {e}", flush=True)
        retrieval_cfg = ctx.get("retrieval") or {}
        fallback_tool = retrieval_cfg.get("default_tool", "search_kb")
        steps = [{"thought": f"Fallback due to error: {e}", "tool": fallback_tool, "argument": prompt}]
        overall_thought = f"Planning failed, falling back to {fallback_tool}"

    print(f"[plan_execute] planned {len(steps)} steps: {[s['tool'] for s in steps]}", flush=True)

    return {
        "planned_steps": steps,
        "current_step_index": 0,
        "observations": [],
        "planner_trace": {
            "route_type": "PLAN_EXECUTE",
            "overall_thought": overall_thought,
            "planned_tools": [s["tool"] for s in steps],
        },
    }


def _executor(state: GraphState) -> GraphState:
    planned_steps = state.get("planned_steps") or []
    current_index = state.get("current_step_index", 0)
    observations = list(state.get("observations") or [])
    ctx = dict(state.get("ctx") or {})
    ctx["history"] = state.get("history") or []

    if current_index >= len(planned_steps):
        return {"current_step_index": current_index}

    step = planned_steps[current_index]
    tool = step["tool"]
    argument = step["argument"]
    thought = step["thought"]

    print(f"[plan_execute] executing step {current_index + 1}/{len(planned_steps)}: {tool}({argument[:60]})", flush=True)

    result = execute([f"{tool}: {argument}"], ctx)

    # Extract readable output for observations
    if isinstance(result, dict):
        raw = result.get("answer") or result.get("output") or result.get("result") or ""
        if isinstance(raw, dict):
            raw = str(raw)
        output_text = str(raw).strip()[:400]
    else:
        output_text = str(result)[:400]

    observations.append({
        "step": current_index + 1,
        "thought": thought,
        "tool": tool,
        "argument": argument,
        "output": output_text,
    })

    is_approval = isinstance(result, dict) and result.get("result") == "APPROVAL_REQUIRED"

    executor_trace = {
        "tool": tool,
        "step": current_index + 1,
        "status": "approval_required" if is_approval else "success",
        "output_snippet": output_text[:120],
    }

    return {
        "current_step_index": current_index + 1,
        "observations": observations,
        "result": result,
        "executor_trace": executor_trace,
    }


def _should_continue(state: GraphState) -> str:
    planned_steps = state.get("planned_steps") or []
    current_index = state.get("current_step_index", 0)
    result = state.get("result")

    # Stop if HITL approval required
    if isinstance(result, dict) and result.get("result") == "APPROVAL_REQUIRED":
        return "end"

    # More steps remaining
    if current_index < len(planned_steps):
        return "executor"

    return "responder"


def _responder(state: GraphState) -> GraphState:
    from overlays.chat_agent_simple.agents.chat_responder import build_chat_answer

    observations = state.get("observations") or []

    # Format all observations for the responder
    obs_lines = []
    for obs in observations:
        obs_lines.append(
            f"Step {obs['step']} — {obs['tool']}:\n{obs['output']}"
        )
    obs_text = "\n\n".join(obs_lines)

    augmented_result = {
        "result": "OK",
        "mode": "PLAN_EXECUTE",
        "answer": obs_text,
        "plan_execute_observations": obs_text,
    }

    answer = build_chat_answer(
        prompt=state.get("prompt", "") or "",
        history=state.get("history") or [],
        result=augmented_result,
    )

    return {"answer": answer}


def build_graph(checkpointer: Optional[object] = None):
    g = StateGraph(GraphState)

    g.add_node("planner", _planner)
    g.add_node("executor", _executor)
    g.add_node("responder", _responder)

    g.add_edge(START, "planner")
    g.add_edge("planner", "executor")

    g.add_conditional_edges(
        "executor",
        _should_continue,
        {
            "executor": "executor",
            "responder": "responder",
            "end": END,
        },
    )

    g.add_edge("responder", END)

    if checkpointer is None:
        return g.compile()
    return g.compile(checkpointer=checkpointer)
