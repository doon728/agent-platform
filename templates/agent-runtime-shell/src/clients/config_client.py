from __future__ import annotations

from typing import Any, Dict

from src.clients.base import get


def get_agent_config(agent_type: str) -> Dict[str, Any]:
    """Fetch the merged agent config from Container 2."""
    resp = get(f"/config/agent/{agent_type}")
    return resp.get("config") or {}


def get_domain_config() -> Dict[str, Any]:
    """Fetch domain.yaml scope definitions from Container 2."""
    resp = get("/config/domain")
    return resp.get("domain") or {}
