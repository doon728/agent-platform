from __future__ import annotations

# Container 1 — Agent Runtime Shell.
# Thin FastAPI entrypoint: auth, context, HITL state, and HTTP client orchestration.
# All business logic lives in Container 2 (platform-services).

import traceback
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from src.platform.langgraph_runner import LangGraphRunner

load_dotenv()

# HITL approval store lives here — Container 1 owns local approval state
from platform_core.hitl import approval_store
from platform_core.hitl.memory_writer import write_hitl_decision, write_hitl_tool_executed
from platform_core.auth import authenticate_request
from platform_core.authorization import enforce_tenant_isolation
from platform_core.context import build_context

approval_store.init_db()

app = FastAPI(title="Agent Runtime Shell", version="v1")
_runner = LangGraphRunner()


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "agent-runtime-shell", "version": "v1"}


@app.get("/config/scopes")
def config_scopes() -> JSONResponse:
    """Return domain scope definitions. Used by the UI to render context input fields."""
    from src.clients import config_client
    domain = config_client.get_domain_config()
    scopes = domain.get("scopes") or []
    return JSONResponse({
        "ok": True,
        "capability": domain.get("capability"),
        "capability_name": domain.get("name"),
        "scopes": [
            {"name": s.get("name"), "id_field": s.get("id_field"), "parent": s.get("parent")}
            for s in scopes
        ],
    })


@app.get("/config-flags")
def config_flags() -> JSONResponse:
    """Return feature flags for the UI to lock/unlock toggles."""
    import os
    from src.clients import config_client
    agent_type = os.getenv("AGENT_TYPE", "chat_agent")
    agent_cfg = config_client.get_agent_config(agent_type)
    return JSONResponse({
        "ok": True,
        "memory_enabled": bool((agent_cfg.get("memory") or {}).get("enabled", True)),
        "hitl_enabled": bool((agent_cfg.get("risk") or {}).get("approval_required", False)),
    })


@app.get("/traces")
def traces() -> JSONResponse:
    from src.clients.base import get
    resp = get("/observability/traces")
    return JSONResponse({"ok": True, "traces": resp.get("traces") or []})


@app.get("/traces/latest")
def traces_latest() -> JSONResponse:
    from src.clients.base import get
    resp = get("/observability/traces/latest")
    return JSONResponse({"ok": True, "trace": resp.get("trace")})


def _hydrate_active_domain_context(ctx: dict) -> dict:
    """Patch missing scope IDs into ctx by reading recent thread history."""
    from src.clients import config_client
    domain = config_client.get_domain_config()
    scopes = domain.get("scopes") or []

    if scopes and all(ctx.get(s.get("id_field") or "") for s in scopes):
        return ctx

    thread_id = ctx.get("thread_id")
    tenant_id = ctx.get("tenant_id") or "default-tenant"
    if not thread_id or not scopes:
        return ctx

    try:
        from platform_core.memory.backend_factory import get_backend
        store = get_backend({})
        recent = store.list_recent_turns(tenant_id=tenant_id, thread_id=thread_id, max_turns=12)
        for scope in scopes:
            id_field = scope.get("id_field") or ""
            if not id_field or ctx.get(id_field):
                continue
            for record in reversed(recent):
                candidate = (record.get("metadata") or {}).get(id_field)
                if candidate:
                    ctx[id_field] = candidate
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
    ctx = _hydrate_active_domain_context(ctx)

    try:
        enforce_tenant_isolation(ctx, auth)
    except PermissionError as e:
        return JSONResponse(status_code=403, content={
            "ok": False, "error": {"code": "FORBIDDEN", "message": str(e)},
            "correlation_id": ctx.get("correlation_id"),
        })

    prompt = ctx.get("prompt") or "hello"

    try:
        result = _runner.run(prompt, ctx)
    except Exception as e:
        print("❌ RUNTIME_ERROR:", traceback.format_exc(), flush=True)
        return JSONResponse(status_code=200, content={
            "ok": False,
            "error": {"code": "RUNTIME_ERROR", "message": str(e)},
            "correlation_id": ctx.get("correlation_id"),
        })

    out = result if isinstance(result, dict) else {"answer": str(result)}
    return JSONResponse(status_code=200, content={
        "ok": True, "output": out, "correlation_id": ctx.get("correlation_id"),
    })


@app.post("/chat")
async def chat(request: Request) -> JSONResponse:
    """Alias for /invocations with a simplified response shape for the chat UI."""
    auth = authenticate_request(request)
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}

    ctx = build_context(request, payload)
    ctx["run_id"] = f"run_{uuid4().hex[:8]}"
    ctx = _hydrate_active_domain_context(ctx)

    prompt = payload.get("prompt") or payload.get("text") or payload.get("message") or "hello"

    try:
        result = _runner.run(prompt, ctx)
        answer = result.get("answer") if isinstance(result, dict) else str(result)
        if isinstance(answer, dict):
            answer = answer.get("answer") or str(answer)
        return JSONResponse({"ok": True, "answer": answer, "memory_trace": result.get("memory_trace")})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)})


# ── HITL endpoints — approval state lives in Container 1 ─────────────────────

@app.get("/hitl/pending")
def hitl_pending(tenant_id: str = None) -> JSONResponse:
    pending = approval_store.list_pending(tenant_id=tenant_id)
    return JSONResponse({"ok": True, "pending": pending, "count": len(pending)})


@app.get("/hitl/status/{approval_id}")
def hitl_status(approval_id: str) -> JSONResponse:
    record = approval_store.get_approval(approval_id)
    if not record:
        return JSONResponse(status_code=404, content={"ok": False, "error": "Not found"})
    return JSONResponse({"ok": True, "approval": record})


@app.post("/hitl/decide")
async def hitl_decide(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"ok": False, "error": "Invalid JSON"})

    approval_id = payload.get("approval_id")
    decision = payload.get("decision")
    reason = payload.get("reason", "")
    decided_by = payload.get("decided_by", "supervisor")

    if not approval_id or decision not in ("approved", "rejected"):
        return JSONResponse(status_code=400, content={
            "ok": False, "error": "approval_id and decision (approved|rejected) required",
        })

    record = approval_store.get_approval(approval_id)
    if not record:
        return JSONResponse(status_code=404, content={"ok": False, "error": "Approval not found"})
    if record.get("status") != "pending":
        return JSONResponse(status_code=409, content={
            "ok": False, "error": f"Approval already {record.get('status')}",
        })

    approval_store.decide(approval_id, decision, decided_by, reason)

    tool_result = None
    if decision == "approved":
        try:
            from src.clients import tools_client
            tool_result = tools_client.invoke(
                tool_name=record["tool_name"],
                tool_input=record["tool_input"] if isinstance(record["tool_input"], dict) else {},
                ctx={"tenant_id": record.get("tenant_id")},
                bypass_hitl=True,
            )
            approval_store.log_event(approval_id, "tool_executed", "system", {"result": str(tool_result)})
        except Exception as e:
            approval_store.log_event(approval_id, "tool_execution_failed", "system", {"error": str(e)})
            return JSONResponse(status_code=500, content={"ok": False, "error": f"Tool execution failed: {e}"})

    try:
        ctx = {
            "tenant_id": record.get("tenant_id"),
            "thread_id": record.get("thread_id"),
            "assessment_id": record.get("assessment_id"),
            "case_id": record.get("case_id"),
            "member_id": record.get("member_id"),
            "user_id": record.get("requested_by"),
        }
        write_hitl_decision(
            approval_id=approval_id,
            tool_name=record["tool_name"],
            decision=decision,
            decided_by=decided_by,
            reason=reason,
            tool_result=tool_result,
            ctx=ctx,
        )
        if decision == "approved" and tool_result is not None:
            write_hitl_tool_executed(
                tool_name=record["tool_name"],
                tool_input=record["tool_input"] if isinstance(record["tool_input"], dict) else {},
                tool_result=tool_result,
                ctx=ctx,
            )
        approval_store.log_event(approval_id, "memory_written", "system", {})
    except Exception as e:
        print(f"[hitl] memory write failed: {e}", flush=True)

    return JSONResponse({"ok": True, "approval_id": approval_id, "decision": decision, "tool_result": tool_result})


@app.get("/hitl/history")
def hitl_history(tenant_id: str = None, limit: int = 50) -> JSONResponse:
    records = approval_store.list_all(tenant_id=tenant_id, limit=limit)
    return JSONResponse({"ok": True, "history": records, "count": len(records)})
