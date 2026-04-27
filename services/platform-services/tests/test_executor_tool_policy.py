"""Tests for executor tool-policy enforcement (allow-list / tag-based).

Covers _invoke_tool's allow/deny logic — separate from HITL gating.
"""
from __future__ import annotations

import pytest


def test_selected_mode_blocks_tool_not_in_allow_list():
    """In 'selected' mode, only tools listed in allowed_tools may run."""
    from src.services.reasoning.executor import _invoke_tool

    ctx = {
        "tool_policy": {"mode": "selected", "allowed_tools": ["search_kb"]},
    }
    with pytest.raises(RuntimeError, match="not allowed"):
        _invoke_tool("write_case_note", {}, ctx, bypass_hitl=True)


def test_selected_mode_allows_tool_in_allow_list_until_handler_runs():
    """If tool IS in allow_list, _invoke_tool reaches the handler.

    We expect a different error here (registry miss / handler missing),
    NOT the 'not allowed' policy error — that proves we passed the gate.
    """
    from src.services.reasoning.executor import _invoke_tool

    ctx = {
        "tool_policy": {"mode": "selected", "allowed_tools": ["definitely_unknown_tool"]},
    }
    with pytest.raises(Exception) as exc_info:
        _invoke_tool("definitely_unknown_tool", {}, ctx, bypass_hitl=True)

    # Must NOT be the policy block error; should be downstream registry miss
    assert "not allowed" not in str(exc_info.value)


def test_selected_mode_with_no_allowed_tools_blocks_everything():
    """Empty allow-list = no tool can run."""
    from src.services.reasoning.executor import _invoke_tool

    ctx = {"tool_policy": {"mode": "selected", "allowed_tools": []}}
    with pytest.raises(RuntimeError, match="not allowed"):
        _invoke_tool("any_tool", {}, ctx, bypass_hitl=True)


def test_default_policy_mode_is_selected():
    """If tool_policy has no mode set, default to 'selected' (safe default).

    Relies on the executor's internal `mode = tool_policy.get("mode", "selected")`.
    """
    from src.services.reasoning.executor import _invoke_tool

    ctx = {"tool_policy": {}}  # no mode, no allow-list
    with pytest.raises(RuntimeError, match="not allowed"):
        _invoke_tool("any_tool", {}, ctx, bypass_hitl=True)
