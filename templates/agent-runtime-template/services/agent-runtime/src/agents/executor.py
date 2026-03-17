from __future__ import annotations

from typing import Any, Dict, List

from src.platform.config import load_config
from src.platform.llm.responder import generate_answer
from src.platform.observability.tracer import start_run, add_step, finish_run
from src.platform.tools.registry import registry


cfg = load_config()
USECASE = cfg.app.active_usecase

from src.platform.tools.router import route_step


def _invoke_tool(tool_name: str, tool_input: Dict[str, Any], ctx: Dict[str, Any]) -> Any:
    usecase_cfg = ctx.get("usecase_config") or {}
    tool_policy = usecase_cfg.get("tool_policy") or {}

    mode = tool_policy.get("mode", "selected")
    allowed_tools = tool_policy.get("allowed_tools") or []

    if mode == "selected":
        if tool_name not in allowed_tools:
            raise RuntimeError(
                f"Tool '{tool_name}' is not allowed for this use case."
            )

    elif mode == "auto":
        allowed_tags = set(tool_policy.get("allowed_tags") or [])
        spec = registry.get_spec(tool_name)

        if allowed_tags and not allowed_tags.intersection(set(spec.tags or [])):
            raise RuntimeError(
                f"Tool '{tool_name}' is not allowed for this use case."
            )

    result = registry.invoke(tool_name, tool_input, ctx)

    if isinstance(result, dict) and result.get("approval_required"):
        return {"result": "APPROVAL_REQUIRED", "approval": result}

    return result


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

    if mode == "direct_tool":
        tool = plan["tool"]
        tool_input = plan["input"]

        add_step(run_id, "tool_call", {"tool": tool, "input": tool_input})
        result = _invoke_tool(tool, tool_input, ctx)

        # -----------------------------
        # Retrieval fallback handling
        # -----------------------------
        retrieval_cfg = ctx.get("usecase_config", {}).get("retrieval", {})

        if tool == retrieval_cfg.get("default_tool"):
            results = result.get("results") if isinstance(result, dict) else None

            no_results = not results or len(results) == 0

            if no_results:
                fallback_cfg = retrieval_cfg.get("fallback", {})
                allow_no_results = fallback_cfg.get("allow_no_results_response", True)

                if not allow_no_results:
                    finish_run(run_id)
                    return {
                        "result": "OK",
                        "mode": "SAFE_NO_RESULTS",
                        "answer": "No relevant knowledge found. Escalate or refine query.",
                    }

                # allow platform to continue with LLM reasoning
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


        if isinstance(result, dict) and result.get("result") == "APPROVAL_REQUIRED":
            finish_run(run_id)
            return result

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