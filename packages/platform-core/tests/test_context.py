"""Tests for build_context — covers A17 (tenant_id silently dropped when nested under 'ctx').

Backstory: the response shape is `{"answer": ..., "ctx": {"tenant_id": ...}}` but
build_context originally only read top-level payload keys. Callers reading the
response and reusing the same shape for the next request had their tenant_id
silently dropped, causing memory writes to land in `default-tenant` and
multi-turn continuity to break.

Fix: accept both shapes — top-level wins if present, nested under 'ctx' as fallback.
"""
from __future__ import annotations

from typing import Any, Dict

import pytest


class _FakeRequest:
    """Minimal stand-in for fastapi.Request — only `.headers` is read."""
    def __init__(self, headers: Dict[str, str] | None = None) -> None:
        self.headers = headers or {}


# ── A17 regression: nested ctx must be read ──────────────────────────────────

def test_tenant_id_read_from_nested_ctx_when_top_level_absent():
    """A17 bug: when caller mirrors the response shape, tenant_id was silently
    dropped because build_context only checked top-level payload."""
    from platform_core.context import build_context

    payload = {
        "prompt": "remember my name is Sam",
        "ctx": {"tenant_id": "a17-test", "thread_id": "a17-thread", "user_id": "u-1"},
    }
    ctx = build_context(_FakeRequest(), payload)

    assert ctx["tenant_id"] == "a17-test"
    assert ctx["thread_id"] == "a17-thread"
    assert ctx["user_id"] == "u-1"


def test_top_level_wins_over_nested_ctx():
    """If both top-level and nested are present, top-level wins (backwards compat)."""
    from platform_core.context import build_context

    payload = {
        "prompt": "x",
        "tenant_id": "top-level-tenant",
        "ctx": {"tenant_id": "nested-tenant"},
    }
    ctx = build_context(_FakeRequest(), payload)
    assert ctx["tenant_id"] == "top-level-tenant"


def test_header_wins_over_payload():
    """Headers always win — that's the documented identity propagation contract."""
    from platform_core.context import build_context

    req = _FakeRequest(headers={"X-Tenant-Id": "header-tenant"})
    payload = {"tenant_id": "payload-tenant", "ctx": {"tenant_id": "nested"}}
    ctx = build_context(req, payload)
    assert ctx["tenant_id"] == "header-tenant"


def test_scope_ids_also_read_from_nested_ctx():
    """member_id, case_id, assessment_id should follow the same fallback rule."""
    from platform_core.context import build_context

    payload = {
        "prompt": "x",
        "ctx": {
            "tenant_id": "t1",
            "member_id": "m-001",
            "case_id": "case-001",
            "assessment_id": "asmt-001",
        },
    }
    ctx = build_context(_FakeRequest(), payload)

    assert ctx["member_id"] == "m-001"
    assert ctx["case_id"] == "case-001"
    assert ctx["assessment_id"] == "asmt-001"


def test_memory_policy_override_read_from_nested_ctx():
    """memory_policy_override is sent by the UI inside ctx in the response shape;
    must be readable from there too."""
    from platform_core.context import build_context

    payload = {
        "prompt": "x",
        "ctx": {
            "tenant_id": "t1",
            "memory_policy_override": {"episodic": False, "semantic": True},
        },
    }
    ctx = build_context(_FakeRequest(), payload)

    assert ctx["memory_policy_override"] == {"episodic": False, "semantic": True}


def test_empty_payload_returns_empty_strings_not_default_strings():
    """Don't substitute 'default-tenant' here — that's langgraph_runner's job
    (so callers can detect 'no value' vs 'default')."""
    from platform_core.context import build_context

    ctx = build_context(_FakeRequest(), {})
    assert ctx["tenant_id"] == ""
    assert ctx["thread_id"] == ""


def test_correlation_id_auto_generated_when_absent():
    """correlation_id should never be empty — auto-generate if not provided."""
    from platform_core.context import build_context

    ctx = build_context(_FakeRequest(), {})
    assert ctx["correlation_id"].startswith("corr-")
