"""
Agentic RAG pattern (Dim 3).

The LLM decides mid-reasoning whether to retrieve again, how many times,
and with what refined query. Unlike naive (retrieve once) or self_corrective
(grade and retry if poor), agentic lets the LLM drive the retrieval loop
based on whether it has enough information to answer confidently.

Loop: retrieve → LLM evaluates sufficiency → retrieve again with refined query if needed → repeat.

Best for: complex, open-ended questions where it's unclear upfront how many
          retrieval passes are needed.
  e.g. research-style queries, multi-faceted clinical questions.

Max iterations controlled by max_iterations (default 3) to bound cost.
"""
from __future__ import annotations

import os
from typing import Any, Callable, Dict, List

_DEFAULT_MAX_ITERATIONS = 3


def _should_retrieve_again(query: str, results: List[Dict[str, Any]], iteration: int) -> tuple[bool, str]:
    """
    LLM decides if current results are sufficient.
    Returns (should_continue, refined_query).
    """
    try:
        from langchain_openai import ChatOpenAI
        from langchain_core.messages import SystemMessage, HumanMessage
        from pydantic import BaseModel

        class RetrievalDecision(BaseModel):
            sufficient: bool        # True = stop, False = retrieve again
            refined_query: str      # refined query if not sufficient, empty if sufficient
            reason: str             # brief explanation

        llm = ChatOpenAI(
            model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            temperature=0,
            api_key=os.getenv("OPENAI_API_KEY", ""),
        )
        structured = llm.with_structured_output(RetrievalDecision)

        snippets = "\n".join(
            f"- [{r.get('title', '')}] score={r.get('score', 0):.2f}: {r.get('snippet', r.get('content', ''))[:200]}"
            for r in results[:5]
        ) or "(no results)"

        system = SystemMessage(content=(
            "You are evaluating whether retrieved knowledge base results are sufficient to answer a question. "
            "If they are sufficient, set sufficient=true. "
            "If not sufficient, set sufficient=false and provide a refined_query to retrieve more relevant information."
        ))
        human = HumanMessage(content=(
            f"Question: {query}\n\n"
            f"Retrieved results (iteration {iteration}):\n{snippets}\n\n"
            "Are these results sufficient to answer the question?"
        ))

        decision = structured.invoke([system, human])
        return (not decision.sufficient), (decision.refined_query or query)

    except Exception as e:
        print(f"[agentic_rag] sufficiency check failed (non-fatal): {e}", flush=True)
        return False, query  # stop on error


def run(
    search_fn: Callable,
    query: str,
    top_k: int,
    threshold: float,
    strategy: str,
    ctx: Dict[str, Any],
) -> List[Dict[str, Any]]:
    retrieval_cfg = ctx.get("retrieval") or {}
    max_iterations = int(
        (retrieval_cfg.get("planner_tool") or retrieval_cfg).get("max_iterations", _DEFAULT_MAX_ITERATIONS)
    )

    all_results: List[Dict[str, Any]] = []
    current_query = query

    for iteration in range(1, max_iterations + 1):
        results = search_fn(current_query, ctx, top_k=top_k, threshold=threshold, strategy=strategy)
        print(f"[agentic_rag] iteration={iteration} query='{current_query[:60]}' → {len(results)} results", flush=True)

        # Merge with previous results (deduplicate by doc_id + chunk_index)
        seen = {(r.get("doc_id", ""), r.get("chunk_index", "")) for r in all_results}
        for r in results:
            key = (r.get("doc_id", ""), r.get("chunk_index", ""))
            if key not in seen:
                all_results.append(r)
                seen.add(key)

        if iteration == max_iterations:
            print(f"[agentic_rag] max_iterations={max_iterations} reached", flush=True)
            break

        should_continue, refined_query = _should_retrieve_again(query, all_results, iteration)
        if not should_continue:
            print(f"[agentic_rag] LLM says results sufficient at iteration {iteration}", flush=True)
            break

        current_query = refined_query
        print(f"[agentic_rag] refining query for iteration {iteration + 1}: '{refined_query[:60]}'", flush=True)

    # Sort by score, cap at top_k
    all_results.sort(key=lambda r: r.get("score", 0.0), reverse=True)
    return all_results[:top_k]
