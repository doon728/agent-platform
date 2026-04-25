from __future__ import annotations

import json
import os
from typing import Dict, List


_EXTRACTION_PROMPT = """You are a clinical memory extraction system. Extract persistent facts from the conversation below.

Persistent facts are things that remain true beyond this session — member preferences, barriers, medical context, behavioral patterns, user preferences.

Do NOT extract:
- Transient information (what was discussed just now, tool results)
- Questions or requests
- Procedural steps taken

Return a JSON array. Each fact must have:
- "fact_type": short snake_case label (e.g. language_preference, transportation_barrier, clinical_condition)
- "content": one clear sentence stating the fact
- "target_scope": "member" or "user"

If no persistent facts are present, return an empty array [].

Conversation:
{exchange}

Return only valid JSON. No explanation."""


def extract_semantic_facts(prompt: str, response: str) -> List[Dict]:
    """
    LLM-based semantic fact extractor.
    Replaces hardcoded keyword rules with a structured LLM call.
    Falls back to empty list on any error — semantic write is non-critical.
    """
    exchange = f"User: {prompt}\nAssistant: {response}"

    try:
        model = os.getenv("SEMANTIC_EXTRACTION_MODEL", os.getenv("OPENAI_MODEL", "gpt-4o-mini"))
        api_key = os.getenv("OPENAI_API_KEY", "")

        from langchain_openai import ChatOpenAI
        llm = ChatOpenAI(model=model, temperature=0, api_key=api_key)

        result = llm.invoke(_EXTRACTION_PROMPT.format(exchange=exchange))
        raw = result.content.strip()

        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()

        facts = json.loads(raw)

        if not isinstance(facts, list):
            return []

        # Validate each fact has required fields
        valid = []
        for f in facts:
            if (
                isinstance(f, dict)
                and f.get("fact_type")
                and f.get("content")
                and f.get("target_scope") in ("member", "user")
            ):
                valid.append({
                    "fact_type": f["fact_type"],
                    "content": f["content"],
                    "target_scope": f["target_scope"],
                })

        return valid

    except Exception as e:
        print(f"[semantic_engine] extraction failed (non-fatal): {e}", flush=True)
        return []
