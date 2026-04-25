from __future__ import annotations

from typing import Any, Dict, List
import os
import requests

TOOL_GATEWAY_URL = os.getenv("TOOL_GATEWAY_URL", "http://host.docker.internal:8080")
CONTRACT_VERSION = "v1"


def _invoke(tool_name: str, tool_input: Dict[str, Any], ctx: Dict[str, Any]) -> Dict[str, Any]:
    payload = {
        "contract_version": CONTRACT_VERSION,
        "tool_name": tool_name,
        "input": tool_input,
        "tenant_id": ctx.get("tenant_id"),
        "user_id": ctx.get("user_id"),
        "correlation_id": ctx.get("correlation_id"),
    }

    headers = {"Content-Type": "application/json"}
    if ctx.get("tenant_id"):
        headers["x-tenant-id"] = str(ctx["tenant_id"])
    if ctx.get("user_id"):
        headers["x-user-id"] = str(ctx["user_id"])
    if ctx.get("correlation_id"):
        headers["x-correlation-id"] = str(ctx["correlation_id"])

    r = requests.post(f"{TOOL_GATEWAY_URL}/tools/invoke", json=payload, headers=headers, timeout=10)
    r.raise_for_status()
    resp = r.json()

    if not resp.get("ok", False):
        err = resp.get("error") or {}
        raise RuntimeError(f"TOOL_GATEWAY_ERROR {tool_name}: {err.get('code')} {err.get('message')}")

    return resp.get("output") or {}


def search_kb(
    query: str,
    ctx: Dict[str, Any],
    top_k: int | None = None,
    threshold: float | None = None,
    strategy: str | None = None,
    config_key: str = "planner_tool",  # "planner_tool" or "pre_graph"
) -> List[Dict[str, Any]]:
    retrieval_cfg = ((ctx or {}).get("usecase_config") or {}).get("retrieval") or {}
    # Read from the specific stage config (planner_tool or pre_graph), fall back to root
    stage_cfg = retrieval_cfg.get(config_key) or {}
    payload = {
        "query": query,
        "top_k": top_k if top_k is not None else stage_cfg.get("top_k") or retrieval_cfg.get("top_k"),
        "threshold": threshold if threshold is not None else stage_cfg.get("similarity_threshold") or retrieval_cfg.get("similarity_threshold"),
        "strategy": strategy if strategy is not None else stage_cfg.get("strategy") or retrieval_cfg.get("strategy", "semantic"),
    }
    out = _invoke("search_kb", payload, ctx)
    return out.get("results", [])


def get_member(member_id: str, ctx: Dict[str, Any]) -> Dict[str, Any]:
    return _invoke("get_member", {"member_id": member_id}, ctx)


def write_case_note(case_id: str, note: str, ctx: Dict[str, Any]) -> Dict[str, Any]:
    return _invoke("write_case_note", {"case_id": case_id, "note": note}, ctx)