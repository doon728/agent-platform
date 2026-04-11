from __future__ import annotations

import json
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict

from openai import OpenAI

from platform_core.tools.registry import registry
from platform_core.usecase_config_loader import load_agent_config
from platform_core.config import load_config
from platform_core.prompt.prompt_client import PromptServiceClient

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


# ---------------------------------------------------------------------------
# fetch_node — calls tools in parallel based on scope type
# ---------------------------------------------------------------------------

def _call_tool(tool_name: str, tool_input: Dict[str, Any], ctx: Dict[str, Any]):
    try:
        return tool_name, registry.invoke(tool_name, tool_input, ctx)
    except Exception as e:
        return tool_name, {"error": str(e)}


def _get_scope_definition(scope_type: str, ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Find the scope definition from domain.yaml loaded into ctx."""
    domain = ctx.get("domain") or {}
    for scope in domain.get("scopes") or []:
        if scope.get("name") == scope_type:
            return scope
    return {}


def fetch(scope_type: str, scope_id: str, ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Determine which tools to call for this scope using domain.yaml summary_tools."""
    scope_def = _get_scope_definition(scope_type, ctx)
    summary_tools = scope_def.get("summary_tools") or []

    if not summary_tools:
        print(f"[summarizer] no summary_tools defined for scope '{scope_type}' in domain.yaml", flush=True)
        return {}

    calls = []
    for entry in summary_tools:
        tool = entry.get("tool") or ""
        arg_field = entry.get("arg_field") or scope_def.get("id_field") or f"{scope_type}_id"
        arg_value = ctx.get(arg_field) or scope_id
        if tool and arg_value:
            calls.append((tool, {arg_field: arg_value}))

    results: Dict[str, Any] = {}
    with ThreadPoolExecutor(max_workers=max(len(calls), 1)) as executor:
        futures = {executor.submit(_call_tool, name, inp, ctx): name for name, inp in calls}
        for future in as_completed(futures):
            tool_name, result = future.result()
            results[tool_name] = result

    return results


# ---------------------------------------------------------------------------
# summarize_node — LLM synthesizes tool results into a structured summary
# ---------------------------------------------------------------------------

_DEFAULT_PROMPTS = {
    "assessment": (
        "You are a care management assistant. Analyze the following assessment data and return a JSON object with these exact keys:\n"
        "- summary: a 2-3 sentence narrative string describing the member's assessment status\n"
        "- key_concerns: list of strings, each a brief concern\n"
        "- last_action: a single string describing the most recent action taken\n"
        "- next_steps: list of strings, each a recommended next step\n"
        "IMPORTANT: 'summary' must be a plain text string, NOT an object or raw data."
    ),
    "case": (
        "You are a care management assistant. Analyze the following case data and return a JSON object with these exact keys:\n"
        "- summary: a 2-3 sentence narrative string describing the case status and member condition\n"
        "- key_concerns: list of strings, each a brief concern\n"
        "- last_action: a single string describing the most recent action taken\n"
        "- next_steps: list of strings, each a recommended next step\n"
        "IMPORTANT: 'summary' must be a plain text string, NOT an object or raw data."
    ),
    "member": (
        "You are a care management assistant. Analyze the following member health data and return a JSON object with these exact keys:\n"
        "- summary: a 2-3 sentence narrative string describing the member's overall health status, conditions, and care situation\n"
        "- key_concerns: list of strings, each a brief clinical concern\n"
        "- last_action: a single string describing the most recent care action\n"
        "- next_steps: list of strings, each a recommended next step for the care team\n"
        "IMPORTANT: 'summary' must be a plain text string, NOT an object or raw data."
    ),
}


def _get_prompt(scope_type: str) -> str:
    try:
        cfg = load_config()
        prompt_client = PromptServiceClient()
        resolved = prompt_client.resolve_prompt(
            capability_name=cfg.prompt_service.capability_name,
            agent_type="summary_agent",
            usecase_name=cfg.prompt_service.usecase_name,
            prompt_type=f"{scope_type}_summary",
            environment=cfg.prompt_service.environment,
        )
        if resolved:
            return resolved
    except Exception:
        pass

    try:
        config = load_agent_config("summary_agent")
        prompts = config.get("prompts") or {}
        key = f"{scope_type}_summary_prompt"
        local = prompts.get(key)
        if local:
            return local
    except Exception:
        pass

    return _DEFAULT_PROMPTS.get(scope_type, _DEFAULT_PROMPTS["assessment"])


def _parse_llm_json(raw: str) -> Dict[str, Any]:
    """Extract JSON from LLM response — handles markdown code fences."""
    text = raw.strip()
    if "```json" in text:
        text = text.split("```json")[1].split("```")[0].strip()
    elif "```" in text:
        text = text.split("```")[1].split("```")[0].strip()
    try:
        parsed = json.loads(text)
        # Safeguard: ensure summary is always a string, not an object
        if isinstance(parsed, dict) and not isinstance(parsed.get("summary"), str):
            parsed["summary"] = json.dumps(parsed["summary"], default=str) if parsed.get("summary") else ""
        return parsed
    except Exception:
        return {
            "summary": text,
            "key_concerns": [],
            "last_action": "",
            "next_steps": [],
        }


def summarize(scope_type: str, fetch_results: Dict[str, Any], ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Call LLM with fetched tool results and return a structured summary."""
    system_prompt = _get_prompt(scope_type)
    context_text = json.dumps(fetch_results, indent=2, default=str)

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Data:\n{context_text}"},
        ],
        temperature=0.2,
    )

    raw = response.choices[0].message.content or ""
    return _parse_llm_json(raw)
