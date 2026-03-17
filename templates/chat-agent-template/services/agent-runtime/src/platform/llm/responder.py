from __future__ import annotations
from src.platform.config import load_config
import os
import json
from typing import Dict, List

from openai import OpenAI
from src.platform.prompt.prompt_client import PromptServiceClient

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def _get_responder_prompt(ctx: Dict) -> str:
    prompts_cfg = ctx.get("prompts_config") or {}
    local_prompt = prompts_cfg.get("responder_system_prompt")

    prompt_client = PromptServiceClient()
    cfg = load_config()

    resolved_prompt = prompt_client.resolve_prompt(
        app_name=cfg.prompt_service.app_name,
        agent_type=cfg.prompt_service.agent_type,
        usecase_name=cfg.prompt_service.usecase_name,
        prompt_type="responder",
        environment=cfg.prompt_service.environment,
    )

    if resolved_prompt:
        return resolved_prompt

    if local_prompt:
        return local_prompt

    return """
You are a healthcare care-management assistant helping nurses.

Rules:
- Use only the provided tool data or retrieved policy content
- Do not invent information
- Be concise and clinically useful
- If the information is insufficient, say so
""".strip()


def _format_tool_output(tool_name: str, tool_output: Dict) -> str:
    if tool_name == "search_kb":
        results: List[Dict] = tool_output.get("results", [])

        if not results:
            return "No relevant policy documents were found."

        parts = []

        for r in results[:3]:
            title = r.get("title", "Unknown Source")
            snippet = r.get("snippet", "")

            parts.append(
                f"""
Source: {title}

Policy Text:
{snippet}
""".strip()
            )

        return "\n\n---\n\n".join(parts)

    return json.dumps(tool_output, indent=2)


def generate_answer(user_prompt: str, tool_name: str, tool_output: Dict, ctx: Dict | None = None) -> str:
    print("[LLM] generating response", flush=True)

    ctx = ctx or {}
    system_prompt = _get_responder_prompt(ctx)
    tool_context = _format_tool_output(tool_name, tool_output)

    prompt = f"""
USER QUESTION:
{user_prompt}

RETRIEVED TOOL CONTEXT:
{tool_context}

Answer the question using ONLY the retrieved tool context.
"""

    resp = client.chat.completions.create(
        model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
        temperature=0,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ],
    )

    return resp.choices[0].message.content.strip()