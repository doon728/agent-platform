"""
HyDE — Hypothetical Document Embedding RAG pattern (Dim 3).

Instead of embedding the user's query directly, the LLM first generates a
hypothetical answer to the query. That hypothetical answer is then embedded
and used as the search vector. The intuition: a hypothetical answer is closer
in embedding space to real relevant documents than the raw question is.

Best for: questions where the query phrasing is very different from how
          the answer is phrased in the knowledge base.
  e.g. query: "can I approve prior auth for medication X?"
       hypothetical: "Prior authorization for medication X is approved when..."
       → this embeds closer to actual policy documents than the question itself.

Reference: Gao et al. 2022 "Precise Zero-Shot Dense Retrieval without Relevance Labels"
"""
from __future__ import annotations

import os
from typing import Any, Callable, Dict, List


def _generate_hypothetical_answer(query: str, ctx: Dict[str, Any]) -> str:
    """Generate a hypothetical document that would answer the query."""
    try:
        from langchain_openai import ChatOpenAI
        from langchain_core.messages import SystemMessage, HumanMessage

        llm = ChatOpenAI(
            model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            temperature=0,
            api_key=os.getenv("OPENAI_API_KEY", ""),
        )

        system = SystemMessage(content=(
            "Write a short, factual paragraph that would directly answer the user's question. "
            "Write it as if it were an excerpt from a clinical policy document or knowledge base article. "
            "Do not say 'I don't know' — always write a plausible hypothetical answer. "
            "Keep it under 150 words."
        ))
        human = HumanMessage(content=f"Question: {query}")

        result = llm.invoke([system, human])
        hypothetical = result.content.strip()
        print(f"[hyde_rag] hypothetical answer generated ({len(hypothetical)} chars)", flush=True)
        return hypothetical

    except Exception as e:
        print(f"[hyde_rag] hypothetical generation failed (non-fatal): {e}", flush=True)
        return query  # fall back to original query


def run(
    search_fn: Callable,
    query: str,
    top_k: int,
    threshold: float,
    strategy: str,
    ctx: Dict[str, Any],
) -> List[Dict[str, Any]]:
    hypothetical = _generate_hypothetical_answer(query, ctx)

    # Search using hypothetical answer as the query vector
    results = search_fn(hypothetical, ctx, top_k=top_k, threshold=threshold, strategy=strategy)
    print(f"[hyde_rag] retrieved {len(results)} results using hypothetical embedding", flush=True)

    # If hypothetical search returns nothing, fall back to original query
    if not results:
        print(f"[hyde_rag] no results from hypothetical, falling back to original query", flush=True)
        results = search_fn(query, ctx, top_k=top_k, threshold=threshold, strategy=strategy)

    return results
