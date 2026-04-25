from __future__ import annotations

import os
from typing import Any, Dict, List

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI


def _extract_tool_facts(result: Any) -> str:
    if result is None:
        return "No tool result available."
    if isinstance(result, dict):
        if result.get("result") == "APPROVAL_REQUIRED":
            approval = result.get("approval") or {}
            return (
                f"Approval required.\n"
                f"Tool: {approval.get('tool_name', 'unknown')}\n"
                f"Message: {approval.get('message', '')}"
            )
        if result.get("result") == "OK" and result.get("mode") == "TWO_STEP":
            nurse_summary = result.get("nurse_summary") or ""
            policy_summary = result.get("policy_summary") or ""
            parts = []
            if nurse_summary:
                parts.append(f"NURSE SUMMARY:\n{nurse_summary}")
            if policy_summary:
                parts.append(f"POLICY SUMMARY:\n{policy_summary}")
            return "\n\n".join(parts).strip()
        if "nurse_summary" in result:
            return str(result.get("nurse_summary") or "")
        return str(result)
    return str(result)


def build_chat_answer(prompt: str, history: List[Dict[str, Any]], result: Any) -> str:
    model_name = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    api_key = os.getenv("OPENAI_API_KEY", "")
    llm = ChatOpenAI(model=model_name, temperature=0, api_key=api_key)

    history_text = ""
    for m in history[-8:]:
        role = m.get("role", "user")
        content = m.get("content", "")
        if content:
            history_text += f"{role.upper()}: {content}\n"

    facts = _extract_tool_facts(result)

    system = SystemMessage(content=(
        "You are a care management nurse assistant.\n"
        "Answer the user's latest question using the provided tool facts and conversation history.\n"
        "Rules:\n"
        "1. Be concise and direct.\n"
        "2. Answer only what the user asked.\n"
        "3. Do not repeat the entire summary unless the user asked for a full summary.\n"
        "4. Do not invent facts.\n"
        "5. If approval is required, clearly say so.\n"
    ))

    human = HumanMessage(content=(
        f"Conversation history:\n{history_text or '(none)'}\n\n"
        f"Latest user question:\n{prompt}\n\n"
        f"Tool facts:\n{facts}\n\n"
        "Write the final nurse-facing response."
    ))

    resp = llm.invoke([system, human])
    return resp.content.strip()
