"""Thin HTTP client for the RAG service (services/rag/).

Used by tools that need vector retrieval (e.g., search_kb). Pattern A′: RAG runs as
its own service; the policy gateway calls it via HTTP rather than in-process imports.
"""

import os
from typing import Any

import httpx

RAG_SERVICE_URL = os.getenv("RAG_SERVICE_URL", "http://rag:8082")
RAG_TIMEOUT_SECONDS = float(os.getenv("RAG_TIMEOUT_SECONDS", "10"))


class RagServiceError(RuntimeError):
    """Raised when the RAG service returns an error or is unreachable."""


def retrieve(
    query: str,
    top_k: int | None = None,
    threshold: float | None = None,
    strategy: str | None = "semantic",
) -> list[dict[str, Any]]:
    """Call POST /retrieve on the RAG service. Returns list of result dicts.

    ``strategy=None`` is treated as ``semantic`` (the service-side default) so
    callers passing pydantic-validated configs with optional fields don't trip
    422 validation errors.
    """
    payload: dict[str, Any] = {"query": query, "strategy": strategy or "semantic"}
    if top_k is not None:
        payload["top_k"] = top_k
    if threshold is not None:
        payload["threshold"] = threshold

    try:
        resp = httpx.post(
            f"{RAG_SERVICE_URL}/retrieve",
            json=payload,
            timeout=RAG_TIMEOUT_SECONDS,
        )
        resp.raise_for_status()
    except httpx.HTTPError as e:
        raise RagServiceError(f"rag-service-unreachable: {type(e).__name__}: {e}") from e

    data = resp.json()
    return list(data.get("results") or [])


def ingest_document(doc_id: str, title: str, content: str) -> int:
    """Call POST /ingest on the RAG service. Returns chunk count indexed."""
    payload = {"doc_id": doc_id, "title": title, "content": content}
    try:
        resp = httpx.post(
            f"{RAG_SERVICE_URL}/ingest",
            json=payload,
            timeout=RAG_TIMEOUT_SECONDS * 6,  # ingestion is heavier than retrieval
        )
        resp.raise_for_status()
    except httpx.HTTPError as e:
        raise RagServiceError(f"rag-service-unreachable: {type(e).__name__}: {e}") from e

    return int(resp.json().get("chunks_indexed", 0))
