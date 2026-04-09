from __future__ import annotations

from typing import Any, Dict, List

from platform_core.memory.memory_interface import MemoryBackend


def _estimate_tokens(turns: List[Dict[str, Any]]) -> int:
    """Rough token estimate: 1 token ≈ 4 characters."""
    total_chars = sum(len(str(t.get("content", ""))) for t in turns)
    return total_chars // 4


def build_simple_summary(recent_turns: List[Dict[str, Any]]) -> str:
    if not recent_turns:
        return ""

    lines: List[str] = []
    for turn in recent_turns[-6:]:
        role = turn.get("role", "unknown")
        content = str(turn.get("content", "")).strip()
        if content:
            lines.append(f"{role}: {content}")

    return " | ".join(lines) if lines else ""


def _should_trigger(
    summary_cfg: Dict[str, Any],
    recent_turns: List[Dict[str, Any]],
) -> bool:
    """Return True if summary should be written based on trigger config."""
    trigger = summary_cfg.get("trigger", "explicit")

    if trigger == "never":
        return False

    if trigger == "explicit":
        # Only triggered by manual UI call — not auto-triggered here
        return False

    if trigger == "turn_count":
        threshold = int(summary_cfg.get("turn_count_threshold", 20))
        return len(recent_turns) >= threshold

    if trigger == "token_threshold":
        threshold = int(summary_cfg.get("token_threshold", 8000))
        return _estimate_tokens(recent_turns) >= threshold

    return False


def maybe_write_conversation_summary(
    store: MemoryBackend,
    tenant_id: str,
    thread_id: str,
    memory_cfg: Dict[str, Any],
) -> None:
    summary_cfg = ((memory_cfg.get("write_policies") or {}).get("summary") or {})

    if not summary_cfg.get("enabled", False):
        return

    # write_locked check — chat_agent has this locked, summary_agent does not
    if summary_cfg.get("write_locked", False):
        return

    trigger = summary_cfg.get("trigger", "explicit")
    if trigger in ("explicit", "never"):
        return

    # Fetch enough turns to evaluate threshold
    max_fetch = max(
        int(summary_cfg.get("turn_count_threshold", 20)),
        200,  # enough for token estimate
    )
    recent_turns = store.list_recent_turns(
        tenant_id=tenant_id,
        thread_id=thread_id,
        max_turns=max_fetch,
    )

    if not _should_trigger(summary_cfg, recent_turns):
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
            "trigger": trigger,
            "turn_count": len(recent_turns),
            "estimated_tokens": _estimate_tokens(recent_turns),
        },
    )
    print(f"[summary_engine] summary written trigger={trigger} turns={len(recent_turns)}", flush=True)
