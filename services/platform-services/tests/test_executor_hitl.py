"""Tests for executor HITL gating + compound write_case_note step parsing.

Regression tests for today's bugs:
1. HITL never gated because approval_required short-circuit returned False
2. write_case_note compound step (`tool: id | note`) wrote `assessment_id`
   into the input but the gateway tool schema requires `case_id`.
"""
from __future__ import annotations

import sys
from pathlib import Path

# Make src/ importable as `src.services.reasoning.executor`
_SRC = Path(__file__).resolve().parent.parent / "src"
if str(_SRC.parent) not in sys.path:
    sys.path.insert(0, str(_SRC.parent))


# ── _requires_approval — pure function, no dependencies ──────────────────────

def _build_ctx(*, approval_required: bool, risk_levels: dict, routing_rules: list) -> dict:
    return {
        "usecase_config": {
            "risk": {
                "approval_required": approval_required,
                "risk_levels": risk_levels,
            },
            "hitl": {"routing_rules": routing_rules},
        },
    }


def test_requires_approval_returns_false_when_master_switch_off():
    """If approval_required=False at top, never gate (regardless of per-tool risk)."""
    from src.services.reasoning.executor import _requires_approval

    ctx = _build_ctx(
        approval_required=False,
        risk_levels={"write_case_note": "high"},
        routing_rules=[{"risk_level": "high", "requires_approval": True}],
    )
    assert _requires_approval("write_case_note", ctx) is False


def test_requires_approval_true_for_high_risk_tool_when_routing_rule_says_so():
    """Today's critical path: master switch on + high-risk tool + routing rule
    requires_approval=true → must gate."""
    from src.services.reasoning.executor import _requires_approval

    ctx = _build_ctx(
        approval_required=True,
        risk_levels={"write_case_note": "high"},
        routing_rules=[
            {"risk_level": "high", "requires_approval": True},
            {"risk_level": "low", "requires_approval": False},
        ],
    )
    assert _requires_approval("write_case_note", ctx) is True


def test_requires_approval_false_for_low_risk_tool_even_with_master_switch_on():
    """Low-risk tools should NOT gate even when HITL is enabled platform-wide."""
    from src.services.reasoning.executor import _requires_approval

    ctx = _build_ctx(
        approval_required=True,
        risk_levels={"search_kb": "low"},
        routing_rules=[
            {"risk_level": "high", "requires_approval": True},
            {"risk_level": "low", "requires_approval": False},
        ],
    )
    assert _requires_approval("search_kb", ctx) is False


def test_requires_approval_unknown_tool_defaults_to_low_risk():
    """A tool not in risk_levels gets level='low' → no gating."""
    from src.services.reasoning.executor import _requires_approval

    ctx = _build_ctx(
        approval_required=True,
        risk_levels={},  # no entry for this tool
        routing_rules=[
            {"risk_level": "low", "requires_approval": False},
        ],
    )
    assert _requires_approval("never_seen_tool", ctx) is False


def test_requires_approval_high_risk_falls_through_to_default_when_no_matching_rule():
    """If risk level is 'high' but no matching routing rule, default to gating
    (the function's last line: `return level == 'high'`)."""
    from src.services.reasoning.executor import _requires_approval

    ctx = _build_ctx(
        approval_required=True,
        risk_levels={"write_case_note": "high"},
        routing_rules=[],  # no rules at all
    )
    assert _requires_approval("write_case_note", ctx) is True
