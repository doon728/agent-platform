from __future__ import annotations

from typing import Dict, Any

from platform_core.tools.registry import registry


def _resolve_primary_arg(primary_arg: str, tool_value: str, raw_prompt: str, ctx: Dict[str, Any]) -> str:
    """Resolve the primary argument for a tool call.

    Priority: explicit value from planner → active scope ID from ctx → raw prompt (for query-type args).
    """
    if primary_arg == "query":
        return tool_value or raw_prompt

    # For any scope ID argument: planner value takes precedence, then fall back to ctx
    value = tool_value or ctx.get(primary_arg) or ""
    if not value:
        raise RuntimeError(f"Missing {primary_arg} for tool call — not in planner output or ctx")
    return value


def route_step(step: str, ctx: Dict[str, Any], raw_prompt: str | None = None) -> Dict[str, Any]:
    step = (step or "").strip()
    raw_prompt = (raw_prompt or "").strip()

    if not step:
        return {"mode": "none"}

    if ":" not in step:
        return {
            "mode": "direct_tool",
            "tool": "search_kb",
            "input": {"query": raw_prompt or step},
        }

    tool_name, tool_value = step.split(":", 1)
    tool_name = tool_name.strip()
    tool_value = tool_value.strip()

    if tool_name == "direct_answer":
        return {"mode": "direct_tool", "tool": "direct_answer", "input": {"query": tool_value or raw_prompt}}

    # Generic path: look up tool spec, resolve primary arg, build input
    spec = registry.get_spec(tool_name)
    primary_arg = spec.primary_arg or "query"

    # Multi-arg tools: planner may pass "arg1 | arg2" — split and map to schema properties
    if "|" in tool_value and spec.input_schema:
        props = list((spec.input_schema.get("properties") or {}).keys())
        parts = [p.strip() for p in tool_value.split("|")]
        if len(parts) == len(props):
            return {
                "mode": "direct_tool",
                "tool": tool_name,
                "input": dict(zip(props, parts)),
            }

    primary_value = _resolve_primary_arg(primary_arg, tool_value, raw_prompt, ctx)

    return {
        "mode": "direct_tool",
        "tool": tool_name,
        "input": {primary_arg: primary_value},
    }
