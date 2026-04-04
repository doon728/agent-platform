from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
from uuid import uuid4

DB_PATH = os.getenv("HITL_DB_PATH", "/app/state/hitl/approvals.db")


def _conn() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with _conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS approvals (
                approval_id     TEXT PRIMARY KEY,
                tenant_id       TEXT,
                thread_id       TEXT,
                assessment_id   TEXT,
                case_id         TEXT,
                member_id       TEXT,
                requested_by    TEXT,
                tool_name       TEXT,
                tool_input      TEXT,
                risk_level      TEXT DEFAULT 'high',
                status          TEXT DEFAULT 'pending',
                adapter         TEXT DEFAULT 'internal',
                decided_by      TEXT,
                decision_reason TEXT,
                requested_at    TEXT,
                decided_at      TEXT,
                expires_at      TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS approval_audit_log (
                log_id      INTEGER PRIMARY KEY AUTOINCREMENT,
                approval_id TEXT,
                event_type  TEXT,
                actor       TEXT,
                detail      TEXT,
                created_at  TEXT
            )
        """)
        conn.commit()


def create_approval(
    tenant_id: str,
    thread_id: str,
    tool_name: str,
    tool_input: Dict[str, Any],
    ctx: Dict[str, Any],
    risk_level: str = "high",
    timeout_minutes: int = 60,
) -> str:
    init_db()
    approval_id = f"appr-{uuid4().hex[:12]}"
    now = datetime.now(timezone.utc).isoformat()
    expires = (datetime.now(timezone.utc) + timedelta(minutes=timeout_minutes)).isoformat()

    with _conn() as conn:
        conn.execute(
            """INSERT INTO approvals
               (approval_id, tenant_id, thread_id, assessment_id, case_id, member_id,
                requested_by, tool_name, tool_input, risk_level, status, adapter,
                requested_at, expires_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                approval_id,
                tenant_id,
                thread_id,
                ctx.get("assessment_id"),
                ctx.get("case_id"),
                ctx.get("member_id"),
                ctx.get("user_id") or ctx.get("agent_id") or "nurse",
                tool_name,
                json.dumps(tool_input),
                risk_level,
                "pending",
                "internal",
                now,
                expires,
            ),
        )
        conn.execute(
            "INSERT INTO approval_audit_log (approval_id, event_type, actor, detail, created_at) VALUES (?,?,?,?,?)",
            (approval_id, "requested", ctx.get("user_id", "nurse"), json.dumps({"tool": tool_name}), now),
        )
        conn.commit()

    return approval_id


def get_approval(approval_id: str) -> Optional[Dict[str, Any]]:
    init_db()
    with _conn() as conn:
        row = conn.execute(
            "SELECT * FROM approvals WHERE approval_id = ?", (approval_id,)
        ).fetchone()
    if not row:
        return None
    return _row_to_dict(row)


def list_pending(tenant_id: Optional[str] = None) -> List[Dict[str, Any]]:
    init_db()
    with _conn() as conn:
        if tenant_id:
            rows = conn.execute(
                "SELECT * FROM approvals WHERE status = 'pending' AND tenant_id = ? ORDER BY requested_at DESC",
                (tenant_id,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM approvals WHERE status = 'pending' ORDER BY requested_at DESC"
            ).fetchall()
    return [_row_to_dict(r) for r in rows]


def list_all(tenant_id: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
    init_db()
    with _conn() as conn:
        if tenant_id:
            rows = conn.execute(
                "SELECT * FROM approvals WHERE tenant_id = ? ORDER BY requested_at DESC LIMIT ?",
                (tenant_id, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM approvals ORDER BY requested_at DESC LIMIT ?", (limit,)
            ).fetchall()
    return [_row_to_dict(r) for r in rows]


def decide(
    approval_id: str,
    decision: str,
    decided_by: str,
    reason: str,
) -> Optional[Dict[str, Any]]:
    init_db()
    now = datetime.now(timezone.utc).isoformat()
    with _conn() as conn:
        conn.execute(
            """UPDATE approvals SET status=?, decided_by=?, decision_reason=?, decided_at=?
               WHERE approval_id=? AND status='pending'""",
            (decision, decided_by, reason, now, approval_id),
        )
        conn.execute(
            "INSERT INTO approval_audit_log (approval_id, event_type, actor, detail, created_at) VALUES (?,?,?,?,?)",
            (approval_id, decision, decided_by, json.dumps({"reason": reason}), now),
        )
        conn.commit()
    return get_approval(approval_id)


def log_event(approval_id: str, event_type: str, actor: str, detail: Dict[str, Any]):
    init_db()
    now = datetime.now(timezone.utc).isoformat()
    with _conn() as conn:
        conn.execute(
            "INSERT INTO approval_audit_log (approval_id, event_type, actor, detail, created_at) VALUES (?,?,?,?,?)",
            (approval_id, event_type, actor, json.dumps(detail), now),
        )
        conn.commit()


def _row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
    d = dict(row)
    if d.get("tool_input"):
        try:
            d["tool_input"] = json.loads(d["tool_input"])
        except Exception:
            pass
    return d
