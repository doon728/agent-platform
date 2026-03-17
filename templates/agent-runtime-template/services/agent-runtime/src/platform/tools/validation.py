from __future__ import annotations

from typing import Any, Dict


def validate_tool_input(spec: Any, tool_input: Dict[str, Any]) -> None:
    """
    Minimal schema validator (no external deps).
    Uses ToolSpec.input_schema (JSONSchema-like dict).
    Enforces:
      - tool_input must be dict
      - required fields present
      - basic type checks for string/number/integer/boolean/object/array
    """
    if not isinstance(tool_input, dict):
        raise ValueError("tool_input must be an object/dict")

    schema = getattr(spec, "input_schema", None) or {}
    required = schema.get("required", []) or []
    props = schema.get("properties", {}) or {}

    # required keys
    for k in required:
        if k not in tool_input:
            raise ValueError(f"Missing required field: {k}")

    # basic type checks
    for k, rule in props.items():
        if k not in tool_input:
            continue
        expected = (rule or {}).get("type")
        v = tool_input[k]

        if expected == "string" and not isinstance(v, str):
            raise ValueError(f"Field '{k}' must be string")
        if expected == "number" and not isinstance(v, (int, float)):
            raise ValueError(f"Field '{k}' must be number")
        if expected == "integer" and not isinstance(v, int):
            raise ValueError(f"Field '{k}' must be integer")
        if expected == "boolean" and not isinstance(v, bool):
            raise ValueError(f"Field '{k}' must be boolean")
        if expected == "object" and not isinstance(v, dict):
            raise ValueError(f"Field '{k}' must be object")
        if expected == "array" and not isinstance(v, list):
            raise ValueError(f"Field '{k}' must be array")