from __future__ import annotations
from platform.prompt.prompt_client import PromptServiceClient
from src.platform.config import load_config
import os

import re
from typing import List, Dict, Any

from src.platform.tools.registry import registry


MEMBER_ID_RE = re.compile(r"\b(m-\d{6})\b", re.IGNORECASE)
ASMT_ID_RE = re.compile(r"\b(asmt-\d{6})\b", re.IGNORECASE)
MEMBER_ID_RE = re.compile(r"\b(m-\d{6})\b", re.IGNORECASE)
ASMT_ID_RE = re.compile(r"\b(asmt-\d{6})\b", re.IGNORECASE)

POLICY_KWS = [
    "policy",
    "guideline",
    "coverage",
    "medical necessity",
    "prior auth",
    "prior authorization",
    "denial",
    "denied",
    "criteria",
    "pended",
]

WRITE_NOTE_KWS = ["write a case note", "write case note", "add note", "case note", "write note"]

def plan(prompt: str, ctx: Dict[str, Any]) -> List[str]:
    p = (prompt or "").strip()
    cfg = load_config()
    planner_mode = cfg.features.planner_mode
    if not p:
        return ["search_kb: "]

    allowed = set(registry.allowed_tools())
    if not allowed:
        # Fail closed: if nothing allowed, still produce search_kb (or raise)
        return ["search_kb: " + p]

    def is_allowed(tool_name: str) -> bool:
        return tool_name in allowed

    def is_high_risk(tool_name: str) -> bool:
        # MVP: treat certain tools as high-risk without requiring registry support
        return tool_name in {"write_case_note"}

    # ------------------------------------------
    # MVP: Strong ID-based routing (nurse friendly)
    # ------------------------------------------
    mid = MEMBER_ID_RE.search(p)
    aid = ASMT_ID_RE.search(p)

    low = p.lower()

    wants_write_note = any(k in low for k in WRITE_NOTE_KWS)
    has_id = bool(aid or mid)

    # Require ":" so we can reliably extract the note text after it
    if wants_write_note and has_id and ":" in p:
        _, note_text = p.split(":", 1)
        note_text = note_text.strip()

        case_id = (aid.group(1) if aid else mid.group(1))
        if note_text and "write_case_note" in registry.list_tools() and is_allowed("write_case_note"):
            return [f"write_case_note: {case_id} | {note_text}"]

    has_policy_intent = any(k in low for k in POLICY_KWS)

    # If nurse asked policy/guidance AND included an ID,
    # keep the full prompt so executor can run TWO_STEP
    if has_policy_intent and (mid or aid):
        return [p]

    # If prompt contains an assessment id, prefer assessment summary
    if aid and "get_assessment_summary" in registry.list_tools() and is_allowed("get_assessment_summary"):
        return [f"get_assessment_summary: {aid.group(1)}"]

    # If prompt contains a member id, prefer member summary
    if mid and "get_member_summary" in registry.list_tools() and is_allowed("get_member_summary"):
        return [f"get_member_summary: {mid.group(1)}"]

    # 1) Explicit tool call: "tool_name: value"
    if ":" in p:
        left, right = p.split(":", 1)
        tool_name = left.strip()
        tool_value = right.strip()

        if tool_name in registry.list_tools() and is_allowed(tool_name):
            return [f"{tool_name}: {tool_value}"]

        # If user explicitly asked for a non-allowed tool, force a safe fallback
        return [f"search_kb: {p}"]

    # 2) Heuristics (ONLY pick tools if allowed)
    low = p.lower()

    # get_member heuristic (ONLY if user gave a plausible member token, otherwise don't guess)
    if ("get member" in low) and any(ch.isdigit() for ch in p):
        member_token = p.split()[-1].strip()
        if "get_member" in registry.list_tools() and is_allowed("get_member"):
            return [f"get_member: {member_token}"]

    # write_case_note heuristic (avoid auto-selecting high-risk tools)
    if ("write case note" in low or "case note" in low or low.startswith("note")):
        if "write_case_note" in registry.list_tools() and is_allowed("write_case_note"):
            # Only auto-select if NOT high risk; otherwise route to search_kb
            if not is_high_risk("write_case_note"):
                return [f"write_case_note: {p}"]



     # write_case_note: nurse-friendly pattern
    # Examples:
    # "Write a case note for assessment asmt-000001: <text>"
    # "Add note to assessment asmt-000001: <text>"
    if ("write" in low and "note" in low and (mid or aid) and ":" in p):
        # Extract note text after the FIRST ":" (keeps it simple)
        _, note_text = p.split(":", 1)
        note_text = note_text.strip()

        # Use assessment_id as case_id for MVP
        case_id = (aid.group(1) if aid else (mid.group(1) if mid else "")).strip()

        if case_id and note_text and "write_case_note" in registry.list_tools() and is_allowed("write_case_note"):
            return [f"write_case_note: {case_id} | {note_text}"]

        # 3) Default
        if planner_mode == "rules":
            if is_allowed("search_kb"):
                return [f"search_kb: {p}"]

        elif planner_mode == "llm":
            # future: call planner prompt + LLM
            if is_allowed("search_kb"):
                return [f"search_kb: {p}"]

        # hybrid / fallback safety
        if is_allowed("search_kb"):
            return [f"search_kb: {p}"]

    # If search_kb isn't allowed, pick the first allowed tool as last resort
    # (still safe because executor/registry will enforce approval/risk rules)
    first_allowed = next(iter(allowed))
    return [f"{first_allowed}: {p}"]