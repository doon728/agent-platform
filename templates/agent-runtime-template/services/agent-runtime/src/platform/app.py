from __future__ import annotations

import traceback
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from dotenv import load_dotenv

from src.platform.config import load_config
from src.platform.context import build_context
from src.platform.auth import authenticate_request
from src.platform.authorization import enforce_tenant_isolation
from src.platform.tools.bootstrap import register_tools
from src.platform.tools.discovery import load_tools_from_gateway
from src.platform.tools.registry import registry
from src.platform.observability.tracer import list_traces
from src.platform.usecase_contract import execute

load_dotenv()

# Load config
cfg = load_config()
register_tools()
load_tools_from_gateway()

print(
    f"[config] active_usecase={cfg.app.active_usecase} "
    f"tool_gateway_url={cfg.tool_gateway.url}",
    flush=True,
)

app = FastAPI(title="Agent Runtime", version="v1")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "agent-runtime", "version": "v1"}


@app.get("/traces")
def traces() -> dict:
    return {"ok": True, "traces": list_traces()}


@app.get("/traces/latest")
def traces_latest() -> dict:
    traces = list_traces()
    if not traces:
        return {"ok": True, "trace": None}
    return {"ok": True, "trace": traces[0]}


@app.post("/invocations")
async def invocations(request: Request) -> JSONResponse:
    auth = authenticate_request(request)

    try:
        payload = await request.json()
    except Exception:
        payload = {}

    if not isinstance(payload, dict):
        payload = {}

    ctx = build_context(request, payload)
    ctx["run_id"] = f"run_{uuid4().hex[:8]}"
    ctx["prompt"] = payload.get("prompt") or payload.get("text") or payload.get("message") or ""

    print(
        f"[ctx] run={ctx.get('run_id')} tenant={ctx.get('tenant_id')} "
        f"user={ctx.get('user_id')} thread={ctx.get('thread_id')} "
        f"corr={ctx.get('correlation_id')}",
        flush=True,
    )

    try:
        enforce_tenant_isolation(ctx, auth)
    except PermissionError as e:
        return JSONResponse(
            status_code=403,
            content={
                "ok": False,
                "error": {"code": "FORBIDDEN", "message": str(e)},
                "correlation_id": ctx.get("correlation_id"),
            },
        )

    prompt = payload.get("prompt") or payload.get("text") or payload.get("message") or ""
    if not prompt:
        prompt = "hello"

    try:
        result = execute(prompt, ctx)
    except Exception as e:
        print("❌ RUNTIME_ERROR traceback below:", flush=True)
        print(traceback.format_exc(), flush=True)

        return JSONResponse(
            status_code=200,
            content={
                "ok": False,
                "error": {"code": "RUNTIME_ERROR", "message": str(e)},
                "correlation_id": ctx.get("correlation_id"),
            },
        )

    if isinstance(result, dict):
        if "answer" in result:
            out = {"answer": result["answer"]}
        elif "nurse_summary" in result:
            out = {"answer": result["nurse_summary"]}
        else:
            out = result
    else:
        out = {"answer": str(result)}

    return JSONResponse(
        status_code=200,
        content={"ok": True, "output": out, "correlation_id": ctx.get("correlation_id")},
    )


@app.post("/approvals/resume")
async def approvals_resume(payload: dict):
    approved = payload.get("approved", False)
    tool_name = payload.get("tool_name")
    tool_input = payload.get("tool_input") or {}
    ctx = payload.get("ctx") or {}

    if not approved:
        return {"ok": True, "output": {"result": "CANCELLED"}}

    result = registry.invoke_approved(tool_name, tool_input, ctx)
    return {"ok": True, "output": {"result": result}}