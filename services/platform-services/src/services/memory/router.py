from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from platform_core.memory.backend_factory import get_backend
from platform_core.memory.config_loader import load_memory_config
from platform_core.memory.context_builder import build_memory_context
from platform_core.memory.scope_resolver import resolve_scopes
from platform_core.memory.summary_engine import maybe_write_conversation_summary
from platform_core.memory.write_engine import (
    write_episodic_event,
    write_raw_turns,
    write_semantic_memories,
)

router = APIRouter()


@router.post("/read")
async def memory_read(payload: dict) -> JSONResponse:
    """
    Pre-graph memory read.

    Input:
      ctx         : request context (tenant_id, thread_id, scope IDs, domain, ...)
      usecase_cfg : full agent config dict (from /config/agent/{agent_type})

    Output:
      memory_cfg     : resolved memory config
      active_scopes  : list of resolved scope dicts
      memory_context : {recent_turns, episodic, semantic, summaries}
    """
    ctx = payload.get("ctx") or {}
    usecase_cfg = payload.get("usecase_cfg") or {}
    tenant_id = ctx.get("tenant_id") or "default-tenant"
    domain = ctx.get("domain") or usecase_cfg.get("domain") or {}

    memory_cfg = load_memory_config(usecase_cfg)
    active_scopes = resolve_scopes(ctx, memory_cfg)
    memory_context = build_memory_context(
        active_scopes,
        memory_cfg,
        tenant_id=tenant_id,
        domain=domain,
    )

    return JSONResponse({
        "ok": True,
        "memory_cfg": memory_cfg,
        "active_scopes": active_scopes,
        "memory_context": memory_context,
    })


@router.post("/write")
async def memory_write(payload: dict) -> JSONResponse:
    """
    Post-graph memory write.

    Input:
      prompt             : user prompt text
      response           : assistant response text
      ctx                : request context
      memory_cfg         : memory config (from /memory/read response)
      active_scopes      : resolved scopes (from /memory/read response)
      memory_policy_state: {short_term, episodic, semantic, summary} booleans
      planner_trace      : planner trace dict (used for episodic trigger)
      usecase_cfg        : full agent config dict
    """
    ctx = payload.get("ctx") or {}
    prompt = payload.get("prompt") or ""
    response = payload.get("response") or ""
    memory_cfg = payload.get("memory_cfg") or {}
    active_scopes = payload.get("active_scopes") or []
    memory_policy_state = payload.get("memory_policy_state") or {}
    planner_trace = payload.get("planner_trace") or {}
    usecase_cfg = payload.get("usecase_cfg") or {}

    tenant_id = ctx.get("tenant_id") or "default-tenant"
    thread_id = ctx.get("thread_id") or "default-thread"
    domain = ctx.get("domain") or {}

    run_id = ctx.get("run_id") or ""
    agent_type = ctx.get("agent_type") or ""
    reasoning_strategy = ctx.get("reasoning_strategy") or "simple"

    memory_store = get_backend(memory_cfg)

    # Build scope metadata for writes
    _PLATFORM_ID_KEYS = {"tenant_id", "user_id", "thread_id", "correlation_id", "run_id"}
    scope_metadata: dict = {}
    domain_scopes = domain.get("scopes") or []
    if domain_scopes:
        for s in domain_scopes:
            id_field = s.get("id_field") or ""
            if id_field and ctx.get(id_field):
                scope_metadata[id_field] = ctx[id_field]
    else:
        for k, v in ctx.items():
            if k.endswith("_id") and k not in _PLATFORM_ID_KEYS and v:
                scope_metadata[k] = v

    audit_metadata = {
        "agent_type": agent_type,
        "reasoning_strategy": reasoning_strategy,
        "turn_id": run_id,
        "thread_id": thread_id,
        "tenant_id": tenant_id,
    }

    write_policies = memory_cfg.get("write_policies") or {}
    written: dict = {}
    skipped: dict = {}

    # Short-term
    if memory_policy_state.get("short_term", False):
        short_term_cfg = (write_policies.get("short_term") or {})
        write_raw_turns(
            store=memory_store,
            tenant_id=tenant_id,
            thread_id=thread_id,
            user_prompt=prompt,
            assistant_response=response,
            metadata={**scope_metadata, **audit_metadata},
            short_term_cfg=short_term_cfg,
        )
        written["short_term"] = {"status": "written", "trigger": "every_turn"}
    else:
        skipped["short_term"] = {"reason": "policy_disabled"}

    # Summary
    maybe_write_conversation_summary(
        store=memory_store,
        tenant_id=tenant_id,
        thread_id=thread_id,
        memory_cfg=memory_cfg,
    )
    summary_cfg = (write_policies.get("summary") or {})
    if summary_cfg.get("enabled", False):
        written["summary"] = {"status": "evaluated", "trigger": summary_cfg.get("triggers") or {}}
    else:
        skipped["summary"] = {"reason": "policy_disabled"}

    # Episodic — triggered by write-mode tool calls
    episodic_cfg = (write_policies.get("episodic") or {})
    if episodic_cfg.get("enabled", False) and memory_policy_state.get("episodic", False):
        _tool_used = planner_trace.get("tool", "")
        _is_write_tool = False
        if _tool_used:
            try:
                from platform_core.tools.registry import registry as _reg
                _spec = _reg.get_spec(_tool_used)
                _is_write_tool = (_spec.mode == "write")
            except Exception:
                pass

        is_approval_required = (response or "").startswith("[APPROVAL_REQUIRED]")
        if _is_write_tool and not is_approval_required:
            write_episodic_event(
                store=memory_store,
                tenant_id=tenant_id,
                scopes=active_scopes,
                content=f"User asked: {prompt}\nAssistant answered: {response}",
                metadata={**scope_metadata, **audit_metadata, "source": "tool_success", "tool": _tool_used},
                episodic_cfg=episodic_cfg,
                domain=domain,
            )
            written["episodic"] = {"status": "written", "trigger": "tool_success", "tool": _tool_used}
        else:
            skipped["episodic"] = {"reason": f"trigger not met (tool={_tool_used or 'none'})"}
    else:
        skipped["episodic"] = {"reason": "policy_disabled"}

    # Semantic
    semantic_cfg = (write_policies.get("semantic") or {})
    if semantic_cfg.get("enabled", False) and memory_policy_state.get("semantic", False):
        write_semantic_memories(
            store=memory_store,
            tenant_id=tenant_id,
            ctx=ctx,
            memory_cfg=memory_cfg,
            prompt=prompt,
            response=response,
            audit_metadata=audit_metadata,
        )
        written["semantic"] = {"status": "written", "trigger": semantic_cfg.get("trigger")}
    else:
        skipped["semantic"] = {"reason": "policy_disabled"}

    return JSONResponse({"ok": True, "written": written, "skipped": skipped})
