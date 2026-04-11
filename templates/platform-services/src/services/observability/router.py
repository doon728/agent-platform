from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from platform_core.observability.tracer import list_traces

router = APIRouter()


@router.get("/traces")
def get_traces() -> JSONResponse:
    return JSONResponse({"ok": True, "traces": list_traces()})


@router.get("/traces/latest")
def get_latest_trace() -> JSONResponse:
    traces = list_traces()
    return JSONResponse({"ok": True, "trace": traces[0] if traces else None})
