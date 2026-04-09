"""
Self-corrective RAG pattern (Dim 3).

retrieve → LLM grades result quality → re-query with refined query if poor → return best.

Grading logic: if no results pass threshold, or avg score < quality_bar,
ask Claude to rewrite the query and try once more.
"""
from __future__ import annotations

import os
from typing import Any, Callable, Dict, List

QUALITY_BAR = 0.55   # avg score below this triggers a re-query


def _refine_query(original_query: str, results: List[Dict[str, Any]], ctx: Dict[str, Any]) -> str:
    """Ask Claude to rewrite the query based on poor retrieval results."""
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

        snippets = "\n".join(
            f"- [{r.get('title', '')}] score={r.get('score', 0):.2f}: {r.get('snippet', '')[:200]}"
            for r in results[:3]
        ) or "(no results)"

        msg = client.messages.create(
            model=os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001"),
            max_tokens=128,
            messages=[{
                "role": "user",
                "content": (
                    f"The following search query returned poor results:\n"
                    f"Query: {original_query}\n\n"
                    f"Retrieved (poor quality):\n{snippets}\n\n"
                    f"Rewrite the query to improve retrieval. "
                    f"Return ONLY the rewritten query, nothing else."
                ),
            }],
        )
        refined = msg.content[0].text.strip()
        return refined if refined else original_query
    except Exception as e:
        print(f"[self_corrective] query refinement failed (non-fatal): {e}", flush=True)
        return original_query


def run(
    search_fn: Callable,
    query: str,
    top_k: int,
    threshold: float,
    strategy: str,
    ctx: Dict[str, Any],
) -> List[Dict[str, Any]]:
    results = search_fn(query, ctx, top_k=top_k, threshold=threshold, strategy=strategy)

    # Grade quality — trigger re-query if no results or avg score below bar
    if results:
        avg_score = sum(r.get("score", 0.0) for r in results) / len(results)
        needs_refinement = avg_score < QUALITY_BAR
    else:
        needs_refinement = True

    if needs_refinement:
        print(f"[self_corrective] low quality results (n={len(results)}), refining query", flush=True)
        refined_query = _refine_query(query, results, ctx)
        if refined_query != query:
            refined_results = search_fn(refined_query, ctx, top_k=top_k, threshold=threshold, strategy=strategy)
            if refined_results:
                print(f"[self_corrective] refined query returned {len(refined_results)} results", flush=True)
                return refined_results

    return results
