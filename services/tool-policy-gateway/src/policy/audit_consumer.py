"""Audit log consumer — STUB.

In Pattern A′, AgentCore Tool Gateway (the PEP) emits audit events for every
tool invocation it allows or denies. This module consumes those events and
surfaces them via the gateway's governance dashboards.

Today, AgentCore integration is not wired (backlog A1) so the consumer:
  1. Polls a placeholder local file (services/tool-policy-gateway/audit/inbox.jsonl).
  2. Surfaces events via a minimal in-memory ring buffer and a /audit endpoint.

Real implementation will:
  - Consume from AgentCore Observability streams (CloudWatch / Kinesis / EventBridge).
  - Persist events to a durable store (DynamoDB / Postgres).
  - Expose query + filter API for the governance UI.
  - Handle replay, deduplication, and retention.
"""

from __future__ import annotations

import json
import logging
from collections import deque
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

DEFAULT_BUFFER_SIZE = 1000
DEFAULT_INBOX = Path(__file__).resolve().parents[2] / "audit" / "inbox.jsonl"


@dataclass
class AuditEvent:
    """A single audit event from a PEP."""

    timestamp: str
    agent_id: str
    tool: str
    action: str  # "allow" | "deny"
    decision_reason: str = ""
    request: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)


class AuditConsumer:
    """In-memory audit consumer with a fixed-size ring buffer.

    Replace with a persistent store + AgentCore Observability tap when integration ships.
    """

    def __init__(self, buffer_size: int = DEFAULT_BUFFER_SIZE) -> None:
        self._buffer: deque[AuditEvent] = deque(maxlen=buffer_size)

    def ingest(self, event: AuditEvent) -> None:
        self._buffer.append(event)

    def ingest_dict(self, raw: dict[str, Any]) -> AuditEvent:
        event = AuditEvent(
            timestamp=str(raw.get("timestamp") or datetime.now(timezone.utc).isoformat()),
            agent_id=str(raw.get("agent_id", "")),
            tool=str(raw.get("tool", "")),
            action=str(raw.get("action", "")),
            decision_reason=str(raw.get("decision_reason", "")),
            request=raw.get("request") or {},
            metadata=raw.get("metadata") or {},
        )
        self.ingest(event)
        return event

    def recent(self, limit: int = 100) -> list[dict[str, Any]]:
        events = list(self._buffer)[-limit:]
        return [asdict(e) for e in events]

    def by_agent(self, agent_id: str, limit: int = 100) -> list[dict[str, Any]]:
        matches = [e for e in self._buffer if e.agent_id == agent_id][-limit:]
        return [asdict(e) for e in matches]

    def by_tool(self, tool: str, limit: int = 100) -> list[dict[str, Any]]:
        matches = [e for e in self._buffer if e.tool == tool][-limit:]
        return [asdict(e) for e in matches]

    def poll_inbox(self, inbox_path: Path | None = None) -> int:
        """Read JSONL events from the local inbox file (STUB — placeholder for AgentCore tap).

        Returns the number of events ingested.
        """
        path = Path(inbox_path) if inbox_path else DEFAULT_INBOX
        if not path.exists():
            return 0
        count = 0
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    raw = json.loads(line)
                except json.JSONDecodeError:
                    logger.warning("audit_consumer: skipping malformed line: %r", line[:100])
                    continue
                self.ingest_dict(raw)
                count += 1
        if count:
            logger.info("audit_consumer.poll_inbox: ingested %d events from %s", count, path)
        return count


# Module-level singleton for FastAPI route handlers to share.
default_consumer = AuditConsumer()
