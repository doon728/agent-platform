"""Tests for usecase_config_loader — covers today's master switch regression
where the new overlay layout hardcoded approval_required=False, disabling HITL.
"""
from __future__ import annotations

from pathlib import Path
from textwrap import dedent

import pytest
import yaml

from platform_core.usecase_config_loader import load_agent_config


def _write_overlay(root: Path, agent_type: str, *, hitl: dict | None = None,
                    overlay: dict | None = None, reasoning: dict | None = None,
                    tools: dict | None = None) -> None:
    """Write a minimal new-layout overlay tree under root/overlays/<agent_type>/."""
    overlay_dir = root / "overlays" / agent_type
    overlay_dir.mkdir(parents=True, exist_ok=True)
    (overlay_dir / "overlay.yaml").write_text(yaml.safe_dump(
        overlay or {"agent_type": agent_type, "agent_role": "chat_agent",
                    "planner_mode": "llm"}
    ))
    if hitl is not None:
        (overlay_dir / "hitl.yaml").write_text(yaml.safe_dump(hitl))
    if reasoning is not None:
        (overlay_dir / "reasoning.yaml").write_text(yaml.safe_dump(reasoning))
    if tools is not None:
        tools_dir = overlay_dir / "tools"
        tools_dir.mkdir(exist_ok=True)
        (tools_dir / "tools.yaml").write_text(yaml.safe_dump(tools))


@pytest.fixture
def platform_root(tmp_path, monkeypatch):
    """Point PLATFORM_ROOT at a temp dir for each test."""
    monkeypatch.setenv("PLATFORM_ROOT", str(tmp_path))
    # Reload module-level constant
    import platform_core.usecase_config_loader as mod
    monkeypatch.setattr(mod, "PLATFORM_ROOT", str(tmp_path))
    return tmp_path


# ── master switch derivation (today's #1 regression) ─────────────────────────

def test_approval_required_true_when_high_risk_rule_requires_approval(platform_root):
    """If any routing rule has requires_approval=true, master switch must be on.

    Regression test for the bug where approval_required was hardcoded False in
    the new overlay layout, short-circuiting all HITL gating.
    """
    _write_overlay(platform_root, "chat_agent_simple", hitl={
        "adapter": "internal",
        "risk_levels": {"write_case_note": "high"},
        "routing_rules": [
            {"risk_level": "high", "requires_approval": True},
            {"risk_level": "low", "requires_approval": False},
        ],
    })

    cfg = load_agent_config("chat_agent_simple")

    assert cfg["risk"]["approval_required"] is True
    assert cfg["risk"]["risk_levels"]["write_case_note"] == "high"


def test_approval_required_false_when_no_rule_requires_approval(platform_root):
    """Inverse: if all rules have requires_approval=false, master switch off."""
    _write_overlay(platform_root, "chat_agent_simple", hitl={
        "adapter": "internal",
        "risk_levels": {"search_kb": "low"},
        "routing_rules": [
            {"risk_level": "low", "requires_approval": False},
        ],
    })

    cfg = load_agent_config("chat_agent_simple")

    assert cfg["risk"]["approval_required"] is False


def test_approval_required_false_when_hitl_yaml_missing(platform_root):
    """No hitl.yaml at all — master switch must default to off, not crash."""
    _write_overlay(platform_root, "chat_agent_simple")  # no hitl arg

    cfg = load_agent_config("chat_agent_simple")

    assert cfg["risk"]["approval_required"] is False
    assert cfg["risk"]["risk_levels"] == {}


def test_routing_rules_passed_through_to_hitl_block(platform_root):
    """Routing rules must reach ctx.usecase_config.hitl.routing_rules — that's
    where executor._requires_approval() reads them from."""
    rules = [
        {"risk_level": "high", "requires_approval": True},
        {"risk_level": "medium", "requires_approval": True},
        {"risk_level": "low", "requires_approval": False},
    ]
    _write_overlay(platform_root, "chat_agent_simple", hitl={
        "adapter": "internal",
        "risk_levels": {"write_case_note": "high"},
        "routing_rules": rules,
    })

    cfg = load_agent_config("chat_agent_simple")

    assert cfg["hitl"]["routing_rules"] == rules
    assert cfg["hitl"]["adapter"] == "internal"


# ── shape contract: downstream consumers depend on these keys ─────────────────

def test_returned_config_has_all_required_top_level_keys(platform_root):
    """Downstream (executor, planner, memory, etc.) reads these keys.
    Removing or renaming any of them is a breaking change."""
    _write_overlay(platform_root, "chat_agent_simple")

    cfg = load_agent_config("chat_agent_simple")

    expected_keys = {
        "usecase", "agent", "tool_policy", "retrieval", "risk", "hitl",
        "features", "prompts", "memory", "workflow_rules", "domain",
        "hard_routes", "reasoning",
    }
    assert expected_keys.issubset(cfg.keys()), \
        f"Missing keys: {expected_keys - cfg.keys()}"


def test_reasoning_defaults_to_simple_when_no_reasoning_yaml(platform_root):
    """Strategy must default to 'simple' if reasoning.yaml is absent."""
    _write_overlay(platform_root, "chat_agent_simple")

    cfg = load_agent_config("chat_agent_simple")

    assert cfg["reasoning"]["strategy"] == "simple"
