from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from platform_core.usecase_config_loader import load_agent_config, load_domain_config

router = APIRouter()


@router.get("/agent/{agent_type}")
def get_agent_config(agent_type: str) -> JSONResponse:
    """Return the merged agent config for a given agent type."""
    cfg = load_agent_config(agent_type)
    return JSONResponse({"ok": True, "config": cfg})


@router.get("/domain")
def get_domain_config() -> JSONResponse:
    """Return domain.yaml scope definitions."""
    domain = load_domain_config()
    return JSONResponse({"ok": True, "domain": domain})
