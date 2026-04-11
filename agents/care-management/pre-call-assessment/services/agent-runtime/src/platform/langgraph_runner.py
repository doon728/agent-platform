from __future__ import annotations

# Container 1 — LangGraph runner.
# Orchestrates the 3-phase flow: pre-graph → reasoning → post-graph.
# Zero business logic — all logic lives in Container 2 (platform-services).
# Container 1 only owns: graph state, HITL approval_store, and HTTP client calls.

from typing import Any, Dict, List

from src.clients import config_client, memory_client, rag_client, strategy_client

_PLATFORM_ID_KEYS = {"tenant_id", "user_id", "thread_id", "correlation_id", "run_id"}


def _build_memory_policy_state(memory_cfg: Dict[str, Any], ctx: Dict[str, Any]) -> Dict[str, bool]:
    """Build the memory policy state from config + any UI toggle overrides in the request."""
    read_policies = memory_cfg.get("read_policies") or {}
    write_policies = memory_cfg.get("write_policies") or {}
    state = {
        "enabled": bool(memory_cfg.get("enabled", False)),
        "short_term": bool((write_policies.get("short_term") or {}).get("enabled", False)),
        "episodic": bool((write_policies.get("episodic") or {}).get("enabled", False)),
        "summary": bool((write_policies.get("summary") or {}).get("enabled", False)),
        "semantic": bool((write_policies.get("semantic") or {}).get("enabled", False)),
        "read_short_term": bool((read_policies.get("short_term") or {}).get("enabled", True)),
        "read_episodic": bool((read_policies.get("episodic") or {}).get("enabled", True)),
        "read_summary": bool((read_policies.get("summary") or {}).get("enabled", True)),
        "read_semantic": bool((read_policies.get("semantic") or {}).get("enabled", True)),
    }
    override = ctx.get("memory_policy_override") or {}
    for key in state:
        if key in override:
            state[key] = bool(override[key])
    return state


def _build_scope_metadata(ctx: Dict[str, Any], domain: Dict[str, Any]) -> Dict[str, Any]:
    metadata: Dict[str, Any] = {}
    domain_scopes = domain.get("scopes") or []
    if domain_scopes:
        for s in domain_scopes:
            id_field = s.get("id_field") or ""
            if id_field and ctx.get(id_field):
                metadata[id_field] = ctx[id_field]
    else:
        for key, val in ctx.items():
            if key.endswith("_id") and key not in _PLATFORM_ID_KEYS and val:
                metadata[key] = val
    return metadata


class LangGraphRunner:
    def run(self, prompt: str, ctx: Dict[str, Any]) -> Dict[str, Any]:
        import os
        tenant_id = ctx.get("tenant_id") or "default-tenant"
        thread_id = ctx.get("thread_id") or "default-thread"

        agent_type = os.getenv("AGENT_TYPE", "chat_agent")

        # ── 1. Load config from Container 2 ──────────────────────────────────
        usecase_cfg = config_client.get_agent_config(agent_type)
        ctx["usecase_config"] = usecase_cfg
        ctx["prompts"] = usecase_cfg.get("prompts", {})
        ctx["tool_policy"] = usecase_cfg.get("tool_policy", {})
        ctx["retrieval"] = usecase_cfg.get("retrieval", {})
        ctx["workflow_rules"] = usecase_cfg.get("workflow_rules", {})
        ctx["hitl"] = usecase_cfg.get("hitl", {})
        ctx["domain"] = usecase_cfg.get("domain", {})
        ctx["hard_routes"] = usecase_cfg.get("hard_routes", [])
        ctx["reasoning"] = usecase_cfg.get("reasoning", {"strategy": "simple"})
        ctx["agent_type"] = agent_type
        ctx["reasoning_strategy"] = (ctx["reasoning"].get("strategy") or "simple")

        # ── 2. Pre-graph: memory read ─────────────────────────────────────────
        mem_result = memory_client.read(ctx, usecase_cfg)
        memory_cfg = mem_result["memory_cfg"]
        active_scopes = mem_result["active_scopes"]
        memory_context = mem_result["memory_context"]

        memory_policy_state = _build_memory_policy_state(memory_cfg, ctx)

        if not memory_policy_state["read_short_term"]:
            memory_context["recent_turns"] = []

        ctx["memory"] = memory_cfg
        ctx["memory_scopes"] = active_scopes
        ctx["memory_context"] = memory_context

        # ── 3. Pre-graph: RAG retrieval ───────────────────────────────────────
        retrieval_cfg = usecase_cfg.get("retrieval") or {}
        pre_graph_cfg = retrieval_cfg.get("pre_graph") or {}
        ctx["rag_context"] = []

        if pre_graph_cfg.get("enabled", False):
            _pre_cfg = {
                "enabled": True,
                "tool": pre_graph_cfg.get("tool", "search_kb"),
                "strategy": pre_graph_cfg.get("strategy", "semantic"),
                "pattern": pre_graph_cfg.get("pattern", "naive"),
                "top_k": pre_graph_cfg.get("top_k", 3),
                "similarity_threshold": pre_graph_cfg.get("similarity_threshold", 0.5),
            }
            ctx["rag_context"] = rag_client.retrieve(prompt, _pre_cfg, ctx)
            print(f"[pre_graph_rag] chunks={len(ctx['rag_context'])}", flush=True)

        # ── 4. Build thread history ───────────────────────────────────────────
        history: List[Dict[str, Any]] = memory_context.get("recent_turns") or []

        # ── 5. In-graph: run reasoning in Container 2 ─────────────────────────
        reasoning_result = strategy_client.run(prompt, history, ctx)

        domain = ctx.get("domain") or {}
        scope_metadata = _build_scope_metadata(ctx, domain)

        # ── 6. Handle HITL locally (approval_store lives in Container 1) ─────
        if reasoning_result.get("needs_hitl"):
            tool_name = reasoning_result.get("tool_name") or ""
            tool_input = reasoning_result.get("tool_input") or {}
            risk_level = reasoning_result.get("risk_level") or "high"

            from platform_core.hitl import approval_store
            from platform_core.hitl.adapters.internal import InternalAdapter
            from platform_core.hitl.memory_writer import write_hitl_requested

            _adapter = InternalAdapter()
            approval_id = _adapter.submit_request(
                tool_name=tool_name,
                tool_input=tool_input,
                ctx=ctx,
                risk_level=risk_level,
            )

            try:
                write_hitl_requested(approval_id, tool_name, risk_level, ctx)
            except Exception as e:
                print(f"[hitl] memory write failed: {e}", flush=True)

            return {
                "answer": {
                    "result": "APPROVAL_REQUIRED",
                    "approval_id": approval_id,
                    "tool_name": tool_name,
                    "tool_input": tool_input,
                    "risk_level": risk_level,
                    "answer": "This action requires supervisor approval before it can be executed.",
                    "ctx": {
                        "tenant_id": tenant_id,
                        "thread_id": thread_id,
                        **scope_metadata,
                    },
                },
                "ctx": {"tenant_id": tenant_id, "thread_id": thread_id, **scope_metadata},
                "memory_policy": memory_policy_state,
                "memory_trace": {"written": {}, "skipped": {"all": {"reason": "approval_required"}}},
            }

        result = reasoning_result.get("result")
        answer = reasoning_result.get("answer") or str(result)
        planner_trace = reasoning_result.get("planner_trace") or {}

        # ── 7. Post-graph: memory write (async-safe — fire and continue) ─────
        memory_response = str(answer)

        try:
            write_result = memory_client.write(
                prompt=prompt,
                response=memory_response,
                ctx=ctx,
                memory_cfg=memory_cfg,
                active_scopes=active_scopes,
                memory_policy_state=memory_policy_state,
                planner_trace=planner_trace,
                usecase_cfg=usecase_cfg,
            )
        except Exception as e:
            print(f"[post_graph_memory] write failed (non-fatal): {e}", flush=True)
            write_result = {}

        memory_trace = {
            "policy_state": memory_policy_state,
            "scopes": active_scopes,
            "written": write_result.get("written") or {},
            "skipped": write_result.get("skipped") or {},
            "planner": planner_trace,
            "router": reasoning_result.get("router_trace") or {},
            "executor": reasoning_result.get("executor_trace") or {},
        }

        return {
            "answer": answer,
            "ctx": {"tenant_id": tenant_id, "thread_id": thread_id, **scope_metadata},
            "memory_policy": memory_policy_state,
            "memory_trace": memory_trace,
        }
