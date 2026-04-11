from __future__ import annotations

# Generic LLM planner — chooses the best tool for the user's request.
# Reads all config from ctx dict (domain, tool_policy, retrieval, prompts).
# No overlay-specific imports.

import os
from typing import Any, Dict, List

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from platform_core.config import load_config
from platform_core.prompt.prompt_client import PromptServiceClient
from platform_core.tools.registry import registry


def _build_domain_context(ctx: Dict[str, Any]) -> str:
    domain = ctx.get("domain") or {}
    if not domain:
        return ""
    capability = domain.get("capability") or ""
    name = domain.get("name") or capability
    description = domain.get("description") or ""
    domains = domain.get("domains") or []
    lines = [f"You operate within the {name} capability."]
    if description:
        lines.append(description)
    if domains:
        domain_ids = ", ".join(d.get("id", "") for d in domains if d.get("id"))
        lines.append(f"In-scope domains: {domain_ids}.")
    lines.append("Only answer questions and use tools relevant to these domains.")
    return "\n".join(lines)


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
    base_prompt = resolved_prompt or local_prompt or "You are an AI planning agent. Choose the best tool."
    domain_ctx = _build_domain_context(ctx)
    if domain_ctx:
        return f"{domain_ctx}\n\n{base_prompt}"
    return base_prompt


def _resolve_scope_id(scope: str, ctx: Dict[str, Any], history: List[Dict[str, Any]]) -> str | None:
    domain = ctx.get("domain") or {}
    scopes = domain.get("scopes") or []
    id_field = None
    for s in scopes:
        if s.get("name") == scope:
            id_field = s.get("id_field")
            break
    if not id_field:
        id_field = f"{scope}_id"
    scope_id = str(ctx.get(id_field) or "").strip() or None
    if not scope_id and history:
        for item in reversed(history):
            content = str(item.get("metadata", {}).get(id_field) or "")
            if content:
                scope_id = content
                break
    return scope_id or None


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
        tools = list(tool_policy.get("allowed_tools") or [])
    elif mode == "auto":
        allowed_tags = set(tool_policy.get("allowed_tags") or [])
        specs = registry.list_specs()
        tools = []
        for spec in specs:
            if not allowed_tags or allowed_tags.intersection(set(spec.tags or [])):
                tools.append(spec.name)
    else:
        tools = []
    planner_tool_cfg = (retrieval_cfg.get("planner_tool") or {})
    planner_tool_name = planner_tool_cfg.get("tool", "search_kb")
    if not planner_tool_cfg.get("enabled", True):
        tools = [t for t in tools if t != planner_tool_name]
    if "direct_answer" not in tools:
        tools.append("direct_answer")
    return tools


def _active_scope_context(ctx: Dict[str, Any], history: List[Dict[str, Any]]) -> Dict[str, str]:
    domain = ctx.get("domain") or {}
    scopes = domain.get("scopes") or []
    result = {}
    for s in scopes:
        name = s.get("name") or ""
        scope_id = _resolve_scope_id(name, ctx, history)
        if scope_id:
            result[name] = scope_id
    if not result:
        for k, v in ctx.items():
            if k.endswith("_id") and v and isinstance(v, str):
                result[k.replace("_id", "")] = v
    return result


def _build_tool_call_schema(allowed_tools: List[str]):
    from typing import Literal
    from pydantic import create_model
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
        if tool_name == "direct_answer":
            desc_lines.append(
                "tool: direct_answer\n"
                "purpose: Answer the user directly from memory, context, or general knowledge — no tool call needed\n"
                "argument: the user's question or a brief restatement of it\n"
                "tags: general"
            )
            continue
        spec = spec_map.get(tool_name)
        if not spec:
            desc_lines.append(tool_name)
            continue
        desc_lines.append(
            f"tool: {tool_name}\npurpose: {spec.description or ''}\n"
            f"argument: {spec.primary_arg or 'query'}\ntags: {', '.join(spec.tags or [])}"
        )
    return "\n\n".join(desc_lines)


def plan(prompt: str, history: List[Dict[str, Any]], ctx: Dict[str, Any]):
    """Plan the next tool call. Returns (steps, planner_trace)."""
    p = (prompt or "").strip()
    planner_prompt = _get_planner_prompt(ctx)
    allowed_tools = _get_allowed_tools(ctx)
    retrieval_cfg = ctx.get("retrieval") or {}
    default_retrieval_tool = retrieval_cfg.get("default_tool", "search_kb")
    active_scopes = _active_scope_context(ctx, history)
    history_text = _history_text(history)

    print(f"[planner] allowed_tools={allowed_tools} active_scopes={active_scopes}", flush=True)

    scope_context_lines = "\n".join(
        f"Active {scope}: {scope_id}" for scope, scope_id in active_scopes.items()
    ) or "(no scope context)"

    model_name = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    api_key = os.getenv("OPENAI_API_KEY", "")
    llm = ChatOpenAI(model=model_name, temperature=0, api_key=api_key)

    ToolCallSchema = _build_tool_call_schema(allowed_tools)
    structured_llm = llm.with_structured_output(ToolCallSchema)
    tools_text = _get_tool_descriptions(allowed_tools)

    rag_chunks = ctx.get("rag_context") or []
    if rag_chunks:
        rag_lines = "\n\n".join(
            f"[KB {i+1}] {chunk.get('title', '')} — {chunk.get('content', chunk.get('snippet', ''))}"
            for i, chunk in enumerate(rag_chunks)
        )
        rag_section = f"\n\nKnowledge base context (retrieved before reasoning):\n{rag_lines}"
    else:
        rag_section = ""

    system = SystemMessage(content=f"""
{planner_prompt}

Active context:
{scope_context_lines}{rag_section}

Available tools:
{tools_text}

Choose the single best tool for the user's message.
Use the active scope ID as the argument unless the user specifies a different one.
For search_kb, use the user's message as the argument.
Use direct_answer when no tool is needed.
""")

    human = HumanMessage(content=(
        f"Conversation history:\n{history_text or '(none)'}\n\n"
        f"User message:\n{p}\n\n"
        "Return the best tool call."
    ))

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

    print(f"[planner] tool={tool} argument={arg}", flush=True)

    if not arg:
        for scope_id in active_scopes.values():
            arg = scope_id
            break
        if not arg:
            arg = p

    return (
        [f"{tool}: {arg}"],
        {"route_type": "LLM_ROUTE", "tool": tool, "reason": "LLM structured decision"},
    )
