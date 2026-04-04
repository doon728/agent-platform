from __future__ import annotations

from typing import Any, Dict, List


def resolve_scopes(ctx: Dict[str, Any], memory_cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    if not memory_cfg.get("enabled", False):
        return []

    scopes: List[Dict[str, Any]] = []

    thread_id = ctx.get("thread_id")
    user_id = ctx.get("user_id")
    member_id = ctx.get("member_id")
    case_id = ctx.get("case_id")
    assessment_id = ctx.get("assessment_id")
    care_plan_id = ctx.get("care_plan_id")

    if thread_id:
        scopes.append({"scope_type": "conversation", "scope_id": str(thread_id)})

    if user_id:
        scopes.append({"scope_type": "user", "scope_id": str(user_id)})

    if member_id:
        scopes.append({"scope_type": "member", "scope_id": str(member_id)})

    if case_id:
        scopes.append({"scope_type": "case", "scope_id": str(case_id)})

    if assessment_id:
        scopes.append({"scope_type": "assessment", "scope_id": str(assessment_id)})

    if care_plan_id:
        scopes.append({"scope_type": "care_plan", "scope_id": str(care_plan_id)})

    return scopes