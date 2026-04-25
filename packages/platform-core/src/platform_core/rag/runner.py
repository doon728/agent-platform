"""
RAG runner — dispatches to the correct Dim 3 pattern.

Called from:
  - langgraph_runner.py (pre-graph RAG path)
  - tools/bootstrap.py (planner tool path, via search_kb handler)

Usage:
    from platform_core.rag.runner import run_rag
    results = run_rag(query, retrieval_cfg, search_fn, ctx)
"""
from __future__ import annotations

from typing import Any, Callable, Dict, List

from platform_core.rag.patterns import naive, self_corrective, multi_hop, hyde, agentic

_PATTERNS = {
    "naive": naive.run,
    "self_corrective": self_corrective.run,
    "multi_hop": multi_hop.run,
    "hyde": hyde.run,
    "agentic": agentic.run,
}


def run_rag(
    query: str,
    retrieval_cfg: Dict[str, Any],
    search_fn: Callable,
    ctx: Dict[str, Any],
    top_k_override: int | None = None,
    threshold_override: float | None = None,
) -> List[Dict[str, Any]]:
    """
    Run RAG with all 3 dimensions applied from retrieval_cfg.

    Dim 1 — strategy:  semantic | keyword | hybrid  (passed to search_fn)
    Dim 2 — stage:     caller decides (pre_graph vs planner_tool); runner is stage-agnostic
    Dim 3 — pattern:   naive | self_corrective  (dispatched here)
    """
    top_k = top_k_override if top_k_override is not None else retrieval_cfg.get("top_k", 3)
    threshold = threshold_override if threshold_override is not None else retrieval_cfg.get("similarity_threshold", 0.35)
    strategy = retrieval_cfg.get("strategy", "semantic")
    pattern = retrieval_cfg.get("pattern", "naive")

    pattern_fn = _PATTERNS.get(pattern)
    if pattern_fn is None:
        print(f"[rag_runner] unknown pattern '{pattern}', falling back to naive", flush=True)
        pattern_fn = naive.run

    print(f"[rag_runner] dim1={strategy} dim3={pattern} top_k={top_k} threshold={threshold}", flush=True)

    return pattern_fn(
        search_fn=search_fn,
        query=query,
        top_k=top_k,
        threshold=threshold,
        strategy=strategy,
        ctx=ctx,
    )
