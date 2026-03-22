from __future__ import annotations

import re
from typing import Dict, Any, List

from src.platform.tools.registry import registry


def _extract_assessment_id(text: str) -> str | None:
    m = re.search(r"\b(asmt-\d+)\b", text or "", re.IGNORECASE)
    if not m:
        return None
    return m.group(1)


def _extract_member_id(text: str) -> str | None:
    m = re.search(r"\b(m-\d+)\b", text or "", re.IGNORECASE)
    if not m:
        return None
    return m.group(1)


def _extract_assessment_id_from_history(history: List[Dict[str, Any]]) -> str | None:
    for item in reversed(history or []):
        content = str(item.get("content") or "")
        found = _extract_assessment_id(content)
        if found:
            return found
    return None


def _extract_note_from_raw_prompt(raw_prompt: str, case_id: str | None) -> str:
    text = (raw_prompt or "").strip()

    if not text:
        return ""

    text = re.sub(
        r"(?i)^\s*write\s+(a\s+)?case\s+notes?\s*(for\s+assessment\s+asmt-\d+)?\s*[:\-]?\s*",
        "",
        text,
    ).strip()

    text = re.sub(
        r"(?i)^\s*for\s+assessment\s+asmt-\d+\s*[:\-]?\s*",
        "",
        text,
    ).strip()

    if case_id:
        text = re.sub(rf"(?i)\b{re.escape(case_id)}\b", "", text).strip()

    return text


def _resolve_primary_arg(primary_arg: str, tool_value: str, raw_prompt: str, ctx: Dict[str, Any]) -> str:
    history = ctx.get("history") or []

    if primary_arg == "assessment_id":
        value = (
            _extract_assessment_id(tool_value)
            or _extract_assessment_id(raw_prompt)
            or _extract_assessment_id_from_history(history)
        )
        if not value:
            raise RuntimeError("Missing assessment_id for tool call")
        return value

    if primary_arg == "member_id":
        value = _extract_member_id(tool_value) or _extract_member_id(raw_prompt)
        if not value:
            raise RuntimeError("Missing member_id for tool call")
        return value

    if primary_arg == "query":
        return tool_value or raw_prompt

    return tool_value or raw_prompt


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

    # Keep write tool handling explicit for stability
    if tool_name == "write_case_note":
        if "|" in tool_value:
            case_id, note = [x.strip() for x in tool_value.split("|", 1)]

            if not case_id or not note:
                raise RuntimeError(
                    "write_case_note requires: write_case_note: <assessment_id> | <note>"
                )

            return {
                "mode": "direct_tool",
                "tool": "write_case_note",
                "input": {
                    "case_id": case_id,
                    "note": note,
                },
            }

        colon_match = re.match(r"^\s*(asmt-\d+)\s*:\s*(.+)$", tool_value, re.IGNORECASE)
        if colon_match:
            case_id = colon_match.group(1).strip()
            note = colon_match.group(2).strip()

            return {
                "mode": "direct_tool",
                "tool": "write_case_note",
                "input": {
                    "case_id": case_id,
                    "note": note,
                },
            }

        history = ctx.get("history") or []
        case_id = (
            _extract_assessment_id(tool_value)
            or _extract_assessment_id(raw_prompt)
            or _extract_assessment_id_from_history(history)
        )
        note = _extract_note_from_raw_prompt(raw_prompt, case_id)

        if case_id and note:
            return {
                "mode": "direct_tool",
                "tool": "write_case_note",
                "input": {
                    "assessment_id": case_id,
                    "note": note,
                },
            }

        raise RuntimeError(
            "write_case_note requires: write_case_note: <assessment_id> | <note>"
        )

    # Generic path for all other registered tools
    spec = registry.get_spec(tool_name)
    primary_arg = spec.primary_arg or "query"
    primary_value = _resolve_primary_arg(primary_arg, tool_value, raw_prompt, ctx)

    return {
        "mode": "direct_tool",
        "tool": tool_name,
        "input": {primary_arg: primary_value},
    }