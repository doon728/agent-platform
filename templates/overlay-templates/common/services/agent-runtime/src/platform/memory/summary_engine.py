from __future__ import annotations

from typing import Any, Dict, List

from src.platform.memory.memory_store import FileMemoryStore


def build_simple_summary(recent_turns: List[Dict[str, Any]]) -> str:
    if not recent_turns:
        return ""

    lines: List[str] = []
    for turn in recent_turns[-6:]:
        role = turn.get("role", "unknown")
        content = str(turn.get("content", "")).strip()
        if content:
            lines.append(f"{role}: {content}")

    if not lines:
        return ""

    return " | ".join(lines)


def maybe_write_conversation_summary(
    store: FileMemoryStore,
    tenant_id: str,
    thread_id: str,
    memory_cfg: Dict[str, Any],
) -> None:
    summary_cfg = ((memory_cfg.get("write_policies") or {}).get("summary") or {})
    if not summary_cfg.get("enabled", False):
        return

    triggers = summary_cfg.get("triggers") or {}
    every_n_turns = int(triggers.get("every_n_turns", 10))

    recent_turns = store.list_recent_turns(
        tenant_id=tenant_id,
        thread_id=thread_id,
        max_turns=every_n_turns,
    )

    if len(recent_turns) < every_n_turns:
        return

    summary_text = build_simple_summary(recent_turns)
    if not summary_text:
        return

    store.replace_memory(
        tenant_id=tenant_id,
        memory_type="summary",
        scope_type="conversation",
        scope_id=thread_id,
        content=summary_text,
        metadata={
            "source": "summary_engine",
            "turn_count": len(recent_turns),
        },
    )