from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from platform_core.tools.registry import registry

router = APIRouter()


@router.get("/list")
def tools_list() -> JSONResponse:
    """Return all registered tool specs."""
    specs = registry.list_specs()
    return JSONResponse({
        "ok": True,
        "tools": [
            {
                "name": s.name,
                "description": s.description,
                "mode": s.mode,
                "tags": s.tags or [],
                "primary_arg": s.primary_arg,
            }
            for s in specs
        ],
    })


@router.post("/invoke")
async def tools_invoke(payload: dict) -> JSONResponse:
    """
    Invoke a registered tool by name.

    Input:
      tool_name  : str
      tool_input : dict
      ctx        : request context
      bypass_hitl: bool (default false)
    """
    tool_name = payload.get("tool_name") or ""
    tool_input = payload.get("tool_input") or {}
    ctx = payload.get("ctx") or {}
    bypass_hitl = bool(payload.get("bypass_hitl", False))

    if not tool_name:
        return JSONResponse(status_code=400, content={"ok": False, "error": "tool_name required"})

    try:
        if bypass_hitl:
            result = registry.invoke_approved(tool_name, tool_input, ctx)
        else:
            result = registry.invoke(tool_name, tool_input, ctx)
        return JSONResponse({"ok": True, "result": result})
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "error": str(e)})
