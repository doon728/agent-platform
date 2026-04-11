from __future__ import annotations

# ReAct reasoning strategy for chat_agent.
#
# Loop: think → act (tool call) → observe (tool output) → repeat until DONE or max_steps.
# The planner emits a thought + tool + argument each step.
# When tool=DONE, the argument is the final answer — no extra LLM call needed.
#
# Best for: multi-step tasks, queries that require chaining 2+ tools,
#           cases where the answer depends on what the first tool returns.
#
# Config (agent.yaml):
#   reasoning:
#     strategy: react
#     max_steps: 5   # optional, default 5

import os
from typing import Any, Dict, List, Optional, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph
from pydantic import create_model

from overlays.chat_agent_simple.agents.executor import execute
from platform_core.memory.backend_factory import get_backend
from overlays.chat_agent_simple.agents.llm_planner import (
    _active_scope_context,
    _get_allowed_tools,
    _get_planner_prompt,
    _get_tool_descriptions,
    _history_text,
)

_DONE = "DONE"
_DEFAULT_MAX_STEPS = 5


class GraphState(TypedDict, total=False):
    prompt: str
    ctx: Dict[str, Any]
    history: List[Dict[str, Any]]
    # ReAct-specific
    observations: List[Dict[str, Any]]   # [{step, thought, tool, argument, output}]
    step_count: int
    max_steps: int
    current_tool: str
    current_argument: str
    current_thought: str
    # Output
    result: Any
    answer: str
    planner_trace: Dict[str, Any]
    router_trace: Dict[str, Any]
    executor_trace: Dict[str, Any]


def _build_react_schema(allowed_tools: List[str]):
    from typing import Literal
    tools_with_done = allowed_tools + [_DONE]
    if len(tools_with_done) == 1:
        tool_type = Literal[tools_with_done[0]]  # type: ignore
    else:
        tool_type = Literal[tuple(tools_with_done)]  # type: ignore
    return create_model(
        "ReactStep",
        thought=(str, ...),   # reasoning before acting — visible in trace
        tool=(tool_type, ...),
        argument=(str, ...),  # tool argument, or final answer when tool=DONE
    )


def _format_observations(observations: List[Dict[str, Any]]) -> str:
    if not observations:
        return "(no previous steps)"
    lines = []
    for obs in observations:
        lines.append(
            f"Step {obs['step']}\n"
            f"  Thought: {obs['thought']}\n"
            f"  Action: {obs['tool']}({obs['argument']})\n"
            f"  Observation: {obs['output']}"
        )
    return "\n\n".join(lines)


def _react_planner(state: GraphState) -> GraphState:
    prompt = state.get("prompt", "") or ""
    history = state.get("history") or []
    ctx = state.get("ctx") or {}
    observations = state.get("observations") or []
    step_count = state.get("step_count", 0)

    allowed_tools = _get_allowed_tools(ctx)
    planner_prompt = _get_planner_prompt(ctx)
    active_scopes = _active_scope_context(ctx, history)
    history_text = _history_text(history)
    tools_text = _get_tool_descriptions(allowed_tools)
    observations_text = _format_observations(observations)

    scope_context_lines = "\n".join(
        f"Active {scope}: {scope_id}" for scope, scope_id in active_scopes.items()
    ) or "(no scope context)"

    rag_chunks = ctx.get("rag_context") or []
    if rag_chunks:
        rag_lines = "\n\n".join(
            f"[KB {i+1}] {chunk.get('title', '')} — {chunk.get('content', chunk.get('snippet', ''))}"
            for i, chunk in enumerate(rag_chunks)
        )
        rag_section = f"\n\nKnowledge base context (retrieved before reasoning):\n{rag_lines}"
    else:
        rag_section = ""

    model_name = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    api_key = os.getenv("OPENAI_API_KEY", "")
    llm = ChatOpenAI(model=model_name, temperature=0, api_key=api_key)

    ReactStepSchema = _build_react_schema(allowed_tools)
    structured_llm = llm.with_structured_output(ReactStepSchema)

    system = SystemMessage(content=f"""
{planner_prompt}

You are reasoning step by step. After each tool call you will see its output.
Keep calling tools until you have enough information to answer fully.
When you have enough information, set tool=DONE and write the final answer in argument.

Active context:
{scope_context_lines}{rag_section}

Available tools:
{tools_text}

tool: DONE
purpose: Signal that you have enough information. Write the final answer in argument.
argument: final answer text
""")

    human = HumanMessage(content=(
        f"Conversation history:\n{history_text or '(none)'}\n\n"
        f"User question:\n{prompt}\n\n"
        f"Steps so far:\n{observations_text}\n\n"
        f"What is your next thought and action? (Step {step_count + 1})"
    ))

    try:
        result = structured_llm.invoke([system, human])
        thought = result.thought or ""
        tool = result.tool
        arg = (result.argument or "").strip()
    except Exception as e:
        print(f"[react_planner] structured output failed: {e}", flush=True)
        retrieval_cfg = ctx.get("retrieval") or {}
        fallback_tool = retrieval_cfg.get("default_tool", "search_kb")
        return {
            "current_tool": fallback_tool,
            "current_argument": prompt,
            "current_thought": f"Fallback due to error: {e}",
            "planner_trace": {"route_type": "REACT_FALLBACK", "error": str(e)},
        }

    print(f"[react_planner] step={step_count+1} thought={thought[:80]} tool={tool} arg={arg[:60]}", flush=True)

    return {
        "current_tool": tool,
        "current_argument": arg,
        "current_thought": thought,
        "planner_trace": {
            "route_type": "REACT",
            "step": step_count + 1,
            "thought": thought,
            "tool": tool,
            "argument": arg,
        },
    }


def _executor(state: GraphState) -> GraphState:
    tool = state.get("current_tool", "")
    arg = state.get("current_argument", "")
    thought = state.get("current_thought", "")
    ctx = dict(state.get("ctx") or {})
    ctx["history"] = state.get("history") or []
    observations = list(state.get("observations") or [])
    step_count = state.get("step_count", 0) + 1

    # DONE — no tool call, just collect final answer
    if tool == _DONE:
        return {
            "step_count": step_count,
            "answer": arg,
            "result": {"result": "OK", "answer": arg, "mode": "REACT_DONE"},
            "executor_trace": {"tool": _DONE, "status": "done", "mode": "REACT_DONE"},
        }

    steps = [f"{tool}: {arg}"]
    result = execute(steps, ctx)

    # Extract readable output for next observation
    if isinstance(result, dict):
        raw = result.get("answer") or result.get("output") or result.get("result") or ""
        if isinstance(raw, dict):
            raw = str(raw)
        output_text = str(raw).strip()[:400]
    else:
        output_text = str(result)[:400]

    observations.append({
        "step": step_count,
        "thought": thought,
        "tool": tool,
        "argument": arg,
        "output": output_text,
    })

    # Write intermediate step to short-term memory if configured
    memory_cfg = ctx.get("memory") or {}
    short_term_cfg = ((memory_cfg.get("write_policies") or {}).get("short_term") or {})
    if short_term_cfg.get("write_intermediate_steps", False):
        try:
            store = get_backend(memory_cfg)
            thread_id = ctx.get("thread_id", "")
            tenant_id = ctx.get("tenant_id", "default")
            if thread_id:
                store.append_raw_turn(
                    tenant_id=tenant_id,
                    thread_id=thread_id,
                    role="system",
                    content=(
                        f"[ReAct Step {step_count}] "
                        f"Thought: {thought} | "
                        f"Action: {tool}({arg[:100]}) | "
                        f"Observation: {output_text}"
                    ),
                    metadata={
                        "memory_type": "short_term",
                        "step_type": "react_intermediate",
                        "step": step_count,
                        "tool": tool,
                    },
                )
        except Exception as e:
            print(f"[react] intermediate step write failed (non-fatal): {e}", flush=True)

    is_approval = isinstance(result, dict) and result.get("result") == "APPROVAL_REQUIRED"

    router_trace = {}
    executor_trace = {}
    if isinstance(result, dict):
        router_trace = {"tool": tool, "resolved_input": arg, "mode": result.get("mode", "")}
        executor_trace = {
            "tool": tool,
            "status": "approval_required" if is_approval else "success",
            "mode": result.get("mode", ""),
            "output_snippet": output_text[:120],
        }

    return {
        "step_count": step_count,
        "observations": observations,
        "result": result,
        "router_trace": router_trace,
        "executor_trace": executor_trace,
    }


def _should_continue(state: GraphState) -> str:
    tool = state.get("current_tool", "")
    step_count = state.get("step_count", 0)
    max_steps = state.get("max_steps", _DEFAULT_MAX_STEPS)
    result = state.get("result")

    # Stop conditions
    if tool == _DONE:
        return "end"
    if isinstance(result, dict) and result.get("result") == "APPROVAL_REQUIRED":
        return "end"
    if step_count >= max_steps:
        print(f"[react] max_steps={max_steps} reached, stopping", flush=True)
        return "chat_responder"

    return "react_planner"


def _chat_responder(state: GraphState) -> GraphState:
    """Only called when max_steps hit without DONE — synthesize from observations."""
    from overlays.chat_agent_simple.agents.chat_responder import build_chat_answer

    # If answer already set (DONE path), pass through
    if state.get("answer"):
        return {}

    observations = state.get("observations") or []
    obs_text = _format_observations(observations)
    result = state.get("result")

    # Augment result with all observations for the responder
    augmented_result = {
        **(result if isinstance(result, dict) else {}),
        "react_observations": obs_text,
    }

    answer = build_chat_answer(
        prompt=state.get("prompt", "") or "",
        history=state.get("history") or [],
        result=augmented_result,
    )
    return {"answer": answer}


def _init_state(state: GraphState) -> GraphState:
    """Set max_steps from config on entry."""
    ctx = state.get("ctx") or {}
    reasoning = ctx.get("reasoning") or {}
    max_steps = int(reasoning.get("max_steps") or _DEFAULT_MAX_STEPS)
    return {"step_count": 0, "observations": [], "max_steps": max_steps}


def build_graph(checkpointer: Optional[object] = None):
    g = StateGraph(GraphState)

    g.add_node("init", _init_state)
    g.add_node("react_planner", _react_planner)
    g.add_node("executor", _executor)
    g.add_node("chat_responder", _chat_responder)

    g.add_edge(START, "init")
    g.add_edge("init", "react_planner")
    g.add_edge("react_planner", "executor")

    g.add_conditional_edges(
        "executor",
        _should_continue,
        {
            "react_planner": "react_planner",
            "chat_responder": "chat_responder",
            "end": END,
        },
    )

    g.add_edge("chat_responder", END)

    if checkpointer is None:
        return g.compile()
    return g.compile(checkpointer=checkpointer)
