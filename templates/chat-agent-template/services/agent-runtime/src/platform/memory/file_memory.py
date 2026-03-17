from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List

from src.platform.memory.memory_interface import MemoryService


STATE_ROOT = Path(
    os.getenv(
        "STATE_ROOT",
        str(Path(__file__).resolve().parents[4] / "state"),
    )
)

THREAD_FILE = STATE_ROOT / "chat_threads.jsonl"
CASE_FILE = STATE_ROOT / "case_memory.jsonl"


def _ensure_file(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text("")


class FileMemoryService(MemoryService):
    def _file_for_scope(self, scope: str) -> Path:
        if scope == "thread":
            return THREAD_FILE
        if scope == "case":
            return CASE_FILE
        raise RuntimeError(f"Unsupported memory scope: {scope}")

    def get_history(
        self,
        *,
        scope: str,
        tenant_id: str,
        key: str,
    ) -> List[Dict[str, Any]]:
        path = self._file_for_scope(scope)
        _ensure_file(path)

        history: List[Dict[str, Any]] = []
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                row = json.loads(line)
                if row.get("tenant_id") == tenant_id and row.get("key") == key:
                    history.append(row["message"])
        return history

    def append(
        self,
        *,
        scope: str,
        tenant_id: str,
        key: str,
        role: str,
        content: str,
    ) -> None:
        path = self._file_for_scope(scope)
        _ensure_file(path)

        with path.open("a", encoding="utf-8") as f:
            f.write(
                json.dumps(
                    {
                        "scope": scope,
                        "tenant_id": tenant_id,
                        "key": key,
                        "message": {
                            "role": role,
                            "content": content,
                        },
                    }
                )
                + "\n"
            )


class AgentCoreMemoryService(MemoryService):
    def get_history(
        self,
        *,
        scope: str,
        tenant_id: str,
        key: str,
    ) -> List[Dict[str, Any]]:
        raise RuntimeError("AgentCore memory backend not implemented yet")

    def append(
        self,
        *,
        scope: str,
        tenant_id: str,
        key: str,
        role: str,
        content: str,
    ) -> None:
        raise RuntimeError("AgentCore memory backend not implemented yet")


_service: MemoryService | None = None


def get_memory_service() -> MemoryService:
    global _service
    if _service is not None:
        return _service

    backend = (os.getenv("MEMORY_BACKEND", "local") or "local").strip().lower()

    if backend == "local":
        _service = FileMemoryService()
        return _service

    if backend == "agentcore":
        _service = AgentCoreMemoryService()
        return _service

    raise RuntimeError(f"Unknown MEMORY_BACKEND: {backend}")


def load_thread(thread_id: str) -> List[Dict[str, Any]]:
    svc = get_memory_service()
    return svc.get_history(scope="thread", tenant_id="t1", key=thread_id)


def append_thread_message(thread_id: str, role: str, content: str) -> None:
    svc = get_memory_service()
    svc.append(scope="thread", tenant_id="t1", key=thread_id, role=role, content=content)