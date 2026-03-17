from pydantic import BaseModel, Field
from typing import Any, Dict, Optional


class ToolRequest(BaseModel):
    # “AgentCore-style” request envelope (you can map AgentCore fields later)
    tool_name: str = Field(..., description="Tool name requested by agent")
    input: Dict[str, Any] = Field(default_factory=dict, description="Tool input payload")
    tenant_id: Optional[str] = Field(default=None, description="Tenant context")
    user_id: Optional[str] = Field(default=None, description="User context")
    correlation_id: Optional[str] = Field(default=None, description="Trace/correlation id")


class ToolResponse(BaseModel):
    tool_name: str
    ok: bool
    output: Dict[str, Any] = Field(default_factory=dict)
    error: Optional[Dict[str, Any]] = None
