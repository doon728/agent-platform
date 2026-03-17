from typing import Any, Dict

from src.rag.retriever import retrieve


def search_kb(query: str) -> Dict[str, Any]:
    if not query:
        return {"results": []}

    results = retrieve(query, top_k=3)
    return {"results": results}