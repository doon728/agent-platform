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
    prompts_cfg = ctx.get("prompts_config") or {}
    local_prompt = prompts_cfg.get("planner_system_prompt")

    prompt_client = PromptServiceClient()
    cfg = load_config()

    resolved_prompt = prompt_client.resolve_prompt(
        app_name=cfg.prompt_service.app_name,
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

    return """
You are an AI planning agent.

Your job is to decide which tool should be used next.

Rules:
- Choose the best tool from the available tools.
- Use conversation context when selecting tool arguments.
- Never invent IDs such as assessment_id or member_id.
- If the current user message explicitly contains an assessment_id or member_id, that explicit ID takes priority over history.
- Only use IDs that appear in:
  1) current user message
  2) conversation history
  3) current assessment context
- Return exactly one tool call.

Format:
tool_name: argument
""".strip()


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
    usecase_cfg = ctx.get("usecase_config") or {}
    tool_policy = usecase_cfg.get("tool_policy") or {}

    mode = tool_policy.get("mode", "selected")

    if mode == "selected":
        return tool_policy.get("allowed_tools") or []

    if mode == "auto":
        allowed_tags = set(tool_policy.get("allowed_tags") or [])
        specs = registry.list_specs()

        if not allowed_tags:
            return [spec.name for spec in specs]

        matched = []
        for spec in specs:
            if allowed_tags.intersection(set(spec.tags or [])):
                matched.append(spec.name)

        return matched

    return []


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
    latest_assessment_id = _extract_latest_assessment_id(history)
    active_assessment_id = explicit_assessment_id or latest_assessment_id

    history_text = _history_text(history)

    model_name = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    llm = ChatOpenAI(model=model_name, temperature=0)

    tools_text = _get_tool_descriptions(allowed_tools)

    system = SystemMessage(
        content=f"""
{planner_prompt}

Conversation context:
Explicit assessment in current prompt: {explicit_assessment_id or "(none)"}
Current assessment from history: {latest_assessment_id or "(none)"}
Active assessment to prefer: {active_assessment_id or "(none)"}

Available tools:
{tools_text}

Rules:
- Never invent a member_id or assessment_id.
- If the current user message explicitly contains an assessment_id, use that instead of history.
- If there is an active assessment and the user asks about patient/member name, status, latest note, or summary, use get_assessment_summary with that assessment_id.
- Only choose from the tools listed above.
"""
    )

    human = HumanMessage(
        content=(
            f"Conversation history:\n{history_text or '(none)'}\n\n"
            f"User message:\n{p}\n\n"
            "Return the next tool call."
        )
    )

    resp = llm.invoke([system, human]).content.strip()

    line = resp.splitlines()[0].strip()
    line = line.replace("Tool:", "").replace("tool:", "").strip()

    if ":" not in line:
        if "search_kb" in allowed_tools:
            return [f"search_kb: {p}"]
        return [f"{allowed_tools[0]}: {p}"] if allowed_tools else [f"search_kb: {p}"]

    tool, arg = line.split(":", 1)
    tool = tool.strip()
    arg = arg.strip()

    prompt_member_id = _extract_member_id(p)
    history_member_id = _extract_member_id(history_text)
    arg_member_id = _extract_member_id(arg)
    arg_assessment_id = _extract_assessment_id(arg)

    patient_phrases = [
        "patient name",
        "member name",
        "latest note",
        "last note",
        "summarize status",
        "assessment summary",
    ]

    # Explicit assessment in current prompt always wins
    if explicit_assessment_id and any(x in lower_p for x in patient_phrases):
        return [f"get_assessment_summary: {explicit_assessment_id}"]

    # Prevent invented member IDs
    if tool == "get_member_summary":
        if not arg_member_id and active_assessment_id:
            return [f"get_assessment_summary: {active_assessment_id}"]

        if arg_member_id and arg_member_id not in {prompt_member_id, history_member_id}:
            if active_assessment_id:
                return [f"get_assessment_summary: {active_assessment_id}"]
            return [f"search_kb: {p}"]

    # Recover missing assessment ID from explicit prompt first, then history
    if tool == "get_assessment_summary" and "get_assessment_summary" in allowed_tools:
        resolved_assessment_id = arg_assessment_id or explicit_assessment_id or latest_assessment_id
        if resolved_assessment_id:
            return [f"get_assessment_summary: {resolved_assessment_id}"]

    # If no explicit prompt ID, then use active context
    if active_assessment_id and any(x in lower_p for x in patient_phrases):
        return [f"get_assessment_summary: {active_assessment_id}"]

    return [f"{tool}: {arg}"]