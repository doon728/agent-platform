from __future__ import annotations

import os
from typing import Any, Dict, Optional

import requests


class ToolGatewayClient:
    def __init__(
        self,
        *,
        base_url: Optional[str] = None,
        contract_version: Optional[str] = None,
        timeout_s: int = 10,
    ) -> None:
        self.base_url = (base_url or os.getenv("TOOL_GATEWAY_URL", "http://host.docker.internal:8080")).rstrip("/")
        self.contract_version = contract_version or os.getenv("CONTRACT_VERSION", "v1")
        self.timeout_s = timeout_s

    def invoke(self, *, tool_name: str, tool_input: Dict[str, Any], ctx: Dict[str, Any]) -> Dict[str, Any]:
        payload = {
            "contract_version": self.contract_version,
            "tool_name": tool_name,
            "input": tool_input,
            "tenant_id": ctx.get("tenant_id"),
            "user_id": ctx.get("user_id"),
            "thread_id": ctx.get("thread_id"),
            "case_id": ctx.get("case_id"),
            "correlation_id": ctx.get("correlation_id"),
        }

        r = requests.post(
            f"{self.base_url}/tools/invoke",
            json=payload,
            timeout=self.timeout_s,
        )
        r.raise_for_status()
        body = r.json()

        if body.get("contract_version") != self.contract_version:
            raise RuntimeError("Tool Gateway contract version mismatch")

        if not body.get("ok", False):
            err = body.get("error") or {}
            raise RuntimeError(err.get("message") or "Tool call failed")

        return body.get("output") or {}