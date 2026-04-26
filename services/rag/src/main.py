"""RAG service — exposes retrieval over a vector knowledge base.

Standalone service. Called by tools (e.g., search_kb) via HTTP. Used to live in-process
inside the tool-policy-gateway; split out as part of Pattern A′ so the gateway can focus
on policy + governance.

Endpoints:
    GET  /healthz                 — liveness check
    POST /retrieve                — vector retrieval over the KB
    POST /ingest                  — chunk + embed + insert a document into the KB
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from rag_engine.ingest import split_text, upsert_chunk
from rag_engine.retriever import retrieve

app = FastAPI(title="AEA RAG Service", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class RetrieveRequest(BaseModel):
    query: str = Field(..., min_length=1)
    top_k: int | None = Field(default=None, ge=1, le=50)
    threshold: float | None = Field(default=None, ge=0.0, le=1.0)
    strategy: str = Field(default="semantic")


class RetrieveResponse(BaseModel):
    results: list[dict[str, Any]]
    strategy: str
    top_k: int | None = None
    threshold: float | None = None


class IngestRequest(BaseModel):
    doc_id: str = Field(..., min_length=1)
    title: str = Field(default="")
    content: str = Field(..., min_length=1)


class IngestResponse(BaseModel):
    doc_id: str
    chunks_indexed: int


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok", "service": "rag"}


@app.post("/retrieve", response_model=RetrieveResponse)
def post_retrieve(req: RetrieveRequest) -> RetrieveResponse:
    try:
        results = retrieve(
            query=req.query,
            top_k=req.top_k,
            threshold=req.threshold,
            strategy=req.strategy,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    return RetrieveResponse(
        results=results,
        strategy=req.strategy,
        top_k=req.top_k,
        threshold=req.threshold,
    )


@app.post("/ingest", response_model=IngestResponse)
def post_ingest(req: IngestRequest) -> IngestResponse:
    chunks = split_text(req.content)
    for idx, chunk in enumerate(chunks):
        upsert_chunk(
            row_id=f"{req.doc_id}::{idx}",
            doc_id=req.doc_id,
            title=req.title,
            content=chunk,
            chunk_index=idx,
        )
    return IngestResponse(doc_id=req.doc_id, chunks_indexed=len(chunks))
