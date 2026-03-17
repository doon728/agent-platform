from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from src.tools.registry import TOOL_REGISTRY

app = FastAPI(title="Tool Gateway", version="v1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class InvokeRequest(BaseModel):
    contract_version: str
    tool_name: str
    input: dict
    tenant_id: str | None = None
    user_id: str | None = None
    correlation_id: str | None = None


@app.get("/health")
def health():
    return {"ok": True, "service": "tool-gateway", "version": "v1"}


@app.get("/tools/specs")
def tool_specs():
    tools = []

    for spec in TOOL_REGISTRY.values():
        tools.append(
            {
                "name": spec.name,
                "description": spec.description,
                "primary_arg": spec.primary_arg,
                "mode": spec.mode,
                "tags": spec.tags,
            }
        )

    return {
        "ok": True,
        "contract_version": "v1",
        "tools": tools,
    }


@app.post("/tools/invoke")
def invoke_tool(req: InvokeRequest):
    spec = TOOL_REGISTRY.get(req.tool_name)
    if spec is None:
        return {
            "ok": False,
            "error": {
                "code": "UNKNOWN_TOOL",
                "message": f"Unknown tool: {req.tool_name}",
            },
        }

    try:
        inp = spec.input_model(**req.input)
        out = spec.handler(inp)
        return {
            "ok": True,
            "tool_name": req.tool_name,
            "output": out.model_dump() if hasattr(out, "model_dump") else out,
            "error": None,
        }
    except Exception as e:
        return {
            "ok": False,
            "tool_name": req.tool_name,
            "output": None,
            "error": {
                "code": "TOOL_EXECUTION_ERROR",
                "message": str(e),
            },
        }