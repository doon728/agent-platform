from __future__ import annotations

from typing import Any, Dict, List

from langgraph.checkpoint.memory import MemorySaver
from src.platform.memory.memory_store import FileMemoryStore
from src.platform.memory.summary_engine import maybe_write_conversation_summary
from src.platform.memory.write_engine import (
    write_raw_turns,
    write_episodic_event,
    write_semantic_memories,
)

from src.graph.build_graph import build_graph
from src.platform.observability.tracer import start_run, finish_run
from src.platform.usecase_config_loader import load_agent_config
from src.platform.config import load_config
from src.platform.memory.config_loader import load_memory_config
from src.platform.memory.scope_resolver import resolve_scopes
from src.platform.memory.context_builder import build_memory_context


class LangGraphRunner:
    def __init__(self, build_graph_fn=None):
        self._build_graph_fn = build_graph_fn or build_graph
        self._app = None

    def _get_checkpointer(self):
        return MemorySaver()

    def _ensure_app(self):
        if self._app is None:
            checkpointer = self._get_checkpointer()
            self._app = self._build_graph_fn(checkpointer)

    def run(self, prompt: str, ctx: Dict[str, Any]) -> Any:
        tenant_id = ctx.get("tenant_id") or "default-tenant"
        thread_id = ctx.get("thread_id") or "default-thread"
        case_id = ctx.get("case_id")

        memory_store = FileMemoryStore()

        cfg = load_config()
        agent_type = cfg.prompt_service.agent_type

        run_id = start_run(
            agent=agent_type,
            thread_id=thread_id,
            prompt=prompt,
        )

        ctx["run_id"] = run_id

        usecase_cfg = load_agent_config(agent_type)

        ctx["usecase_config"] = usecase_cfg
        ctx["prompts"] = usecase_cfg.get("prompts", {})
        ctx["tool_policy"] = usecase_cfg.get("tool_policy", {})
        ctx["retrieval"] = usecase_cfg.get("retrieval", {})
        ctx["workflow_rules"] = usecase_cfg.get("workflow_rules", {})
        ctx["hitl"] = usecase_cfg.get("hitl", {})

        memory_cfg = load_memory_config(usecase_cfg)
        active_scopes = resolve_scopes(ctx, memory_cfg)

        memory_context = build_memory_context(
            active_scopes,
            memory_cfg,
            tenant_id=tenant_id,
        )

        memory_trace = {
            "policy": memory_cfg,
            "scopes_resolved": active_scopes,
            "retrieved": {
                "short_term_turns": len(memory_context.get("recent_turns") or []),
                "episodic_items": len(memory_context.get("episodic") or []),
                "semantic_items": len(memory_context.get("semantic") or []),
                "summary_items": len(memory_context.get("summaries") or []),
            },
            "written": {
                "raw_turn": True,
                "episodic_attempted": ((memory_cfg.get("write_policies") or {}).get("episodic") or {}).get("enabled", False),
                "semantic_attempted": ((memory_cfg.get("write_policies") or {}).get("semantic") or {}).get("enabled", False),
                "summary_attempted": ((memory_cfg.get("write_policies") or {}).get("summary") or {}).get("enabled", False),
            },
        }
        memory_policy_state = {
            "enabled": bool(memory_cfg.get("enabled", False)),
            "short_term": bool(((memory_cfg.get("write_policies") or {}).get("short_term") or {}).get("enabled", False)),
            "episodic": bool(((memory_cfg.get("write_policies") or {}).get("episodic") or {}).get("enabled", False)),
            "summary": bool(((memory_cfg.get("write_policies") or {}).get("summary") or {}).get("enabled", False)),
            "semantic": bool(((memory_cfg.get("write_policies") or {}).get("semantic") or {}).get("enabled", False)),
        }

        # Apply UI toggle overrides — each key can be forced ON or OFF from the request payload
        override = ctx.get("memory_policy_override") or {}
        for key in ("short_term", "episodic", "summary", "semantic"):
            if key in override:
                memory_policy_state[key] = bool(override[key])

        # If short_term is overridden OFF, clear retrieved history so planner sees no prior turns
        if not memory_policy_state["short_term"]:
            memory_context["recent_turns"] = []

        def _snippet(text: str, max_len: int = 80) -> str:
            text = (text or "").strip().replace("\n", " ")
            return text[:max_len] + "…" if len(text) > max_len else text

        recent_turns = memory_context.get("recent_turns") or []
        episodic_memories = memory_context.get("episodic_memories") or []
        semantic_memories = memory_context.get("semantic_memories") or []
        conversation_summary = memory_context.get("conversation_summary")

        memory_trace = {
            "policy_state": memory_policy_state,
            "scopes": active_scopes,
            "retrieved": {
                "short_term_count": len(recent_turns),
                "summary_count": 1 if conversation_summary else 0,
                "episodic_count": len(episodic_memories),
                "semantic_count": len(semantic_memories),
                "short_term_snippets": [
                    {"role": t.get("role", ""), "text": _snippet(t.get("content", ""))}
                    for t in recent_turns[-4:]
                ],
                "summary_snippet": _snippet(conversation_summary) if conversation_summary else None,
                "episodic_snippets": [_snippet(m.get("content", "")) for m in episodic_memories[:3]],
                "semantic_snippets": [_snippet(m.get("content", "")) for m in semantic_memories[:3]],
            },
            "written": {},
            "skipped": {},
            "context_assembly": {
                "prefer_summaries_over_raw": bool((memory_cfg.get("context_assembly") or {}).get("prefer_summaries_over_raw", False)),
                "deduplicate": bool((memory_cfg.get("context_assembly") or {}).get("deduplicate", False)),
                "max_total_items": int((memory_cfg.get("context_assembly") or {}).get("max_total_items", 0) or 0),
            },
        }



        ctx["memory"] = memory_cfg
        ctx["memory_scopes"] = active_scopes
        ctx["memory_context"] = memory_context

        # ── Pre-graph RAG retrieval ────────────────────────────────────────────
        # If retrieval.pre_graph.enabled, call the KB retrieval tool before the
        # graph runs and inject results into ctx["rag_context"]. The planner and
        # responder both see this ambient KB context without needing to call a
        # tool themselves. This is separate from search_kb as a planner tool call
        # (which handles explicit "what is the protocol for X" queries).
        retrieval_cfg = usecase_cfg.get("retrieval") or {}
        pre_graph_cfg = retrieval_cfg.get("pre_graph") or {}
        ctx["rag_context"] = []

        if pre_graph_cfg.get("enabled", False):
            try:
                from src.platform.tools.registry import registry as _registry
                _default_tool = retrieval_cfg.get("default_tool", "search_kb")
                _top_k = pre_graph_cfg.get("top_k", 3)
                _threshold = pre_graph_cfg.get("similarity_threshold", 0.5)
                _rag_result = _registry.invoke(
                    _default_tool,
                    {"query": prompt, "top_k": _top_k, "threshold": _threshold},
                    ctx,
                )
                _chunks = _rag_result.get("results") or []
                ctx["rag_context"] = _chunks
                print(f"[pre_graph_rag] retrieved {len(_chunks)} chunks for query: {prompt[:60]}", flush=True)
            except Exception as _e:
                print(f"[pre_graph_rag] retrieval failed (non-fatal): {_e}", flush=True)
                ctx["rag_context"] = []
        # ── End pre-graph RAG ─────────────────────────────────────────────────

        self._ensure_app()

        # IMPORTANT:
        # Use the SAME file-backed source for read history that we use for writes.
        thread_history: List[Dict[str, Any]] = memory_context.get("recent_turns") or []

        # Optional: keep episodic memories available in ctx, but do NOT mix them into planner chat history
        # because planner expects conversational turns with role/content.
        history = thread_history

        print(f"[thread_history_count] {len(thread_history or [])}", flush=True)
        print(f"[thread_history_raw] {thread_history}", flush=True)
        print(f"[ctx_assessment] {ctx.get('assessment_id')}", flush=True)
        print(f"[ctx_member] {ctx.get('member_id')}", flush=True)

        initial_state = {
            "prompt": prompt,
            "ctx": ctx,
            "history": history,
        }

        config = {
            "configurable": {
                "thread_id": thread_id,
            }
        }

        out = self._app.invoke(initial_state, config=config)

        planner_trace = out.get("planner_trace") if isinstance(out, dict) else None
        router_trace = out.get("router_trace") if isinstance(out, dict) else None
        executor_trace = out.get("executor_trace") if isinstance(out, dict) else None



        # Preserve approval payloads exactly as returned by the graph/executor.
        if isinstance(out, dict) and isinstance(out.get("result"), dict):
            inner = out["result"]
            if isinstance(inner, dict) and inner.get("result") == "APPROVAL_REQUIRED":
                result = inner
            else:
                result = out.get("answer") or out.get("result") or out
        elif isinstance(out, dict) and out.get("result") == "APPROVAL_REQUIRED":
            result = out
        else:
            result = out.get("answer") if isinstance(out, dict) else out
            if result is None:
                result = out

        # When result is APPROVAL_REQUIRED, store a slim placeholder to avoid
        # writing the full 200KB+ approval object into short_term memory which
        # causes subsequent LLM calls to crash from oversized context.
        def _is_approval_required(r) -> bool:
            if isinstance(r, dict):
                if r.get("result") == "APPROVAL_REQUIRED":
                    return True
                if isinstance(r.get("result"), dict) and r["result"].get("result") == "APPROVAL_REQUIRED":
                    return True
            return False

        if _is_approval_required(result):
            tool_name = ""
            try:
                inner = result if result.get("result") == "APPROVAL_REQUIRED" else result.get("result", {})
                tool_name = inner.get("approval", {}).get("tool_name", "") or inner.get("tool_name", "")
            except Exception:
                pass
            memory_response = f"[APPROVAL_REQUIRED] Awaiting human approval for tool: {tool_name}"
        else:
            memory_response = str(result)

        if memory_policy_state["short_term"]:
            write_raw_turns(
                store=memory_store,
                tenant_id=tenant_id,
                thread_id=thread_id,
                user_prompt=prompt,
                assistant_response=memory_response,
                metadata={
                    "case_id": case_id,
                    "member_id": ctx.get("member_id"),
                    "assessment_id": ctx.get("assessment_id"),
                    "care_plan_id": ctx.get("care_plan_id"),
                },
            )

        memory_trace["written"]["short_term"] = {
            "status": "written" if memory_policy_state["short_term"] else "skipped",
            "scope": "conversation",
            "trigger": "every_turn",
        }

        maybe_write_conversation_summary(
            store=memory_store,
            tenant_id=tenant_id,
            thread_id=thread_id,
            memory_cfg=memory_cfg,
        )

        summary_cfg = ((memory_cfg.get("write_policies") or {}).get("summary") or {})
        if summary_cfg.get("enabled", False):
            memory_trace["written"]["summary"] = {
                "status": "evaluated",
                "scope": "conversation",
                "trigger": summary_cfg.get("triggers") or {},
            }
        else:
            memory_trace["skipped"]["summary"] = {
                "reason": "policy_disabled"
            }

        episodic_cfg = ((memory_cfg.get("write_policies") or {}).get("episodic") or {})
        if episodic_cfg.get("enabled", False) and memory_policy_state["episodic"]:
            # Only write episodic on clinical tool execution (tool_success trigger),
            # not on every read/search query. Check which tool the planner chose.
            _episodic_write_tools = {"write_case_note", "complete_assessment", "update_care_plan"}
            _tool_used = (planner_trace or {}).get("tool", "")
            _is_tool_success = (
                _tool_used in _episodic_write_tools
                and not _is_approval_required(result)
            )
            if _is_tool_success:
                write_episodic_event(
                    store=memory_store,
                    tenant_id=tenant_id,
                    scopes=active_scopes,
                    content=f"User asked: {prompt}\nAssistant answered: {str(result)}",
                    metadata={
                        "case_id": case_id,
                        "member_id": ctx.get("member_id"),
                        "assessment_id": ctx.get("assessment_id"),
                        "care_plan_id": ctx.get("care_plan_id"),
                        "source": "tool_success",
                        "tool": _tool_used,
                    },
                )
                # Register scope relationships for rollup
                _assessment_id = ctx.get("assessment_id")
                _member_id = ctx.get("member_id")
                if _assessment_id and case_id:
                    memory_store.register_child_scope(tenant_id, "case", case_id, "assessment", _assessment_id)
                if case_id and _member_id:
                    memory_store.register_child_scope(tenant_id, "member", _member_id, "case", case_id)
                memory_trace["written"]["episodic"] = {
                    "status": "written",
                    "scope": "case_or_assessment",
                    "trigger": "tool_success",
                    "tool": _tool_used,
                }
            else:
                memory_trace["skipped"]["episodic"] = {
                    "reason": f"trigger not met (tool={_tool_used or 'none'})",
                }
        else:
            memory_trace["skipped"]["episodic"] = {
                "reason": "policy_disabled"
            }
        semantic_cfg = ((memory_cfg.get("write_policies") or {}).get("semantic") or {})
        if semantic_cfg.get("enabled", False) and memory_policy_state["semantic"]:
            write_semantic_memories(
                store=memory_store,
                tenant_id=tenant_id,
                ctx=ctx,
                memory_cfg=memory_cfg,
                prompt=prompt,
                response=str(result),
            )
            memory_trace["written"]["semantic"] = {
                "status": "written",
                "scope": "member_or_user",
                "trigger": semantic_cfg.get("trigger"),
            }
        else:
            memory_trace["skipped"]["semantic"] = {
                "reason": "policy_disabled"
            }
        finish_run(run_id)

        memory_trace["planner"] = planner_trace or {}
        memory_trace["router"] = router_trace or {}
        memory_trace["executor"] = executor_trace or {}

        return {
            "answer": result,
            "ctx": {
                "tenant_id": ctx.get("tenant_id"),
                "thread_id": ctx.get("thread_id"),
                "member_id": ctx.get("member_id"),
                "case_id": ctx.get("case_id"),
                "assessment_id": ctx.get("assessment_id"),
                "care_plan_id": ctx.get("care_plan_id"),
            },
            "memory_policy": memory_policy_state,
            "memory_trace": memory_trace,
        }