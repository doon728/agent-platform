"""Tests for the audit log consumer stub."""

import json
from pathlib import Path

from src.policy.audit_consumer import AuditConsumer, AuditEvent


def _event(agent: str, tool: str, action: str = "allow") -> AuditEvent:
    return AuditEvent(
        timestamp="2026-04-25T10:00:00Z",
        agent_id=agent,
        tool=tool,
        action=action,
    )


def test_ingest_and_recent_returns_events() -> None:
    consumer = AuditConsumer(buffer_size=10)
    consumer.ingest(_event("agent1", "tool_a"))
    consumer.ingest(_event("agent2", "tool_b"))

    events = consumer.recent()
    assert len(events) == 2
    assert events[0]["agent_id"] == "agent1"
    assert events[1]["agent_id"] == "agent2"


def test_ring_buffer_evicts_oldest() -> None:
    consumer = AuditConsumer(buffer_size=3)
    for i in range(5):
        consumer.ingest(_event(f"agent{i}", "tool_a"))

    events = consumer.recent()
    assert len(events) == 3
    # Oldest two evicted
    assert [e["agent_id"] for e in events] == ["agent2", "agent3", "agent4"]


def test_filter_by_agent() -> None:
    consumer = AuditConsumer()
    consumer.ingest(_event("um_agent", "tool_a"))
    consumer.ingest(_event("cm_agent", "tool_b"))
    consumer.ingest(_event("um_agent", "tool_c", action="deny"))

    um_events = consumer.by_agent("um_agent")
    assert len(um_events) == 2
    assert all(e["agent_id"] == "um_agent" for e in um_events)


def test_filter_by_tool() -> None:
    consumer = AuditConsumer()
    consumer.ingest(_event("a1", "search_kb"))
    consumer.ingest(_event("a2", "get_member"))
    consumer.ingest(_event("a3", "search_kb"))

    kb_events = consumer.by_tool("search_kb")
    assert len(kb_events) == 2
    assert all(e["tool"] == "search_kb" for e in kb_events)


def test_ingest_dict_normalizes_fields() -> None:
    consumer = AuditConsumer()
    raw = {"agent_id": "agent_x", "tool": "tool_y", "action": "deny"}
    event = consumer.ingest_dict(raw)

    assert event.agent_id == "agent_x"
    assert event.tool == "tool_y"
    assert event.action == "deny"
    # timestamp auto-generated when not provided
    assert event.timestamp


def test_poll_inbox_reads_jsonl(tmp_path: Path) -> None:
    inbox = tmp_path / "inbox.jsonl"
    inbox.write_text(
        "\n".join(
            [
                json.dumps({"agent_id": "a1", "tool": "t1", "action": "allow"}),
                json.dumps({"agent_id": "a2", "tool": "t2", "action": "deny"}),
                "",  # empty line — should be skipped
                "this is not json",  # malformed — should be skipped, not crash
                json.dumps({"agent_id": "a3", "tool": "t3", "action": "allow"}),
            ]
        ),
        encoding="utf-8",
    )

    consumer = AuditConsumer()
    count = consumer.poll_inbox(inbox)

    assert count == 3
    assert len(consumer.recent()) == 3


def test_poll_inbox_returns_zero_for_missing_file(tmp_path: Path) -> None:
    consumer = AuditConsumer()
    count = consumer.poll_inbox(tmp_path / "does_not_exist.jsonl")
    assert count == 0
