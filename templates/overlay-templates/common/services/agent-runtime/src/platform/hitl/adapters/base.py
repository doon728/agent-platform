from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict


class HITLAdapter(ABC):
    """Abstract adapter for HITL approval routing.
    Implement this to plug in Pega, ServiceNow, or any external workflow engine.
    """

    @abstractmethod
    def submit_request(
        self,
        tool_name: str,
        tool_input: Dict[str, Any],
        ctx: Dict[str, Any],
        risk_level: str = "high",
    ) -> str:
        """Save approval request. Returns approval_id."""
        ...

    @abstractmethod
    def get_status(self, approval_id: str) -> Dict[str, Any]:
        """Return current approval record."""
        ...
