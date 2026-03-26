from __future__ import annotations

import os
import re
from typing import List, Dict, Any
from src.platform.config import load_config
from src.platform.prompt.prompt_client import PromptServiceClient

from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage

from src.platform.tools.registry import registry


def _get_planner_prompt(ctx: Dict[str, Any]) -> str:
    prompts_cfg = ctx.get("prompts") or {}
    local_prompt = prompts_cfg.get("planner_system_prompt")

    prompt_client = PromptServiceClient()
    cfg = load_config()

    resolved_prompt = prompt_client.resolve_prompt(
        capability_name=cfg.prompt_service.capability_name,
        agent_type=cfg.prompt_service.agent_type,
        usecase_name=cfg.prompt_service.usecase_name,
        prompt_type="planner",
        environment=cfg.prompt_service.environment,
    )

    if resolved_prompt:
        print("[planner] using prompt from prompt service")
        return resolved_prompt
    if local_prompt:
        return local_prompt

    # Minimal fallback — full prompt should be in prompt-defaults.yaml
    return "You are an AI planning agent. Choose the best tool. Return exactly one tool call in format: tool_name: argument"


def _extract_latest_assessment_id(history: List[Dict[str, Any]]) -> str | None:
    for item in reversed(history or []):
        content = str(item.get("content") or "")
        m = re.search(r"\b(asmt-\d+)\b", content, re.IGNORECASE)
        if m:
            return m.group(1)
    return None


def _extract_assessment_id(text: str) -> str | None:
    m = re.search(r"\b(asmt-\d+)\b", text or "", re.IGNORECASE)
    if m:
        return m.group(1)
    return None


def _extract_member_id(text: str) -> str | None:
    m = re.search(r"\b(m-\d+)\b", text or "", re.IGNORECASE)
    if m:
        return m.group(1)
    return None


def _history_text(history: List[Dict[str, Any]]) -> str:
    out = ""
    for m in history[-8:]:
        role = m.get("role", "user")
        content = m.get("content", "")
        if content:
            out += f"{role.upper()}: {content}\n"
    return out


def _get_allowed_tools(ctx: Dict[str, Any]) -> List[str]:


    tool_policy = ctx.get("tool_policy") or {}
    retrieval_cfg = ctx.get("retrieval") or {}

    mode = tool_policy.get("mode", "selected")

    if mode == "selected":
        tools = tool_policy.get("allowed_tools") or []
        return tools

    if mode == "auto":
        allowed_tags = set(tool_policy.get("allowed_tags") or [])
        specs = registry.list_specs()

        matched = []
        for spec in specs:
            if not allowed_tags:
                matched.append(spec.name)
            elif allowed_tags.intersection(set(spec.tags or [])):
                matched.append(spec.name)

        if retrieval_cfg.get("enabled"):
            default_tool = retrieval_cfg.get("default_tool", "search_kb")
            if default_tool not in matched:
                matched.append(default_tool)

        return matched

    return []


def _filter_tools_by_context(
    allowed_tools: List[str],
    ctx_member_id: str | None,
    ctx_case_id: str | None,
    active_assessment_id: str | None,
) -> List[str]:
    """Reduce allowed_tools to only those valid for the current context."""
    if active_assessment_id:
        context_valid = {"get_assessment_summary", "get_assessment_tasks", "write_case_note", "search_kb", "get_member"}
    elif ctx_case_id:
        context_valid = {"get_case_summary", "write_case_note", "search_kb", "get_member"}
    elif ctx_member_id:
        context_valid = {"get_member_summary", "get_member", "search_kb"}
    else:
        context_valid = {"search_kb"}

    filtered = [t for t in allowed_tools if t in context_valid]
    return filtered if filtered else allowed_tools


def _build_tool_call_schema(allowed_tools: List[str]):
    """Build a dynamic Pydantic model for structured LLM output."""
    from pydantic import create_model
    from typing import Literal

    if len(allowed_tools) == 1:
        tool_type = Literal[allowed_tools[0]]  # type: ignore
    else:
        tool_type = Literal[tuple(allowed_tools)]  # type: ignore

    return create_model("ToolCall", tool=(tool_type, ...), argument=(str, ...))


def _get_tool_descriptions(allowed_tools: List[str]) -> str:
    specs = registry.list_specs()
    spec_map = {s.name: s for s in specs}

    desc_lines = []

    for tool_name in allowed_tools:
        spec = spec_map.get(tool_name)

        if not spec:
            desc_lines.append(tool_name)
            continue

        description = spec.description or ""
        tags = ", ".join(spec.tags or [])
        primary_arg = spec.primary_arg or "query"

        desc_lines.append(
            f"""
tool: {tool_name}
purpose: {description}
argument: {primary_arg}
tags: {tags}
""".strip()
        )

    return "\n\n".join(desc_lines)


def plan(prompt: str, history: List[Dict[str, Any]], ctx: Dict[str, Any]) -> List[str]:
    p = (prompt or "").strip()
    lower_p = p.lower()

    planner_prompt = _get_planner_prompt(ctx)
    allowed_tools = _get_allowed_tools(ctx)

    explicit_assessment_id = _extract_assessment_id(p)
    ctx_assessment_id = str(ctx.get("assessment_id") or "").strip() or None
    latest_assessment_id = _extract_latest_assessment_id(history)
    active_assessment_id = explicit_assessment_id or ctx_assessment_id or latest_assessment_id
    ctx_member_id = str(ctx.get("member_id") or "").strip() or None
    ctx_case_id = str(ctx.get("case_id") or "").strip() or None

    print(f"[planner] allowed_tools={allowed_tools} explicit_assessment_id={explicit_assessment_id} prompt={p}", flush=True)

    history_text = _history_text(history)

    print(f"[planner_history_count] {len(history or [])}", flush=True)
    print(f"[planner_history_text] {history_text}", flush=True)
    print(f"[planner_latest_assessment_id] {latest_assessment_id}", flush=True)
    print(f"[planner_active_assessment_id] {active_assessment_id}", flush=True)

    prompt_member_id = _extract_member_id(p)

    # --------------------------------------------------
    # HARD ROUTING — deterministic routing before LLM
    # --------------------------------------------------
    clinical_summary_phrases = [
        "summarize",
        "summary",
        "status",
        "latest note",
        "last note",
        "concern",
        "major concern",
        "key concern",
        "risk",
        "risk level",
        "overall risk",
        "clinical",
        "condition",
        "health status",
        "diagnosis",
        "what is",
        "tell me",
        "how is",
        "what are",
    ]

    patient_phrases = [
        "patient name",
        "member name",
        "last name",
        "first name",
        "full name",
        "name",
        "latest note",
        "last note",
        "summarize status",
        "assessment summary",
    ]

    tasks_phrases = [
        "open tasks",
        "my tasks",
        "tasks",
        "what tasks",
        "pending tasks",
        "task list",
        "what do i need to do",
        "pre call tasks",
        "during call tasks",
        "post call tasks",
    ]

    note_write_phrases = [
        "update note",
        "update last note",
        "write note",
        "add note",
        "write a case note",
        "case note",
        "last note:",
        "note:",
    ]

    # 1) Explicit assessment summary
    if explicit_assessment_id and any(x in lower_p for x in clinical_summary_phrases):
        if "get_assessment_summary" in allowed_tools:
            print("[planner] HARD ROUTE -> get_assessment_summary", flush=True)
            return (
                [f"get_assessment_summary: {explicit_assessment_id}"],
                {"route_type": "HARD_ROUTE", "tool": "get_assessment_summary", "reason": "assessment_id + summary phrase", "active_assessment_id": explicit_assessment_id},
            )

    # 2) Active assessment follow-up reads
    if active_assessment_id and any(x in lower_p for x in patient_phrases):
        if "get_assessment_summary" in allowed_tools:
            print("[planner] HARD ROUTE -> get_assessment_summary (active assessment)", flush=True)
            return (
                [f"get_assessment_summary: {active_assessment_id}"],
                {"route_type": "HARD_ROUTE", "tool": "get_assessment_summary", "reason": "active_assessment + patient phrase", "active_assessment_id": active_assessment_id},
            )

    # 3) Tasks lookup
    if active_assessment_id and any(x in lower_p for x in tasks_phrases):
        if "get_assessment_tasks" in allowed_tools:
            print("[planner] HARD ROUTE -> get_assessment_tasks", flush=True)
            return (
                [f"get_assessment_tasks: {active_assessment_id}"],
                {"route_type": "HARD_ROUTE", "tool": "get_assessment_tasks", "reason": "active_assessment + tasks phrase", "active_assessment_id": active_assessment_id},
            )

    # 4) Deterministic note writing
    if active_assessment_id and any(x in lower_p for x in note_write_phrases):
        target_assessment = explicit_assessment_id or active_assessment_id

        if target_assessment and "write_case_note" in allowed_tools:
            print("[planner] HARD ROUTE -> write_case_note", flush=True)
            return (
                [f"write_case_note:{target_assessment} | {p}"],
                {"route_type": "HARD_ROUTE", "tool": "write_case_note", "reason": "active_assessment + note write phrase", "active_assessment_id": target_assessment},
            )

    # 5) Member-level summary — no assessment, no case in context
    if ctx_member_id and not ctx_case_id and not active_assessment_id and any(x in lower_p for x in clinical_summary_phrases):
        if "get_member_summary" in allowed_tools:
            print("[planner] HARD ROUTE -> get_member_summary (member ctx)", flush=True)
            return (
                [f"get_member_summary: {ctx_member_id}"],
                {"route_type": "HARD_ROUTE", "tool": "get_member_summary", "reason": "member_id in ctx + summary phrase"},
            )
        if "get_member" in allowed_tools:
            print("[planner] HARD ROUTE -> get_member (member ctx)", flush=True)
            return (
                [f"get_member: {ctx_member_id}"],
                {"route_type": "HARD_ROUTE", "tool": "get_member", "reason": "member_id in ctx + summary phrase"},
            )

    # 6) Case-level summary — case_id in context, no assessment
    if ctx_case_id and not active_assessment_id and any(x in lower_p for x in clinical_summary_phrases):
        if "get_case_summary" in allowed_tools:
            print("[planner] HARD ROUTE -> get_case_summary (case ctx)", flush=True)
            return (
                [f"get_case_summary: {ctx_case_id}"],
                {"route_type": "HARD_ROUTE", "tool": "get_case_summary", "reason": "case_id in ctx + summary phrase → case_summary"},
            )
        target_member = ctx_member_id or prompt_member_id
        if target_member and "get_member_summary" in allowed_tools:
            print("[planner] HARD ROUTE -> get_member_summary (case ctx fallback)", flush=True)
            return (
                [f"get_member_summary: {target_member}"],
                {"route_type": "HARD_ROUTE", "tool": "get_member_summary", "reason": "case_id in ctx + summary phrase → member_summary (fallback)"},
            )
        if target_member and "get_member" in allowed_tools:
            print("[planner] HARD ROUTE -> get_member (case ctx)", flush=True)
            return (
                [f"get_member: {target_member}"],
                {"route_type": "HARD_ROUTE", "tool": "get_member", "reason": "case_id in ctx + summary phrase → get_member"},
            )

    retrieval_cfg = ctx.get("retrieval") or {}
    default_retrieval_tool = retrieval_cfg.get("default_tool", "search_kb")

    # --------------------------------------------------
    # LLM PATH — structured output with context-filtered tools
    # --------------------------------------------------
    filtered_tools = _filter_tools_by_context(allowed_tools, ctx_member_id, ctx_case_id, active_assessment_id)
    print(f"[planner] filtered_tools={filtered_tools}", flush=True)

    model_name = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    api_key = os.getenv("OPENAI_API_KEY", "")
    llm = ChatOpenAI(model=model_name, temperature=0, api_key=api_key)

    ToolCallSchema = _build_tool_call_schema(filtered_tools)
    structured_llm = llm.with_structured_output(ToolCallSchema)

    tools_text = _get_tool_descriptions(filtered_tools)

    system = SystemMessage(
        content=f"""
{planner_prompt}

Conversation context:
Active member_id: {ctx_member_id or "(none)"}
Active case_id: {ctx_case_id or "(none)"}
Active assessment_id: {active_assessment_id or "(none)"}

Available tools (only these are valid for the current context):
{tools_text}

Choose the single best tool for the user's message.
For the argument, use the active ID from context (assessment_id, case_id, or member_id) unless the user specifies a different one.
For write_case_note, use the active assessment_id or case_id as the argument.
For search_kb, use the user's message as the argument.
"""
    )

    human = HumanMessage(
        content=(
            f"Conversation history:\n{history_text or '(none)'}\n\n"
            f"User message:\n{p}\n\n"
            "Return the best tool call."
        )
    )

    try:
        result = structured_llm.invoke([system, human])
        tool = result.tool
        arg = (result.argument or "").strip()
    except Exception as e:
        print(f"[planner] structured output failed: {e}", flush=True)
        return (
            [f"{default_retrieval_tool}: {p}"],
            {"route_type": "LLM_ROUTE", "tool": default_retrieval_tool, "reason": f"structured output failed: {e}"},
        )

    print(f"[planner] LLM structured result: tool={tool} argument={arg}", flush=True)

    # Step 3 — Inject missing argument from context
    if not arg:
        if tool in ("get_assessment_summary", "get_assessment_tasks") and active_assessment_id:
            arg = active_assessment_id
        elif tool == "get_case_summary" and ctx_case_id:
            arg = ctx_case_id
        elif tool in ("get_member_summary", "get_member") and ctx_member_id:
            arg = ctx_member_id
        else:
            arg = p

    return (
        [f"{tool}: {arg}"],
        {"route_type": "LLM_ROUTE", "tool": tool, "reason": "LLM structured decision", "filtered_tools": filtered_tools},
    )
