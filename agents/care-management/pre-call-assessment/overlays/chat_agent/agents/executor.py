from __future__ import annotations

from typing import Any, Dict, List

from platform_core.config import load_config
from platform_core.llm.responder import generate_answer
from platform_core.observability.tracer import start_run, add_step, finish_run
from platform_core.tools.registry import registry
from platform_core.tools.router import route_step
from platform_core.hitl.adapters.internal import InternalAdapter
from platform_core.hitl.memory_writer import write_hitl_requested
from platform_core.memory.write_engine import write_episodic_event
from platform_core.memory.backend_factory import get_backend


cfg = load_config()
USECASE = cfg.app.active_usecase

_hitl_adapter = InternalAdapter()


def _should_write_episodic(tool_name: str, ctx: Dict[str, Any]) -> bool:
    """Check write_on_tool_call config to decide if this tool triggers an episodic write."""
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

    # Check per-tool risk level
    risk_levels = risk_cfg.get("risk_levels") or {}
    level = risk_levels.get(tool_name, "low")

    # Routing rules: which risk levels require approval
    routing_rules = (usecase_cfg.get("hitl") or {}).get("routing_rules") or []
    for rule in routing_rules:
        if rule.get("risk_level") == level:
            return bool(rule.get("requires_approval", False))

    # Default: only high risk requires approval
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
    step = (steps[0] if steps else "").strip()
    ctx = dict(ctx or {})
    ctx["prompt"] = step if not ctx.get("prompt") else ctx["prompt"]

    print(f"[executor] planner_step={step}")

    run_id = start_run(
        agent=USECASE,
        thread_id=ctx.get("thread_id"),
        prompt=ctx.get("prompt", ""),
    )
    add_step(run_id, "planner", step)

    if not step:
        finish_run(run_id)
        return {"result": "OK", "answer": "No action planned."}

    plan = route_step(step, ctx, raw_prompt=ctx.get("prompt", step))
    mode = plan.get("mode")

    # direct_answer — planner decided no tool needed, answer from context/knowledge directly
    if plan.get("tool") == "direct_answer":
        add_step(run_id, "direct_answer", {"reason": "planner: no tool needed"})
        answer = generate_answer(ctx.get("prompt", step), None, None, ctx)
        finish_run(run_id)
        return {"result": "OK", "mode": "DIRECT_ANSWER", "answer": answer}

    # Extract assessment_id + note from compound planner step (tool: id | note)
    if mode == "direct_tool":
        if ":" in step and "|" in step:
            try:
                tool_part, rest = step.split(":", 1)
                assessment_part, note_part = rest.split("|", 1)
                if "input" not in plan:
                    plan["input"] = {}
                plan["input"]["assessment_id"] = assessment_part.strip()
                plan["input"]["note"] = note_part.strip()
                print(f"[executor_fix] assessment_id={assessment_part.strip()}")
            except Exception as e:
                print(f"[executor_fix_error] {e}")

    if mode == "direct_tool":
        tool = plan["tool"]
        tool_input = plan["input"]

        # Inject RAG params from agent.yaml retrieval.planner_tool config
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

        # HITL check — skip if session override disables it
        _hitl_session_enabled = (ctx.get("hitl_override") or {}).get("enabled", True)

        if _hitl_session_enabled and _requires_approval(tool, ctx):
            usecase_cfg = ctx.get("usecase_config") or {}
            risk_levels = (usecase_cfg.get("risk") or {}).get("risk_levels") or {}
            risk_level = risk_levels.get(tool, "high")
            timeout = ((usecase_cfg.get("hitl") or {}).get("sla") or {}).get("timeout_minutes", 60)

            approval_id = _hitl_adapter.submit_request(
                tool_name=tool,
                tool_input=tool_input,
                ctx=ctx,
                risk_level=risk_level,
            )

            # Write to episodic memory — planner will see this in future turns
            try:
                write_hitl_requested(approval_id, tool, risk_level, ctx)
            except Exception as e:
                print(f"[hitl] memory write failed: {e}")

            add_step(run_id, "hitl_requested", {"tool": tool, "approval_id": approval_id})
            finish_run(run_id)

            return {
                "result": "APPROVAL_REQUIRED",
                "approval_id": approval_id,
                "tool_name": tool,
                "tool_input": tool_input,
                "risk_level": risk_level,
                "answer": f"This action requires supervisor approval before it can be executed. You can continue working while it's reviewed.",
                "ctx": {
                    "tenant_id": ctx.get("tenant_id"),
                    "thread_id": ctx.get("thread_id"),
                    "assessment_id": ctx.get("assessment_id"),
                    "case_id": ctx.get("case_id"),
                    "member_id": ctx.get("member_id"),
                },
            }

        add_step(run_id, "tool_call", {"tool": tool, "input": tool_input})
        result = _invoke_tool(tool, tool_input, ctx, bypass_hitl=not _hitl_session_enabled)

        # Write episodic event for direct tool calls (non-HITL) if configured
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
                        "tool_input": {k: v for k, v in tool_input.items() if k != "tenant_id"},
                        "source": "direct_tool_call",
                        "agent_type": ctx.get("agent_type", ""),
                        "reasoning_strategy": (ctx.get("reasoning") or {}).get("strategy", ""),
                        "thread_id": ctx.get("thread_id", ""),
                    },
                    episodic_cfg=episodic_cfg,
                    domain=domain,
                )
            except Exception as e:
                print(f"[executor] episodic write failed (non-fatal): {e}")

        # Retrieval fallback handling
        if tool == retrieval_cfg.get("default_tool"):
            results = result.get("results") if isinstance(result, dict) else None
            if not results:
                fallback_cfg = retrieval_cfg.get("fallback", {})
                if not fallback_cfg.get("allow_no_results_response", True):
                    finish_run(run_id)
                    return {
                        "result": "OK",
                        "mode": "SAFE_NO_RESULTS",
                        "answer": "No relevant knowledge found. Escalate or refine query.",
                    }
                add_step(run_id, "retrieval_fallback", {"reason": "no_results"})
                answer = generate_answer(ctx.get("prompt", ""), tool, result, ctx)
                finish_run(run_id)
                return {
                    "result": "OK",
                    "mode": "RAG_FALLBACK",
                    "answer": answer,
                    "tool": tool,
                    "input": tool_input,
                    "output": result,
                }

        add_step(run_id, "llm_response", {"tool": tool})
        answer = generate_answer(ctx.get("prompt", ""), tool, result, ctx)

        finish_run(run_id)
        return {
            "result": "OK",
            "mode": "DIRECT_TOOL",
            "answer": answer,
            "tool": tool,
            "input": tool_input,
            "output": result,
        }

    finish_run(run_id)
    return {"result": "OK", "answer": "Unhandled routing mode"}
