"""Tests for simple reasoning strategy — graph wiring + routing decisions.

Covers the parts that don't require an LLM call:
  - _match_hard_route — pure string matching against ctx.hard_routes
  - _after_hard_route_check — conditional edge after hard-route node
  - _after_executor — conditional edge that ends the graph on HITL
"""
from __future__ import annotations


# ── _match_hard_route — pure string matching ──────────────────────────────────

def test_match_hard_route_returns_match_when_trigger_phrase_present():
    from src.services.reasoning.strategies.simple import _match_hard_route

    routes = [
        {"trigger": "open assessment", "tool": "get_assessment_summary"},
        {"trigger": "show notes", "tool": "get_assessment_summary"},
    ]
    matched = _match_hard_route("Please open assessment for this member", routes)
    assert matched is not None
    assert matched["tool"] == "get_assessment_summary"


def test_match_hard_route_returns_none_when_no_trigger_matches():
    from src.services.reasoning.strategies.simple import _match_hard_route

    routes = [{"trigger": "show notes", "tool": "get_assessment_summary"}]
    assert _match_hard_route("what is the diagnosis", routes) is None


def test_match_hard_route_is_case_insensitive():
    from src.services.reasoning.strategies.simple import _match_hard_route

    routes = [{"trigger": "open assessment", "tool": "x"}]
    assert _match_hard_route("OPEN ASSESSMENT now", routes) is not None


def test_match_hard_route_handles_empty_routes_list():
    from src.services.reasoning.strategies.simple import _match_hard_route

    assert _match_hard_route("anything", []) is None
    assert _match_hard_route("anything", None) is None


# ── _after_hard_route_check — conditional graph edge ─────────────────────────

def test_after_hard_route_check_routes_to_executor_when_matched():
    from src.services.reasoning.strategies.simple import _after_hard_route_check

    state = {"hard_route_matched": True}
    assert _after_hard_route_check(state) == "executor"


def test_after_hard_route_check_routes_to_planner_when_not_matched():
    from src.services.reasoning.strategies.simple import _after_hard_route_check

    state = {"hard_route_matched": False}
    assert _after_hard_route_check(state) == "planner"


# ── _after_executor — must end graph when HITL needed ─────────────────────────

def test_after_executor_ends_graph_when_NEEDS_HITL():
    """When executor returns NEEDS_HITL, graph must end (not run responder).
    Today's HITL fix depends on this: responder would otherwise hallucinate."""
    from src.services.reasoning.strategies.simple import _after_executor

    state = {"result": {"result": "NEEDS_HITL", "tool_name": "write_case_note"}}
    assert _after_executor(state) == "end"


def test_after_executor_ends_graph_when_APPROVAL_REQUIRED():
    """Same path for the APPROVAL_REQUIRED variant returned by container 1."""
    from src.services.reasoning.strategies.simple import _after_executor

    state = {"result": {"result": "APPROVAL_REQUIRED"}}
    assert _after_executor(state) == "end"


def test_after_executor_routes_to_responder_for_normal_result():
    from src.services.reasoning.strategies.simple import _after_executor

    state = {"result": {"result": "OK", "answer": "..."}}
    assert _after_executor(state) == "chat_responder"
