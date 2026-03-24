from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from src.tools.registry import TOOL_REGISTRY
from src.data.pg_store import store

app = FastAPI(title="Tool Gateway", version="v1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
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


# ── Domain Context REST endpoints (called directly from UI) ───────────────────

@app.get("/members")
def search_members(q: str = ""):
    members = store().search_members(q, limit=20)
    return {"ok": True, "members": members}


@app.get("/members/{member_id}")
def get_member(member_id: str):
    result = store().get_member_summary(member_id)
    if not result.get("found"):
        return {"ok": False, "error": "Member not found"}
    return {"ok": True, "member": result}


@app.get("/members/{member_id}/cases")
def get_member_cases(member_id: str):
    cases = store().get_member_cases(member_id)
    return {"ok": True, "cases": cases}


@app.get("/cases/{case_id}")
def get_case(case_id: str):
    case = store().get_case(case_id)
    if not case:
        return {"ok": False, "error": "Case not found"}
    return {"ok": True, "case": case}


@app.get("/cases/{case_id}/assessments")
def get_case_assessments(case_id: str):
    assessments = store().get_case_assessments(case_id)
    return {"ok": True, "assessments": assessments}


@app.get("/assessments/{assessment_id}")
def get_assessment(assessment_id: str):
    result = store().get_assessment_summary(assessment_id)
    if not result.get("found"):
        return {"ok": False, "error": "Assessment not found"}
    return {"ok": True, "assessment": result}


@app.get("/assessments/{assessment_id}/tasks")
def get_assessment_tasks(assessment_id: str):
    tasks = store().get_assessment_tasks(assessment_id)
    return {"ok": True, "tasks": tasks}


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