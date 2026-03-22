from __future__ import annotations

import uuid
from typing import Any, Dict, Optional
from fastapi import Request


def _get_header(request: Request, name: str) -> Optional[str]:
    v = request.headers.get(name)
    return v.strip() if v else None


def _get_value(request: Request, payload: Dict[str, Any], header_name: str, payload_key: str) -> str:
    return _get_header(request, header_name) or str(payload.get(payload_key) or "")


def build_context(request: Request, payload: Dict[str, Any]) -> Dict[str, str]:

    tenant_id = _get_value(request, payload, "X-Tenant-Id", "tenant_id")
    user_id = _get_value(request, payload, "X-User-Id", "user_id")
    thread_id = _get_value(request, payload, "X-Thread-Id", "thread_id")

    member_id = _get_value(request, payload, "X-Member-Id", "member_id")
    case_id = _get_value(request, payload, "X-Case-Id", "case_id")

    # IMPORTANT — DO NOT force payload only
    assessment_id = _get_value(request, payload, "X-Assessment-Id", "assessment_id")
    care_plan_id = _get_value(request, payload, "X-Care-Plan-Id", "care_plan_id")

    correlation_id = (
        _get_header(request, "X-Correlation-Id")
        or str(payload.get("correlation_id") or "")
        or f"corr-{uuid.uuid4()}"
    )

    return {
        "tenant_id": tenant_id,
        "user_id": user_id,
        "thread_id": thread_id,
        "member_id": member_id,
        "case_id": case_id,
        "assessment_id": assessment_id,
        "care_plan_id": care_plan_id,
        "correlation_id": correlation_id,
    }