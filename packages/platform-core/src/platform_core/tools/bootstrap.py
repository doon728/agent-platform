from __future__ import annotations

from platform_core.tools.registry import ToolSpec, registry
from platform_core.tools.bindings import search_kb as _search_kb_binding


def _search_kb_handler(tool_input: dict, ctx: dict) -> dict:
    """
    search_kb handler — applies all 3 RAG dimensions for the planner_tool stage.

    Dim 1 (semantic/keyword/hybrid) and params (top_k, threshold) are read from
    retrieval.planner_tool config in agent.yaml (injected by executor.py into tool_input).
    Dim 3 (pattern: naive/self_corrective/multi_hop/hyde/agentic) is applied here
    via run_rag — same runner used by pre-graph RAG.
    """
    from platform_core.rag.runner import run_rag

    query = tool_input["query"]

    # Dim 3 pattern from planner_tool config
    retrieval_cfg = ((ctx or {}).get("retrieval") or {})
    planner_tool_cfg = retrieval_cfg.get("planner_tool") or {}

    # Build stage-specific retrieval config for runner
    stage_cfg = {
        "strategy": tool_input.get("strategy") or planner_tool_cfg.get("strategy", "semantic"),
        "pattern": planner_tool_cfg.get("pattern", "naive"),
        "top_k": tool_input.get("top_k") or planner_tool_cfg.get("top_k", 5),
        "similarity_threshold": tool_input.get("threshold") or planner_tool_cfg.get("similarity_threshold", 0.35),
    }

    def _search_fn(q, ctx, top_k=5, threshold=0.35, strategy="semantic"):
        return _search_kb_binding(q, ctx, top_k=top_k, threshold=threshold, strategy=strategy, config_key="planner_tool")

    results = run_rag(
        query=query,
        retrieval_cfg=stage_cfg,
        search_fn=_search_fn,
        ctx=ctx,
    )

    return {"results": results}


def register_tools() -> None:
    # Platform-level tool: KB search — applies all 3 RAG dimensions via run_rag
    registry.register(
        ToolSpec(
            name="search_kb",
            description="Search the knowledge base for relevant documents",
            input_schema={
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
            handler=_search_kb_handler,
            mode="read",
            primary_arg="query",
            tags=["retrieval", "knowledge"],
        )
    )
    # Capability-specific tools are registered dynamically via load_tools_from_gateway()
