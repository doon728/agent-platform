"""
Multi-hop RAG pattern (Dim 3).

Decompose query into sub-queries → retrieve for each → merge and deduplicate results.

Best for: complex questions requiring information from multiple topics.
  e.g. "What are the risk factors for this member and what does policy say about high-risk members?"
       → sub-query 1: "member risk factors"
       → sub-query 2: "policy for high-risk members"
       → merge both result sets

NOT the same as multi_hop reasoning strategy:
  RAG Dim 3 multi_hop = decompose the *retrieval query* into sub-queries.
  Reasoning strategy multi_hop = decompose the *user question* into sub-tasks.
  Both can be active simultaneously and independently.
"""
from __future__ import annotations

import os
from typing import Any, Callable, Dict, List


def _decompose_query(query: str) -> List[str]:
    """Ask LLM to decompose complex query into focused sub-queries."""
    try:
        from langchain_openai import ChatOpenAI
        from langchain_core.messages import SystemMessage, HumanMessage
        from pydantic import BaseModel

        class SubQueries(BaseModel):
            queries: List[str]

        llm = ChatOpenAI(
            model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            temperature=0,
            api_key=os.getenv("OPENAI_API_KEY", ""),
        )
        structured = llm.with_structured_output(SubQueries)

        system = SystemMessage(content=(
            "Break the user's question into 2-3 focused sub-queries for knowledge base search. "
            "Each sub-query should be short and specific. "
            "If the question is already simple and focused, return it as a single sub-query."
        ))
        human = HumanMessage(content=f"Question: {query}")

        result = structured.invoke([system, human])
        queries = [q.strip() for q in (result.queries or []) if q.strip()]
        return queries if queries else [query]

    except Exception as e:
        print(f"[multi_hop_rag] decomposition failed (non-fatal): {e}", flush=True)
        return [query]


def _deduplicate(results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Remove duplicate chunks by content similarity (exact match on content)."""
    seen = set()
    deduped = []
    for r in results:
        key = (r.get("doc_id", ""), r.get("chunk_index", r.get("content", "")[:100]))
        if key not in seen:
            seen.add(key)
            deduped.append(r)
    return deduped


def run(
    search_fn: Callable,
    query: str,
    top_k: int,
    threshold: float,
    strategy: str,
    ctx: Dict[str, Any],
) -> List[Dict[str, Any]]:
    sub_queries = _decompose_query(query)
    print(f"[multi_hop_rag] decomposed into {len(sub_queries)} sub-queries: {sub_queries}", flush=True)

    all_results = []
    per_query_top_k = max(2, top_k // len(sub_queries))

    for sq in sub_queries:
        results = search_fn(sq, ctx, top_k=per_query_top_k, threshold=threshold, strategy=strategy)
        print(f"[multi_hop_rag] sub-query='{sq[:60]}' → {len(results)} results", flush=True)
        all_results.extend(results)

    # Deduplicate and sort by score descending, cap at top_k
    deduped = _deduplicate(all_results)
    deduped.sort(key=lambda r: r.get("score", 0.0), reverse=True)
    return deduped[:top_k]
