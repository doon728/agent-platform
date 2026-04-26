"""search_kb tool — calls the RAG service over HTTP via rag_client."""

from typing import Any, Dict

from src.rag_client import RagServiceError, retrieve


def search_kb(query: str, ctx: Dict[str, Any] | None = None) -> Dict[str, Any]:
    if not query:
        return {"results": []}

    top_k = 3
    threshold: float | None = None
    strategy = "semantic"

    if ctx:
        retrieval_cfg = (ctx.get("usecase_config") or {}).get("retrieval") or {}
        rag_cfg = retrieval_cfg.get("rag") or {}

        if rag_cfg.get("top_k"):
            top_k = rag_cfg["top_k"]
        if rag_cfg.get("threshold") is not None:
            threshold = rag_cfg["threshold"]
        if rag_cfg.get("strategy"):
            strategy = rag_cfg["strategy"]

    try:
        results = retrieve(query=query, top_k=top_k, threshold=threshold, strategy=strategy)
        return {"results": results}
    except RagServiceError as e:
        return {"results": [], "error": str(e)}
