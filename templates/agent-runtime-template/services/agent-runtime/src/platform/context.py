# services/agent-runtime/src/platform/context.py
from __future__ import annotations

import uuid
from typing import Any, Dict, Optional

from fastapi import Request


def _get_header(request: Request, name: str) -> Optional[str]:
    v = request.headers.get(name)
    return v.strip() if v else None


def build_context(request: Request, payload: Dict[str, Any]) -> Dict[str, str]:
    """
    Build a normalized identity/tracing context for every invocation.
    Precedence: headers > payload > generated.
    """
    tenant_id = _get_header(request, "X-Tenant-Id") or str(payload.get("tenant_id") or "")
    user_id = _get_header(request, "X-User-Id") or str(payload.get("user_id") or "")
    thread_id = _get_header(request, "X-Thread-Id") or str(payload.get("thread_id") or "")

    correlation_id = (
        _get_header(request, "X-Correlation-Id")
        or str(payload.get("correlation_id") or "")
        or f"corr-{uuid.uuid4()}"
    )

    # Normalize empty strings to None-like behavior (but keep as strings)
    return {
        "tenant_id": tenant_id,
        "user_id": user_id,
        "thread_id": thread_id,
        "correlation_id": correlation_id,
    }