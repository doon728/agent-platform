from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter()


@router.post("/retrieve")
async def rag_retrieve(payload: dict) -> JSONResponse:
    """
    Pre-graph or planner-tool RAG retrieval.

    Input:
      query         : the user's prompt or search query
      retrieval_cfg : {tool, strategy, pattern, top_k, similarity_threshold}
      ctx           : request context (tenant_id, tool_policy, ...)

    Output:
      chunks : list of retrieved knowledge chunks
    """
    query = payload.get("query") or ""
    retrieval_cfg = payload.get("retrieval_cfg") or {}
    ctx = payload.get("ctx") or {}

    if not retrieval_cfg.get("enabled", True):
        return JSONResponse({"ok": True, "chunks": []})

    try:
        from platform_core.tools.bindings import search_kb as _search_kb
        from platform_core.rag.runner import run_rag

        chunks = run_rag(
            query=query,
            retrieval_cfg=retrieval_cfg,
            search_fn=_search_kb,
            ctx=ctx,
        )
        return JSONResponse({"ok": True, "chunks": chunks})
    except Exception as e:
        print(f"[rag/retrieve] failed (non-fatal): {e}", flush=True)
        return JSONResponse({"ok": True, "chunks": [], "warning": str(e)})
