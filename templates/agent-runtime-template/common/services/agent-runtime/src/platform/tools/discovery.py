from __future__ import annotations

import os
from typing import Any, Dict

import requests

from src.platform.tools.registry import ToolSpec, registry

TOOL_GATEWAY_URL = os.getenv("TOOL_GATEWAY_URL", "http://host.docker.internal:8080")


def load_tools_from_gateway() -> None:
    """
    1) GET tool specs from tool-gateway (/tools/specs)
    2) Register each tool in the agent-runtime registry with a handler
       that POSTs to tool-gateway (/tools/invoke)
    """
    r = requests.get(f"{TOOL_GATEWAY_URL}/tools/specs", timeout=5)
    data = r.json()

    if not data.get("ok"):
        raise RuntimeError(f"Failed to load tool specs: {data}")

    contract_version = data.get("contract_version", "v1")
    tools = data.get("tools", [])

    for t in tools:
        name = t["name"]
        description = t.get("description", "")
        primary_arg = t.get("primary_arg", "query")
        tags = t.get("tags", []) or []
        mode = t.get("mode", "read")

        def make_handler(tool_name: str):
            def handler(tool_input: Dict[str, Any], ctx: Dict[str, Any]) -> Dict[str, Any]:
                payload = {
                    "contract_version": contract_version,
                    "tool_name": tool_name,
                    "input": tool_input,
                    "tenant_id": ctx.get("tenant_id"),
                    "user_id": ctx.get("user_id"),
                    "correlation_id": ctx.get("correlation_id"),
                }
                resp = requests.post(
                    f"{TOOL_GATEWAY_URL}/tools/invoke",
                    json=payload,
                    timeout=10,
                ).json()

                if not resp.get("ok"):
                    raise RuntimeError(resp.get("error", {}).get("message", "Tool gateway error"))

                return resp.get("output") or {}

            return handler

        registry.register(
            ToolSpec(
                name=name,
                description=description,
                input_schema={"type": "object"},
                handler=make_handler(name),
                mode=mode,
                primary_arg=primary_arg,
                tags=tags,
            )
        )

        print(f"[discovery] registered tool: {name} tags={tags}")