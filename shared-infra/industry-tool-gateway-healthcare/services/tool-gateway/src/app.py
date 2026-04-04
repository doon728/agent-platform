from __future__ import annotations

import io
import httpx
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List

import jsonschema
from src.tools.db_registry import load_registry, get_registry, reload_registry
from src.tools.registry import (
    search_kb_handler, SearchKBInput,
    get_member_handler, GetMemberInput,
    write_case_note_handler, WriteCaseNoteInput,
    get_member_summary_handler, GetMemberSummaryInput,
    get_assessment_summary_handler, GetAssessmentSummaryInput,
    get_assessment_tasks_handler, GetAssessmentTasksInput,
    get_case_summary_handler, GetCaseSummaryInput,
)
from src.data.pg_store import store, _conn

app = FastAPI(title="Tool Gateway", version="v1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://localhost:5200"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    load_registry()


# ── Invocation contract ───────────────────────────────────────────────────────

class InvokeRequest(BaseModel):
    contract_version: str
    tool_name: str
    input: dict
    tenant_id: str | None = None
    user_id: str | None = None
    correlation_id: str | None = None


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"ok": True, "service": "tool-gateway", "version": "v1"}


# ── Domain Context REST endpoints (called directly from UI) ───────────────────

@app.get("/members")
def search_members(q: str = ""):
    members = store().search_members(q, limit=20)
    return {"ok": True, "members": members}


@app.get("/members/{member_id}")
def get_member_endpoint(member_id: str):
    result = store().get_member_summary(member_id)
    if not result.get("found"):
        return {"ok": False, "error": "Member not found"}
    return {"ok": True, "member": result}


@app.get("/members/{member_id}/cases")
def get_member_cases(member_id: str):
    cases = store().get_member_cases(member_id)
    return {"ok": True, "cases": cases}


@app.get("/cases/{case_id}")
def get_case(case_id: str):
    case = store().get_case(case_id)
    if not case:
        return {"ok": False, "error": "Case not found"}
    return {"ok": True, "case": case}


@app.get("/cases/{case_id}/assessments")
def get_case_assessments(case_id: str):
    assessments = store().get_case_assessments(case_id)
    return {"ok": True, "assessments": assessments}


@app.get("/assessments/{assessment_id}")
def get_assessment(assessment_id: str):
    result = store().get_assessment_summary(assessment_id)
    if not result.get("found"):
        return {"ok": False, "error": "Assessment not found"}
    return {"ok": True, "assessment": result}


@app.get("/assessments/{assessment_id}/tasks")
def get_assessment_tasks_endpoint(assessment_id: str):
    tasks = store().get_assessment_tasks(assessment_id)
    return {"ok": True, "tasks": tasks}


# ── Tool specs (read from DB registry) ───────────────────────────────────────

@app.get("/tools/specs")
def tool_specs():
    registry = get_registry()
    tools = []
    for rec in registry.values():
        entry: dict = {
            "name": rec.name,
            "description": rec.description,
            "primary_arg": rec.primary_arg,
            "mode": rec.mode,
            "tags": rec.tags,
            "input_schema": rec.input_schema,
            "output_schema": rec.output_schema,
        }
        if rec.db_type is not None:
            entry["db_type"] = rec.db_type
        if rec.strategy is not None:
            entry["strategy"] = rec.strategy
        tools.append(entry)

    return {"ok": True, "contract_version": "v1", "tools": tools}


# ── Tool invocation — URL-based dispatch ──────────────────────────────────────

@app.post("/tools/invoke")
def invoke_tool(req: InvokeRequest):
    registry = get_registry()
    rec = registry.get(req.tool_name)

    if rec is None:
        return {
            "ok": False,
            "error": {"code": "UNKNOWN_TOOL", "message": f"Unknown tool: {req.tool_name}"},
        }

    # Validate input against schema from DB
    if rec.input_schema:
        try:
            jsonschema.validate(instance=req.input, schema=rec.input_schema)
        except jsonschema.ValidationError as e:
            return {
                "ok": False,
                "tool_name": req.tool_name,
                "output": None,
                "error": {"code": "INPUT_VALIDATION_ERROR", "message": e.message},
            }

    try:
        response = httpx.post(rec.endpoint_url, json=req.input, timeout=30.0)
        response.raise_for_status()
        return {
            "ok": True,
            "tool_name": req.tool_name,
            "output": response.json(),
            "error": None,
        }
    except httpx.HTTPStatusError as e:
        return {
            "ok": False,
            "tool_name": req.tool_name,
            "output": None,
            "error": {"code": "TOOL_HTTP_ERROR", "message": str(e)},
        }
    except Exception as e:
        return {
            "ok": False,
            "tool_name": req.tool_name,
            "output": None,
            "error": {"code": "TOOL_EXECUTION_ERROR", "message": str(e)},
        }


# ── Internal dev handler routes (gateway calls itself for dev tools) ──────────
# These mount the existing Python handlers as HTTP routes.
# In production these are replaced by real backend URLs in the tools table.

@app.post("/internal/tools/search_kb")
def _internal_search_kb(payload: dict):
    out = search_kb_handler(SearchKBInput(**payload))
    return out.model_dump()


@app.post("/internal/tools/get_member")
def _internal_get_member(payload: dict):
    out = get_member_handler(GetMemberInput(**payload))
    return out.model_dump()


@app.post("/internal/tools/write_case_note")
def _internal_write_case_note(payload: dict):
    out = write_case_note_handler(WriteCaseNoteInput(**payload))
    return out.model_dump()


@app.post("/internal/tools/get_member_summary")
def _internal_get_member_summary(payload: dict):
    out = get_member_summary_handler(GetMemberSummaryInput(**payload))
    return out.model_dump()


@app.post("/internal/tools/get_assessment_summary")
def _internal_get_assessment_summary(payload: dict):
    out = get_assessment_summary_handler(GetAssessmentSummaryInput(**payload))
    return out.model_dump()


@app.post("/internal/tools/get_assessment_tasks")
def _internal_get_assessment_tasks(payload: dict):
    out = get_assessment_tasks_handler(GetAssessmentTasksInput(**payload))
    return out.model_dump()


@app.post("/internal/tools/get_case_summary")
def _internal_get_case_summary(payload: dict):
    out = get_case_summary_handler(GetCaseSummaryInput(**payload))
    return out.model_dump()


# ── Tool registry CRUD (for Tool Admin UI) ────────────────────────────────────

class ToolCreateRequest(BaseModel):
    name: str
    description: str
    endpoint_url: str
    primary_arg: str = "query"
    mode: str = "read"
    tags: List[str] = []
    db_type: str | None = None
    strategy: str | None = None
    input_schema: dict | None = None
    output_schema: dict | None = None
    status: str = "draft"   # new tools start as draft until developer deploys handler


class ToolUpdateRequest(BaseModel):
    description: str | None = None
    endpoint_url: str | None = None
    primary_arg: str | None = None
    mode: str | None = None
    tags: List[str] | None = None
    db_type: str | None = None
    strategy: str | None = None
    enabled: bool | None = None
    input_schema: dict | None = None
    output_schema: dict | None = None
    status: str | None = None


@app.get("/tools")
def list_tools():
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT name, description, endpoint_url, primary_arg, mode,
                       tags, db_type, strategy, enabled, created_at, updated_at,
                       input_schema, output_schema, status
                FROM tools
                ORDER BY name
                """
            )
            rows = cur.fetchall()

    tools = [
        {
            "name": r[0], "description": r[1], "endpoint_url": r[2],
            "primary_arg": r[3], "mode": r[4], "tags": list(r[5] or []),
            "db_type": r[6], "strategy": r[7], "enabled": r[8],
            "created_at": r[9].isoformat() if r[9] else None,
            "updated_at": r[10].isoformat() if r[10] else None,
            "input_schema": r[11], "output_schema": r[12], "status": r[13],
        }
        for r in rows
    ]
    return {"ok": True, "tools": tools}


@app.post("/tools")
def create_tool(req: ToolCreateRequest):
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO tools (name, description, endpoint_url, primary_arg, mode, tags, db_type, strategy, input_schema, output_schema, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (name) DO NOTHING
                RETURNING name
                """,
                (req.name, req.description, req.endpoint_url, req.primary_arg,
                 req.mode, req.tags, req.db_type, req.strategy,
                 req.input_schema, req.output_schema, req.status),
            )
            result = cur.fetchone()

    if not result:
        return {"ok": False, "error": f"Tool '{req.name}' already exists"}

    reload_registry()
    return {"ok": True, "name": req.name}


@app.patch("/tools/{name}")
def update_tool(name: str, req: ToolUpdateRequest):
    fields = []
    values = []

    if req.description is not None:
        fields.append("description = %s"); values.append(req.description)
    if req.endpoint_url is not None:
        fields.append("endpoint_url = %s"); values.append(req.endpoint_url)
    if req.primary_arg is not None:
        fields.append("primary_arg = %s"); values.append(req.primary_arg)
    if req.mode is not None:
        fields.append("mode = %s"); values.append(req.mode)
    if req.tags is not None:
        fields.append("tags = %s"); values.append(req.tags)
    if req.db_type is not None:
        fields.append("db_type = %s"); values.append(req.db_type)
    if req.strategy is not None:
        fields.append("strategy = %s"); values.append(req.strategy)
    if req.enabled is not None:
        fields.append("enabled = %s"); values.append(req.enabled)
    if req.input_schema is not None:
        fields.append("input_schema = %s"); values.append(req.input_schema)
    if req.output_schema is not None:
        fields.append("output_schema = %s"); values.append(req.output_schema)
    if req.status is not None:
        fields.append("status = %s"); values.append(req.status)

    if not fields:
        return {"ok": False, "error": "No fields to update"}

    fields.append("updated_at = now()")
    values.append(name)

    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE tools SET {', '.join(fields)} WHERE name = %s RETURNING name",
                values,
            )
            result = cur.fetchone()

    if not result:
        return {"ok": False, "error": f"Tool '{name}' not found"}

    reload_registry()
    return {"ok": True, "name": name}


@app.delete("/tools/{name}")
def delete_tool(name: str):
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM tools WHERE name = %s RETURNING name", (name,))
            result = cur.fetchone()

    if not result:
        return {"ok": False, "error": f"Tool '{name}' not found"}

    reload_registry()
    return {"ok": True, "name": name}


# ── Knowledge Base management endpoints ──────────────────────────────────────

@app.get("/kb/documents")
def list_kb_documents():
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT doc_id, title, COUNT(*) as chunk_count, MIN(ingested_at) as ingested_at
                FROM kb_documents
                GROUP BY doc_id, title
                ORDER BY MIN(ingested_at) DESC
                """
            )
            rows = cur.fetchall()

    docs = [
        {
            "doc_id": r[0],
            "title": r[1],
            "chunk_count": r[2],
            "ingested_at": r[3].isoformat() if r[3] else None,
        }
        for r in rows
    ]
    return {"ok": True, "documents": docs}


@app.get("/kb/stats")
def kb_stats():
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(DISTINCT doc_id), COUNT(*) FROM kb_documents")
            row = cur.fetchone()

    import os
    return {
        "ok": True,
        "total_documents": row[0] if row else 0,
        "total_chunks": row[1] if row else 0,
        "embedding_model": os.getenv("OPENAI_EMBED_MODEL", "text-embedding-3-small"),
    }


@app.post("/kb/ingest")
async def ingest_document(file: UploadFile = File(...)):
    from src.rag.ingest import split_text, upsert_chunk
    import os

    filename = file.filename or "uploaded_doc"
    raw = await file.read()

    ext = os.path.splitext(filename)[1].lower()
    if ext == ".pdf":
        try:
            import pypdf
            reader = pypdf.PdfReader(io.BytesIO(raw))
            text = "\n".join(page.extract_text() or "" for page in reader.pages)
        except ImportError:
            return {"ok": False, "error": "pypdf not installed — cannot parse PDF"}
    else:
        text = raw.decode("utf-8", errors="replace")

    doc_id = os.path.splitext(filename)[0]
    title = doc_id.replace("_", " ").replace("-", " ").title()
    chunks = split_text(text)

    if not chunks:
        return {"ok": False, "error": "No text content found in file"}

    for i, chunk in enumerate(chunks):
        row_id = f"{doc_id}::chunk::{i}"
        upsert_chunk(row_id, doc_id, title, chunk, i)

    return {"ok": True, "doc_id": doc_id, "title": title, "chunks_ingested": len(chunks)}


@app.delete("/kb/documents/{doc_id}")
def delete_kb_document(doc_id: str):
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM kb_documents WHERE doc_id = %s RETURNING doc_id",
                (doc_id,)
            )
            deleted = cur.rowcount

    if deleted == 0:
        return {"ok": False, "error": f"Document '{doc_id}' not found"}

    return {"ok": True, "doc_id": doc_id, "chunks_deleted": deleted}
