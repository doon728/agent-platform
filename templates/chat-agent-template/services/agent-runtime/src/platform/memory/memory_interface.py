from __future__ import annotations

from typing import Any, Dict, List


class MemoryService:
    def get_history(
        self,
        *,
        scope: str,
        tenant_id: str,
        key: str,
    ) -> List[Dict[str, Any]]:
        raise NotImplementedError

    def append(
        self,
        *,
        scope: str,
        tenant_id: str,
        key: str,
        role: str,
        content: str,
    ) -> None:
        raise NotImplementedError
