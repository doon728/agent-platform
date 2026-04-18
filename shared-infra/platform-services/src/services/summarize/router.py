from __future__ import annotations

# /summarize — scoped summary endpoint (C2 platform-services).
#
# Given a scope_type (member | case | assessment) and matching scope IDs,
# calls the summary_tools defined in domain.yaml for that scope in parallel,
# then synthesises the combined output into a structured summary via LLM.
#
# The result shape:
#   { summary, key_concerns, last_action, next_steps, scope_type, scope_id }
#
# Caches result as "summary_cache" memory so the panel reload is instant.

import json
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from platform_core.config import load_config
from platform_core.tools.registry import registry

router = APIRouter()

# Bootstrap tools on import (idempotent — registry.register overwrites)
try:
    from platform_core.tools.bootstrap import register_tools
    from platform_core.tools.discovery import load_tools_from_gateway
    register_tools()
    load_tools_from_gateway()
except Exception as _e:
    print(f"[summarize/router] tool bootstrap warning: {_e}", flush=True)


# ── Config ────────────────────────────────────────────────────────────────────

DOMAIN_PATH = os.getenv("DOMAIN_YAML_PATH", "/app/domain.yaml")

_SYSTEM_PROMPT = """You are a clinical care management assistant.
You will receive raw output from one or more data-fetch tools for a specific member/case/assessment.
Produce a structured JSON summary with exactly these keys:
  summary      — 1-3 sentence clinical snapshot
  key_concerns — list of 2-5 short strings (most important risks/flags)
  last_action  — single string describing the most recent documented action, or "None"
  next_steps   — list of 1-3 short strings describing recommended next steps

Reply with ONLY valid JSON. No markdown, no explanation."""


def _load_domain() -> dict:
    import yaml
    try:
        with open(DOMAIN_PATH) as f:
            return yaml.safe_load(f) or {}
    except Exception:
        return {}


def _summary_tools_for_scope(domain: dict, scope_type: str) -> List[Dict]:
    """Return list of {tool, arg_field} dicts for the given scope type."""
    for scope in (domain.get("scopes") or []):
        if scope.get("name") == scope_type:
            return scope.get("summary_tools") or []
    return []


def _call_tool(tool_name: str, arg_field: str, arg_value: str, ctx: dict) -> Any:
    """Call a single tool with {arg_field: arg_value}; returns the raw result or an error string."""
    try:
        tool_input = {arg_field: arg_value} if arg_field and arg_value else {}
        return registry.invoke_approved(tool_name, tool_input, ctx)
    except Exception as e:
        return f"[tool error: {e}]"


def _run_tools_parallel(tool_specs: List[Dict], ctx: dict) -> Dict[str, Any]:
    """Call all summary tools concurrently; returns {tool_name: result}."""
    results: Dict[str, Any] = {}
    with ThreadPoolExecutor(max_workers=len(tool_specs) or 1) as pool:
        future_to_name = {}
        for spec in tool_specs:
            tool_name = spec["tool"]
            arg_field = spec.get("arg_field", "")
            arg_value = ctx.get(arg_field) or ""
            future = pool.submit(_call_tool, tool_name, arg_field, arg_value, ctx)
            future_to_name[future] = tool_name
        for future in as_completed(future_to_name):
            results[future_to_name[future]] = future.result()
    return results


def _synthesise(tool_results: Dict[str, Any], scope_type: str, scope_id: str) -> dict:
    """LLM call — combine raw tool outputs into structured summary JSON."""
    model_name = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    api_key = os.getenv("OPENAI_API_KEY", "")
    llm = ChatOpenAI(model=model_name, temperature=0, api_key=api_key)

    tool_block = "\n\n".join(
        f"=== {name} ===\n{json.dumps(result, default=str) if isinstance(result, (dict, list)) else str(result)}"
        for name, result in tool_results.items()
    )

    human = HumanMessage(content=(
        f"Scope: {scope_type} / {scope_id}\n\n"
        f"Tool outputs:\n{tool_block}\n\n"
        "Produce the JSON summary."
    ))

    resp = llm.invoke([SystemMessage(content=_SYSTEM_PROMPT), human])
    raw = resp.content.strip()
    # strip markdown fences if present
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    try:
        return json.loads(raw)
    except Exception:
        return {
            "summary": raw,
            "key_concerns": [],
            "last_action": "None",
            "next_steps": [],
        }


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("")
async def summarize(payload: dict) -> JSONResponse:
    """
    Build a scoped summary.

    Accepts a flat payload (from the care-management UI) OR a nested ctx dict:
      scope_type    : "member" | "case" | "assessment"
      scope_id      : the ID value for that scope
      tenant_id     : optional, defaults to "t1"
      member_id     : optional — injected into ctx so tools can use it
      force_refresh : ignored for now (cache TTL not yet implemented)
      ctx           : optional nested dict; merged with top-level fields
    """
    scope_type = (payload.get("scope_type") or "").strip()
    scope_id = (payload.get("scope_id") or "").strip()

    # Support both flat payload (UI) and nested ctx (internal calls)
    ctx = dict(payload.get("ctx") or {})
    for key in ("tenant_id", "member_id", "case_id", "assessment_id", "thread_id"):
        if payload.get(key) and not ctx.get(key):
            ctx[key] = payload[key]

    if not scope_type or not scope_id:
        return JSONResponse(
            status_code=400,
            content={"ok": False, "error": "scope_type and scope_id required"},
        )

    domain = _load_domain()
    tool_specs = _summary_tools_for_scope(domain, scope_type)

    if not tool_specs:
        return JSONResponse(
            status_code=422,
            content={
                "ok": False,
                "error": f"No summary_tools configured for scope '{scope_type}' in domain.yaml",
            },
        )

    # Inject the scope id into ctx under the canonical field name
    for scope in (domain.get("scopes") or []):
        if scope.get("name") == scope_type:
            id_field = scope.get("id_field") or ""
            if id_field and not ctx.get(id_field):
                ctx[id_field] = scope_id
            break

    tool_results = _run_tools_parallel(tool_specs, ctx)
    structured = _synthesise(tool_results, scope_type, scope_id)

    # Write to summary_cache memory (non-fatal if it fails)
    try:
        from platform_core.memory.backend_factory import get_backend
        cfg = load_config()
        mem_cfg = cfg.app.__dict__ if hasattr(cfg.app, "__dict__") else {}
        store = get_backend(mem_cfg)
        tenant_id = ctx.get("tenant_id") or "default"
        cache_key = f"summary_cache:{scope_type}:{scope_id}"
        store.write(
            tenant_id=tenant_id,
            thread_id=ctx.get("thread_id") or "global",
            key=cache_key,
            value=structured,
            metadata={"type": "summary_cache", "scope_type": scope_type, "scope_id": scope_id},
        )
    except Exception as e:
        print(f"[summarize] memory cache write failed (non-fatal): {e}", flush=True)

    generated_at = datetime.now(timezone.utc).isoformat()

    return JSONResponse({
        "ok": True,
        "cached": False,
        "generated_at": generated_at,
        "scope_type": scope_type,
        "scope_id": scope_id,
        **structured,
    })
