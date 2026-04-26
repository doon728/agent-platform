"""Tests for the Cedar policy compiler stub."""

from pathlib import Path

import pytest

from src.policy.cedar_compiler import (
    CedarCompileError,
    compile_bundle,
    compile_policy,
    write_bundle,
)


def test_compile_minimal_permit_policy() -> None:
    decl = {
        "name": "um_can_call_jira",
        "principal": "Agent::um_pre_call",
        "action": "Action::call_tool",
        "resource": "Tool::jira/get_issue",
        "effect": "permit",
    }
    policy = compile_policy(decl)
    assert policy.name == "um_can_call_jira"
    assert "permit" in policy.cedar_text
    assert "Agent::um_pre_call" in policy.cedar_text
    assert "Tool::jira/get_issue" in policy.cedar_text
    assert policy.metadata["stub"] is True


def test_compile_with_when_clauses() -> None:
    decl = {
        "name": "scoped_member_lookup",
        "principal": "Agent::cm_chat",
        "action": "Action::call_tool",
        "resource": "Tool::get_member",
        "effect": "permit",
        "when": ['principal.lob == "care-management"', "context.confidence >= 0.7"],
    }
    policy = compile_policy(decl)
    assert "when {" in policy.cedar_text
    assert 'principal.lob == "care-management"' in policy.cedar_text
    assert "context.confidence >= 0.7" in policy.cedar_text


def test_compile_forbid_effect() -> None:
    decl = {
        "name": "no_phi_export",
        "principal": "Agent::*",
        "action": "Action::call_tool",
        "resource": "Tool::export_phi",
        "effect": "forbid",
    }
    policy = compile_policy(decl)
    assert policy.cedar_text.strip().startswith("// Compiled from")
    assert "forbid (" in policy.cedar_text


def test_invalid_effect_raises() -> None:
    decl = {
        "name": "bad",
        "principal": "Agent::x",
        "action": "Action::call_tool",
        "resource": "Tool::y",
        "effect": "maybe",
    }
    with pytest.raises(CedarCompileError, match="effect must be"):
        compile_policy(decl)


def test_missing_required_field_raises() -> None:
    decl = {"name": "incomplete", "effect": "permit"}
    with pytest.raises(CedarCompileError, match="missing required fields"):
        compile_policy(decl)


def test_compile_bundle_returns_list() -> None:
    decls = [
        {
            "name": f"p{i}",
            "principal": f"Agent::a{i}",
            "action": "Action::call_tool",
            "resource": f"Tool::t{i}",
            "effect": "permit",
        }
        for i in range(3)
    ]
    bundle = compile_bundle(decls)
    assert len(bundle) == 3
    assert {p.name for p in bundle} == {"p0", "p1", "p2"}


def test_write_bundle_creates_files(tmp_path: Path) -> None:
    decl = {
        "name": "write_test",
        "principal": "Agent::x",
        "action": "Action::y",
        "resource": "Tool::z",
        "effect": "permit",
    }
    policy = compile_policy(decl)
    manifest = write_bundle([policy], tmp_path / "out")

    assert manifest.exists()
    assert (tmp_path / "out" / "write_test.cedar").exists()
    assert "write_test" in manifest.read_text()
