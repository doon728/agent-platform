from __future__ import annotations

from typing import Any, Dict

from src.platform.hitl.adapters.base import HITLAdapter
from src.platform.hitl import approval_store


class InternalAdapter(HITLAdapter):
    """Internal approval queue backed by SQLite.
    Supervisor reviews via Approval Console UI.
    Swap for PegaAdapter or ServiceNowAdapter with zero agent code changes.
    """

    def submit_request(
        self,
        tool_name: str,
        tool_input: Dict[str, Any],
        ctx: Dict[str, Any],
        risk_level: str = "high",
    ) -> str:
        return approval_store.create_approval(
            tenant_id=ctx.get("tenant_id", "default"),
            thread_id=ctx.get("thread_id", ""),
            tool_name=tool_name,
            tool_input=tool_input,
            ctx=ctx,
            risk_level=risk_level,
        )

    def get_status(self, approval_id: str) -> Dict[str, Any]:
        return approval_store.get_approval(approval_id) or {}
