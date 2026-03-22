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
from src.platform.usecase_config_loader import load_usecase_config
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

        run_id = start_run(
            agent="chat_agent",
            thread_id=thread_id,
            prompt=prompt,
        )

        ctx["run_id"] = run_id

        cfg = load_config()
        usecase_cfg = load_usecase_config(
            cfg.app.capability_name,
            cfg.app.active_usecase
        )

        ctx["usecase_config"] = usecase_cfg
        ctx["prompts"] = usecase_cfg.get("prompts", {})
        ctx["tool_policy"] = usecase_cfg.get("tool_policy", {})
        ctx["retrieval"] = usecase_cfg.get("retrieval", {})
        ctx["workflow_rules"] = usecase_cfg.get("workflow_rules", {})

        memory_cfg = load_memory_config(usecase_cfg)
        active_scopes = resolve_scopes(ctx, memory_cfg)

        memory_context = build_memory_context(
            active_scopes,
            memory_cfg,
            tenant_id=tenant_id,
        )

        ctx["memory"] = memory_cfg
        ctx["memory_scopes"] = active_scopes
        ctx["memory_context"] = memory_context

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

        out = self._app.invoke(initial_state, config=config)

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

        write_raw_turns(
            store=memory_store,
            tenant_id=tenant_id,
            thread_id=thread_id,
            user_prompt=prompt,
            assistant_response=str(result),
            metadata={
                "case_id": case_id,
                "member_id": ctx.get("member_id"),
                "assessment_id": ctx.get("assessment_id"),
                "care_plan_id": ctx.get("care_plan_id"),
            },
        )

        maybe_write_conversation_summary(
            store=memory_store,
            tenant_id=tenant_id,
            thread_id=thread_id,
            memory_cfg=memory_cfg,
        )

        episodic_cfg = ((memory_cfg.get("write_policies") or {}).get("episodic") or {})
        if episodic_cfg.get("enabled", False):
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
                    "source": "invocation",
                },
            )

        write_semantic_memories(
            store=memory_store,
            tenant_id=tenant_id,
            ctx=ctx,
            memory_cfg=memory_cfg,
            prompt=prompt,
            response=str(result),
        )

        finish_run(run_id)

        return result