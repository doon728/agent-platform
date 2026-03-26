from __future__ import annotations

from typing import Any, Dict, TypedDict

from langgraph.graph import END, START, StateGraph

from overlays.summary_agent.agents.summarizer import fetch, summarize


class SummaryState(TypedDict, total=False):
    scope_type: str
    scope_id: str
    ctx: Dict[str, Any]
    fetch_results: Dict[str, Any]
    summary: Dict[str, Any]


def _fetch_node(state: SummaryState) -> SummaryState:
    results = fetch(
        scope_type=state.get("scope_type", "assessment"),
        scope_id=state.get("scope_id", ""),
        ctx=state.get("ctx") or {},
    )
    return {"fetch_results": results}


def _summarize_node(state: SummaryState) -> SummaryState:
    result = summarize(
        scope_type=state.get("scope_type", "assessment"),
        fetch_results=state.get("fetch_results") or {},
        ctx=state.get("ctx") or {},
    )
    return {"summary": result}


def build_graph():
    g = StateGraph(SummaryState)
    g.add_node("fetch", _fetch_node)
    g.add_node("summarize", _summarize_node)
    g.add_edge(START, "fetch")
    g.add_edge("fetch", "summarize")
    g.add_edge("summarize", END)
    return g.compile()
