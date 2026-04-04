from __future__ import annotations

import traceback
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from dotenv import load_dotenv

from src.platform.config import load_config
from src.platform.usecase_config_loader import load_agent_config
from src.platform.context import build_context
from src.platform.auth import authenticate_request
from src.platform.authorization import enforce_tenant_isolation
from src.platform.tools.bootstrap import register_tools
from src.platform.tools.discovery import load_tools_from_gateway
from src.platform.tools.registry import registry
from src.platform.observability.tracer import list_traces
from src.platform.usecase_contract import execute
from src.platform.hitl import approval_store
from src.platform.hitl.memory_writer import write_hitl_decision, write_hitl_tool_executed

load_dotenv()

# Load config
cfg = load_config()
register_tools()
load_tools_from_gateway()
approval_store.init_db()

print(
    f"[config] agent_type={cfg.prompt_service.agent_type} "
    f"tool_gateway_url={cfg.tool_gateway.url}",
    flush=True,
)

app = FastAPI(title="Agent Runtime", version="v1")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "agent-runtime", "version": "v1"}


@app.get("/config-flags")
def config_flags() -> dict:
    """Return feature flags derived from the agent config. Used by the UI to lock/unlock toggles."""
    agent_cfg = load_agent_config(cfg.prompt_service.agent_type)
    memory_enabled = bool((agent_cfg.get("memory") or {}).get("enabled", True))
    hitl_enabled = bool((agent_cfg.get("risk") or {}).get("approval_required", False))
    return {
        "ok": True,
        "memory_enabled": memory_enabled,
        "hitl_enabled": hitl_enabled,
    }


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
    usecase_cfg = load_agent_config(cfg.prompt_service.agent_type)

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


@app.post("/summarize")
async def summarize_scope(request: Request) -> JSONResponse:
    """
    Generate (or return cached) an AI summary for a given scope.

    Body:
      scope_type   : "assessment" | "case" | "member"
      scope_id     : the ID of the scope (assessment_id, case_id, or member_id)
      tenant_id    : optional, defaults to "default-tenant"
      member_id    : required when scope_type is "case"
      force_refresh: optional bool, bypass cache and regenerate
    """
    import json
    from datetime import datetime, timezone, timedelta

    try:
        payload = await request.json()
    except Exception:
        payload = {}

    scope_type = payload.get("scope_type", "assessment")
    scope_id = payload.get("scope_id", "")
    tenant_id = payload.get("tenant_id") or "default-tenant"
    force_refresh = bool(payload.get("force_refresh", False))

    if not scope_id:
        return JSONResponse(status_code=400, content={"ok": False, "error": "scope_id is required"})

    if scope_type not in ("assessment", "case", "member"):
        return JSONResponse(status_code=400, content={"ok": False, "error": "scope_type must be assessment, case, or member"})

    CACHE_TTL_SECONDS = 1800  # 30 minutes

    from src.platform.memory.memory_store import FileMemoryStore
    store = FileMemoryStore()

    # Check cache
    if not force_refresh:
        records = store._read_records(tenant_id, scope_type, scope_id)
        cached = next((r for r in reversed(records) if r.get("memory_type") == "summary_cache"), None)
        if cached:
            try:
                created_at = datetime.fromisoformat(cached["created_at"])
                if datetime.now(timezone.utc) - created_at < timedelta(seconds=CACHE_TTL_SECONDS):
                    summary_data = json.loads(cached["content"]) if isinstance(cached["content"], str) else cached["content"]
                    return JSONResponse(content={
                        "ok": True,
                        "cached": True,
                        "generated_at": cached["created_at"],
                        **summary_data,
                    })
            except Exception:
                pass  # stale or corrupt cache — fall through to regenerate

    # Run the summary graph
    try:
        from overlays.summary_agent.orchestration.build_graph import build_graph

        ctx = {
            "tenant_id": tenant_id,
            "member_id": payload.get("member_id") or scope_id,
        }
        graph = build_graph()
        result = graph.invoke({"scope_type": scope_type, "scope_id": scope_id, "ctx": ctx})
        summary = result.get("summary") or {}
    except Exception as e:
        return JSONResponse(
            status_code=200,
            content={"ok": False, "error": f"Summary generation failed: {e}"},
        )

    # Cache result
    generated_at = datetime.now(timezone.utc).isoformat()
    try:
        store.replace_memory(
            tenant_id=tenant_id,
            memory_type="summary_cache",
            scope_type=scope_type,
            scope_id=scope_id,
            content=json.dumps(summary),
            metadata={"scope_type": scope_type, "scope_id": scope_id, "generated_at": generated_at},
        )
    except Exception:
        pass  # cache failure is non-fatal

    return JSONResponse(content={
        "ok": True,
        "cached": False,
        "generated_at": generated_at,
        **summary,
    })


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
        return JSONResponse(status_code=400, content={"ok": False, "error": "approval_id and decision (approved|rejected) required"})

    record = approval_store.get_approval(approval_id)
    if not record:
        return JSONResponse(status_code=404, content={"ok": False, "error": "Approval not found"})
    if record.get("status") != "pending":
        return JSONResponse(status_code=409, content={"ok": False, "error": f"Approval already {record.get('status')}"})

    # Update status in DB
    approval_store.decide(approval_id, decision, decided_by, reason)

    tool_result = None

    # If approved — execute the tool now
    if decision == "approved":
        try:
            tool_name = record["tool_name"]
            tool_input = record["tool_input"] if isinstance(record["tool_input"], dict) else {}
            tool_result = registry.invoke_approved(tool_name, tool_input, {})
            approval_store.log_event(approval_id, "tool_executed", "system", {"result": str(tool_result)})
        except Exception as e:
            approval_store.log_event(approval_id, "tool_execution_failed", "system", {"error": str(e)})
            return JSONResponse(status_code=500, content={"ok": False, "error": f"Tool execution failed: {e}"})

    # Write decision to episodic memory
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
        print(f"[hitl] memory write failed: {e}")

    return JSONResponse({
        "ok": True,
        "approval_id": approval_id,
        "decision": decision,
        "tool_result": tool_result,
    })


@app.get("/hitl/history")
def hitl_history(tenant_id: str = None, limit: int = 50) -> JSONResponse:
    records = approval_store.list_all(tenant_id=tenant_id, limit=limit)
    return JSONResponse({"ok": True, "history": records, "count": len(records)})


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