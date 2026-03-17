# services/tool-gateway/src/contract.py
from __future__ import annotations

from typing import Any, Dict, Optional, TypedDict

CONTRACT_VERSION = "v1"


class ToolError(TypedDict, total=False):
    code: str
    message: str


class ToolInvokeRequest(TypedDict, total=False):
    contract_version: str
    tool_name: str
    input: Dict[str, Any]
    tenant_id: Optional[str]
    user_id: Optional[str]
    correlation_id: Optional[str]


class ToolInvokeResponse(TypedDict, total=False):
    contract_version: str
    tool_name: str
    ok: bool
    output: Optional[Dict[str, Any]]
    error: Optional[ToolError]


def ok_response(tool_name: str, output: Dict[str, Any]) -> ToolInvokeResponse:
    return {
        "contract_version": CONTRACT_VERSION,
        "tool_name": tool_name,
        "ok": True,
        "output": output,
        "error": None,
    }


def err_response(tool_name: str, code: str, message: str) -> ToolInvokeResponse:
    return {
        "contract_version": CONTRACT_VERSION,
        "tool_name": tool_name,
        "ok": False,
        "output": None,
        "error": {"code": code, "message": message},
    }
