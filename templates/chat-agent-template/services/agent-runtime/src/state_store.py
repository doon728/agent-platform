# services/agent-runtime/src/state_store.py
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


STATE_ROOT = Path(os.getenv("STATE_ROOT", "/app/state"))
THREADS_DIR = STATE_ROOT / "threads"
APPROVALS_PATH = STATE_ROOT / "pending_approvals.jsonl"
APPROVAL_AUDIT_PATH = STATE_ROOT / "approval_audit.jsonl"


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _ensure_dirs() -> None:
    STATE_ROOT.mkdir(parents=True, exist_ok=True)
    THREADS_DIR.mkdir(parents=True, exist_ok=True)


def append_jsonl(path: Path, record: Dict[str, Any]) -> None:
    _ensure_dirs()
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")


def read_jsonl(path: Path, limit: Optional[int] = None) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    rows: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except Exception:
                continue
    if limit is not None and limit > 0:
        return rows[-limit:]
    return rows


# -------------------
# Thread persistence
# -------------------
def thread_path(thread_id: str) -> Path:
    _ensure_dirs()
    return THREADS_DIR / f"{thread_id}.jsonl"


def append_thread_turn(thread_id: str, record: Dict[str, Any]) -> None:
    record = {**record, "ts": _utc_now()}
    append_jsonl(thread_path(thread_id), record)


def read_thread(thread_id: str, limit: int = 50) -> List[Dict[str, Any]]:
    return read_jsonl(thread_path(thread_id), limit=limit)


# -------------------
# Approvals persistence
# -------------------
def upsert_pending_approval(approval_obj: Dict[str, Any]) -> None:
    """
    Persist the *latest* approval request to pending_approvals.jsonl.
    For MVP we simply append. Inbox reads last entry per correlation_id.
    """
    record = {
        "ts": _utc_now(),
        "status": "pending",
        **approval_obj,
    }
    append_jsonl(APPROVALS_PATH, record)


def list_pending_approvals(limit: int = 200) -> List[Dict[str, Any]]:
    """
    Return latest record per correlation_id where status == pending.
    """
    rows = read_jsonl(APPROVALS_PATH, limit=None)
    latest: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        cid = (r.get("ctx", {}) or {}).get("correlation_id") or r.get("correlation_id")
        if not cid:
            continue
        latest[cid] = r

    out = [v for v in latest.values() if v.get("status") == "pending"]
    out.sort(key=lambda x: x.get("ts", ""), reverse=True)
    return out[:limit]


def audit_approval(action: str, correlation_id: str, tool_name: str, tool_input: Dict[str, Any], ctx: Dict[str, Any], reviewer_id: str = "supervisor-001", reason: Optional[str] = None) -> None:
    record = {
        "ts": _utc_now(),
        "action": action,  # "approved" | "rejected"
        "correlation_id": correlation_id,
        "tool_name": tool_name,
        "tool_input": tool_input,
        "ctx": ctx,
        "reviewer_id": reviewer_id,
        "reason": reason,
    }
    append_jsonl(APPROVAL_AUDIT_PATH, record)