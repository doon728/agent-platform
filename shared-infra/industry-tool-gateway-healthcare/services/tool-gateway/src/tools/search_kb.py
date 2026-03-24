from typing import Any, Dict
from src.rag.retriever import retrieve


def search_kb(query: str, ctx: Dict[str, Any] | None = None) -> Dict[str, Any]:
    if not query:
        return {"results": []}

    top_k = 3

    if ctx:
        retrieval_cfg = (ctx.get("usecase_config") or {}).get("retrieval") or {}
        rag_cfg = retrieval_cfg.get("rag") or {}

        if rag_cfg.get("top_k"):
            top_k = rag_cfg["top_k"]

    results = retrieve(query, top_k=top_k)
    return {"results": results}