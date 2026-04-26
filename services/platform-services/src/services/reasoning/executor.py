from __future__ import annotations

# Generic executor — routes planner steps to tool calls.
# HITL-aware: returns NEEDS_HITL instead of submitting to approval_store.
# The calling service (Container 1) handles the actual approval submission.

from typing import Any, Dict, List

from platform_core.config import load_config
from platform_core.llm.responder import generate_answer
from platform_core.memory.backend_factory import get_backend
from platform_core.memory.write_engine import write_episodic_event
from platform_core.observability.tracer import add_step, finish_run, start_run
from platform_core.tools.registry import registry
from platform_core.tools.router import route_step

cfg = load_config()
USECASE = cfg.app.active_usecase


def _should_write_episodic(tool_name: str, ctx: Dict[str, Any]) -> bool:
    memory_cfg = ctx.get("memory") or {}
    episodic_cfg = ((memory_cfg.get("write_policies") or {}).get("episodic") or {})
    wotc = episodic_cfg.get("write_on_tool_call") or {}
    if not wotc.get("enabled", False):
        return False
    tools_setting = wotc.get("tools", "write_only")
    if tools_setting == "all":
        return True
    if tools_setting == "write_only":
        try:
            spec = registry.get_spec(tool_name)
            return getattr(spec, "mode", "read") == "write"
        except Exception:
            return False
    if isinstance(tools_setting, list):
        return tool_name in tools_setting
    return False


def _requires_approval(tool_name: str, ctx: Dict[str, Any]) -> bool:
    usecase_cfg = ctx.get("usecase_config") or {}
    risk_cfg = usecase_cfg.get("risk") or {}
    if not risk_cfg.get("approval_required", False):
        return False
    risk_levels = risk_cfg.get("risk_levels") or {}
    level = risk_levels.get(tool_name, "low")
    routing_rules = (usecase_cfg.get("hitl") or {}).get("routing_rules") or []
    for rule in routing_rules:
        if rule.get("risk_level") == level:
            return bool(rule.get("requires_approval", False))
    return level == "high"


def _invoke_tool(tool_name: str, tool_input: Dict[str, Any], ctx: Dict[str, Any], bypass_hitl: bool = False) -> Any:
    tool_policy = ctx.get("tool_policy") or {}
    mode = tool_policy.get("mode", "selected")
    allowed_tools = tool_policy.get("allowed_tools") or []
    if mode == "selected":
        if tool_name not in allowed_tools:
            raise RuntimeError(f"Tool '{tool_name}' is not allowed for this use case.")
    elif mode == "auto":
        allowed_tags = set(tool_policy.get("allowed_tags") or [])
        spec = registry.get_spec(tool_name)
        if allowed_tags and not allowed_tags.intersection(set(spec.tags or [])):
            raise RuntimeError(f"Tool '{tool_name}' is not allowed for this use case.")
    if bypass_hitl:
        return registry.invoke_approved(tool_name, tool_input, ctx)
    return registry.invoke(tool_name, tool_input, ctx)


def execute(steps: List[str], ctx: Dict[str, Any]) -> Any:
    """
    Execute a planner step (tool call).

    HITL: when a tool requires approval, returns:
      {"result": "NEEDS_HITL", "tool_name": ..., "tool_input": ..., "risk_level": ...}
    Container 1 is responsible for submitting this to its local approval_store.
    """
    step = (steps[0] if steps else "").strip()
    ctx = dict(ctx or {})
    ctx["prompt"] = step if not ctx.get("prompt") else ctx["prompt"]

    print(f"[executor] step={step}", flush=True)

    run_id = start_run(agent=USECASE, thread_id=ctx.get("thread_id"), prompt=ctx.get("prompt", ""))
    add_step(run_id, "planner", step)

    if not step:
        finish_run(run_id)
        return {"result": "OK", "answer": "No action planned."}

    plan = route_step(step, ctx, raw_prompt=ctx.get("prompt", step))
    mode = plan.get("mode")

    if plan.get("tool") == "direct_answer":
        add_step(run_id, "direct_answer", {"reason": "planner: no tool needed"})
        answer = generate_answer(ctx.get("prompt", step), None, None, ctx)
        finish_run(run_id)
        return {"result": "OK", "mode": "DIRECT_ANSWER", "answer": answer}

    if mode == "direct_tool":
        # Fix compound planner steps (tool: id | note)
        # Field is named `case_id` for legacy reasons but holds an assessment_id
        # — see WriteCaseNoteInput in tool-policy-gateway/src/tools/registry.py.
        if ":" in step and "|" in step:
            try:
                tool_part, rest = step.split(":", 1)
                assessment_part, note_part = rest.split("|", 1)
                if "input" not in plan:
                    plan["input"] = {}
                plan["input"]["case_id"] = assessment_part.strip()
                plan["input"]["note"] = note_part.strip()
            except Exception as e:
                print(f"[executor_fix_error] {e}", flush=True)

    if mode == "direct_tool":
        tool = plan["tool"]
        tool_input = plan["input"]

        # Inject RAG params from retrieval.planner_tool config
        retrieval_cfg = ctx.get("retrieval") or {}
        planner_tool_cfg = retrieval_cfg.get("planner_tool") or {}
        planner_tool_name = planner_tool_cfg.get("tool", "search_kb")
        if tool == planner_tool_name:
            if planner_tool_cfg.get("top_k") is not None:
                tool_input = {**tool_input, "top_k": planner_tool_cfg["top_k"]}
            if planner_tool_cfg.get("similarity_threshold") is not None:
                tool_input = {**tool_input, "threshold": planner_tool_cfg["similarity_threshold"]}
            if planner_tool_cfg.get("strategy") is not None:
                tool_input = {**tool_input, "strategy": planner_tool_cfg["strategy"]}

        _hitl_session_enabled = (ctx.get("hitl_override") or {}).get("enabled", True)

        # HITL check — return NEEDS_HITL instead of submitting to approval_store.
        # Container 1 handles the actual approval submission.
        if _hitl_session_enabled and _requires_approval(tool, ctx):
            usecase_cfg = ctx.get("usecase_config") or {}
            risk_levels = (usecase_cfg.get("risk") or {}).get("risk_levels") or {}
            risk_level = risk_levels.get(tool, "high")
            finish_run(run_id)
            return {
                "result": "NEEDS_HITL",
                "tool_name": tool,
                "tool_input": tool_input,
                "risk_level": risk_level,
            }

        add_step(run_id, "tool_call", {"tool": tool, "input": tool_input})
        result = _invoke_tool(tool, tool_input, ctx, bypass_hitl=not _hitl_session_enabled)

        # Episodic write on direct tool call
        if _should_write_episodic(tool, ctx):
            try:
                memory_cfg = ctx.get("memory") or {}
                episodic_cfg = ((memory_cfg.get("write_policies") or {}).get("episodic") or {})
                domain = ctx.get("domain") or {}
                scopes = [
                    {"scope_type": s["name"], "scope_id": ctx.get(s["id_field"], "")}
                    for s in (domain.get("scopes") or [])
                    if ctx.get(s.get("id_field", ""))
                ]
                result_summary = str(result)[:300] if result else ""
                write_episodic_event(
                    store=get_backend(memory_cfg),
                    tenant_id=ctx.get("tenant_id", "default"),
                    scopes=scopes,
                    content=f"Tool '{tool}' executed. Result: {result_summary}",
                    metadata={
                        "type": "tool_executed",
                        "tool": tool,
                        "source": "direct_tool_call",
                    },
                    episodic_cfg=episodic_cfg,
                    domain=domain,
                )
            except Exception as e:
                print(f"[executor] episodic write failed (non-fatal): {e}", flush=True)

        # Retrieval fallback
        if tool == retrieval_cfg.get("default_tool"):
            results = result.get("results") if isinstance(result, dict) else None
            if not results:
                fallback_cfg = retrieval_cfg.get("fallback", {})
                if not fallback_cfg.get("allow_no_results_response", True):
                    finish_run(run_id)
                    return {"result": "OK", "mode": "SAFE_NO_RESULTS", "answer": "No relevant knowledge found."}
                add_step(run_id, "retrieval_fallback", {"reason": "no_results"})
                answer = generate_answer(ctx.get("prompt", ""), tool, result, ctx)
                finish_run(run_id)
                return {"result": "OK", "mode": "RAG_FALLBACK", "answer": answer, "tool": tool, "output": result}

        add_step(run_id, "llm_response", {"tool": tool})
        answer = generate_answer(ctx.get("prompt", ""), tool, result, ctx)
        finish_run(run_id)
        return {"result": "OK", "mode": "DIRECT_TOOL", "answer": answer, "tool": tool, "input": tool_input, "output": result}

    finish_run(run_id)
    return {"result": "OK", "answer": "Unhandled routing mode"}
