from __future__ import annotations

from typing import Dict, List


def extract_semantic_facts(prompt: str, response: str) -> List[Dict]:
    """
    Rule-based semantic extractor.
    Returns typed facts with target scope.
    """

    facts: List[Dict] = []
    text = f"{prompt} {response}".lower()

    if "prefers spanish" in text:
        facts.append({
            "fact_type": "language_preference",
            "content": "Member prefers Spanish communication.",
            "target_scope": "member",
        })

    if "transportation barrier" in text:
        facts.append({
            "fact_type": "barrier_transport",
            "content": "Member has transportation barrier.",
            "target_scope": "member",
        })

    if "prefer concise answers" in text or "prefer concise" in text or "i prefer concise" in text:
        facts.append({
            "fact_type": "response_style",
            "content": "User prefers concise answers.",
            "target_scope": "user",
        })

    return facts