"""
Naive RAG pattern (Dim 3).

Single retrieve → inject → respond.
No re-ranking, no retry, no LLM grading.
This is the implicit behavior today, now formally named.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, List


def run(
    search_fn: Callable,
    query: str,
    top_k: int,
    threshold: float,
    strategy: str,
    ctx: Dict[str, Any],
) -> List[Dict[str, Any]]:
    return search_fn(query, ctx, top_k=top_k, threshold=threshold, strategy=strategy)
