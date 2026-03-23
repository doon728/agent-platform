from __future__ import annotations

import traceback
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from dotenv import load_dotenv

from src.platform.config import load_config
from src.platform.usecase_config_loader import load_usecase_config
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


@app.post("/debug/memory")
async def debug_memory(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
    except Exception:
        payload = {}

    if not isinstance(payload, dict):
        payload = {}

    ctx = build_context(request, payload)
    ctx["prompt"] = payload.get("prompt") or payload.get("text") or payload.get("message") or ""

    cfg = load_config()
    usecase_cfg = load_usecase_config(
        cfg.app.capability_name,
        cfg.app.active_usecase
    )

    from src.platform.memory.config_loader import load_memory_config
    from src.platform.memory.scope_resolver import resolve_scopes
    from src.platform.memory.context_builder import build_memory_context

    memory_cfg = load_memory_config(usecase_cfg)
    scopes = resolve_scopes(ctx, memory_cfg)

    memory_context = build_memory_context(
        scopes,
        memory_cfg,
        tenant_id=ctx.get("tenant_id") or "default-tenant",
    )

    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "active_usecase": cfg.app.active_usecase,
            "memory_config": memory_cfg,
            "resolved_scopes": scopes,
            "memory_context": memory_context,
        },
    )


def hydrate_active_domain_context(ctx: dict) -> dict:
    assessment_id = ctx.get("assessment_id")
    if assessment_id:
        return ctx

    thread_id = ctx.get("thread_id")
    tenant_id = ctx.get("tenant_id") or "default-tenant"

    if not thread_id:
        return ctx

    try:
        from src.platform.memory.memory_store import FileMemoryStore

        store = FileMemoryStore()
        recent = store.list_recent_turns(
            tenant_id=tenant_id,
            thread_id=thread_id,
            max_turns=12,
        )

        for record in reversed(recent):
            metadata = record.get("metadata") or {}
            candidate = metadata.get("assessment_id")
            if candidate:
                ctx["assessment_id"] = candidate
                break
    except Exception:
        pass

    return ctx


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
    ctx = hydrate_active_domain_context(ctx)

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