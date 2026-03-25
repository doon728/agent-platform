from __future__ import annotations

from typing import Any, Dict, List

from src.platform.config import load_config
from src.platform.llm.responder import generate_answer
from src.platform.observability.tracer import start_run, add_step, finish_run
from src.platform.tools.registry import registry
from src.platform.tools.router import route_step
from src.platform.hitl.adapters.internal import InternalAdapter
from src.platform.hitl.memory_writer import write_hitl_requested


cfg = load_config()
USECASE = cfg.app.active_usecase

_hitl_adapter = InternalAdapter()


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

        # Inject RAG params from agent.yaml retrieval config
        retrieval_cfg = ctx.get("retrieval") or {}
        if tool == retrieval_cfg.get("default_tool"):
            if retrieval_cfg.get("top_k") is not None:
                tool_input = {**tool_input, "top_k": retrieval_cfg["top_k"]}
            if retrieval_cfg.get("similarity_threshold") is not None:
                tool_input = {**tool_input, "threshold": retrieval_cfg["similarity_threshold"]}

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
