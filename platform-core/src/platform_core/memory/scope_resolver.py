from __future__ import annotations

from typing import Any, Dict, List

_PLATFORM_ID_KEYS = {"tenant_id", "user_id", "thread_id", "correlation_id", "run_id"}


def resolve_scopes(ctx: Dict[str, Any], memory_cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    if not memory_cfg.get("enabled", False):
        return []

    scopes: List[Dict[str, Any]] = []

    thread_id = ctx.get("thread_id")
    user_id = ctx.get("user_id")

    if thread_id:
        scopes.append({"scope_type": "conversation", "scope_id": str(thread_id)})

    if user_id:
        scopes.append({"scope_type": "user", "scope_id": str(user_id)})

    # Dynamic domain scopes — driven by domain.yaml scopes[] in ctx
    domain = ctx.get("domain") or {}
    domain_scopes = domain.get("scopes") or []

    if domain_scopes:
        for scope_def in domain_scopes:
            id_field = scope_def.get("id_field") or ""
            scope_name = scope_def.get("name") or ""
            if id_field and scope_name:
                val = ctx.get(id_field)
                if val:
                    scopes.append({"scope_type": scope_name, "scope_id": str(val)})
    else:
        # Fallback: infer scopes from any *_id keys present in ctx
        for key, val in ctx.items():
            if key.endswith("_id") and key not in _PLATFORM_ID_KEYS and val:
                scopes.append({"scope_type": key[:-3], "scope_id": str(val)})

    return scopes
