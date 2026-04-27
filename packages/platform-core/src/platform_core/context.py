from __future__ import annotations

import os
import uuid
import yaml
from typing import Any, Dict, Optional
from fastapi import Request

PLATFORM_ROOT = os.getenv("PLATFORM_ROOT", "/app")


def _get_header(request: Request, name: str) -> Optional[str]:
    v = request.headers.get(name)
    return v.strip() if v else None


def _get_value(request: Request, payload: Dict[str, Any], header_name: str, payload_key: str) -> str:
    """Resolution order: header → top-level payload key → nested under payload['ctx'].

    Nested ctx fallback exists because the system's response shape is
    `{"answer": ..., "ctx": {"tenant_id": ...}}` — external callers reading the
    response and reusing the same shape for the next request would otherwise
    have their tenant/thread IDs silently dropped (writes land in default-tenant).
    """
    header_val = _get_header(request, header_name)
    if header_val:
        return header_val
    top_level = payload.get(payload_key)
    if top_level:
        return str(top_level)
    nested = (payload.get("ctx") or {}).get(payload_key)
    if nested:
        return str(nested)
    return ""


def _load_domain_scopes() -> list:
    """Read scope definitions from domain.yaml baked into the image."""
    domain_path = os.path.join(PLATFORM_ROOT, "domain.yaml")
    if not os.path.exists(domain_path):
        return []
    try:
        with open(domain_path) as f:
            data = yaml.safe_load(f) or {}
        return data.get("scopes") or []
    except Exception:
        return []


def build_context(request: Request, payload: Dict[str, Any]) -> Dict[str, str]:
    tenant_id = _get_value(request, payload, "X-Tenant-Id", "tenant_id")
    user_id = _get_value(request, payload, "X-User-Id", "user_id")
    thread_id = _get_value(request, payload, "X-Thread-Id", "thread_id")

    correlation_id = (
        _get_header(request, "X-Correlation-Id")
        or str(payload.get("correlation_id") or "")
        or f"corr-{uuid.uuid4()}"
    )

    nested_ctx = payload.get("ctx") or {}
    ctx: Dict[str, Any] = {
        "tenant_id": tenant_id,
        "user_id": user_id,
        "thread_id": thread_id,
        "correlation_id": correlation_id,
        "memory_policy_override": (
            payload.get("memory_policy_override")
            or nested_ctx.get("memory_policy_override")
            or {}
        ),
        "hitl_override": (
            payload.get("hitl_override")
            or nested_ctx.get("hitl_override")
            or {}
        ),
    }

    # Dynamically resolve scope ID fields from domain.yaml
    scopes = _load_domain_scopes()
    if scopes:
        for scope in scopes:
            id_field = scope.get("id_field") or ""
            if not id_field:
                continue
            header_name = "X-" + "-".join(w.capitalize() for w in id_field.split("_"))
            ctx[id_field] = _get_value(request, payload, header_name, id_field)
    else:
        # Fallback: keep original hardcoded fields so existing agents don't break
        ctx["member_id"] = _get_value(request, payload, "X-Member-Id", "member_id")
        ctx["case_id"] = _get_value(request, payload, "X-Case-Id", "case_id")
        ctx["assessment_id"] = _get_value(request, payload, "X-Assessment-Id", "assessment_id")
        ctx["care_plan_id"] = _get_value(request, payload, "X-Care-Plan-Id", "care_plan_id")

    return ctx
