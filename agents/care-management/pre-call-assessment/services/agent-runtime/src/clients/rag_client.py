from __future__ import annotations

from typing import Any, Dict, List

from src.clients.base import post


def retrieve(query: str, retrieval_cfg: Dict[str, Any], ctx: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Pre-graph RAG retrieval from Container 2.
    Returns list of knowledge chunks.
    """
    resp = post("/rag/retrieve", {
        "query": query,
        "retrieval_cfg": retrieval_cfg,
        "ctx": ctx,
    })
    return resp.get("chunks") or []
