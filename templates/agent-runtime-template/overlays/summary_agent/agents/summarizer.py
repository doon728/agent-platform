from __future__ import annotations

import json
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict

from openai import OpenAI

from src.platform.tools.registry import registry
from src.platform.usecase_config_loader import load_agent_config
from src.platform.config import load_config
from src.platform.prompt.prompt_client import PromptServiceClient

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


# ---------------------------------------------------------------------------
# fetch_node — calls tools in parallel based on scope type
# ---------------------------------------------------------------------------

def _call_tool(tool_name: str, tool_input: Dict[str, Any], ctx: Dict[str, Any]):
    try:
        return tool_name, registry.invoke(tool_name, tool_input, ctx)
    except Exception as e:
        return tool_name, {"error": str(e)}


def fetch(scope_type: str, scope_id: str, ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Determine which tools to call for this scope, then call them in parallel."""
    member_id = ctx.get("member_id") or scope_id

    if scope_type == "assessment":
        calls = [
            ("get_assessment_summary", {"assessment_id": scope_id}),
            ("get_assessment_tasks", {"assessment_id": scope_id}),
        ]
    elif scope_type == "case":
        calls = [
            ("get_member", {"member_id": member_id}),
            ("get_member_summary", {"member_id": member_id}),
        ]
    elif scope_type == "member":
        calls = [
            ("get_member", {"member_id": scope_id}),
            ("get_member_summary", {"member_id": scope_id}),
        ]
    else:
        return {}

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
        "Summarize the following assessment data. "
        "Return JSON with keys: summary, key_concerns (list), last_action, next_steps (list)."
    ),
    "case": (
        "Summarize the following case data. "
        "Return JSON with keys: summary, key_concerns (list), last_action, next_steps (list)."
    ),
    "member": (
        "Summarize the following member data. "
        "Return JSON with keys: summary, key_concerns (list), last_action, next_steps (list)."
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
        return json.loads(text)
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
