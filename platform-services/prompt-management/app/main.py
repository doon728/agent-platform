from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI, HTTPException, Query
from dotenv import load_dotenv
from pathlib import Path

from app.schemas import PromptCreate, EvalRunRequest
from app.models import build_prompt_record, build_eval_result
from app.store import (
    list_prompts,
    get_prompt_by_id,
    create_prompt_with_version,
    append_eval,
    resolve_active_prompt,
    approve_prompt_version,
    activate_prompt_version,
)

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

app = FastAPI(title="Prompt Management Service", version="v1")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"ok": True, "service": "prompt-management"}


@app.post("/prompts")
def create_prompt(payload: PromptCreate):
    record = build_prompt_record(payload)
    saved = create_prompt_with_version(record.model_dump())
    return {"ok": True, "prompt": saved}


@app.get("/prompts")
def get_prompts():
    return {"ok": True, "prompts": list_prompts()}


@app.get("/prompts/resolve")
def resolve_prompt(
    capability_name: str = Query(...),
    usecase_name: str = Query(...),
    agent_type: str = Query(...),
    prompt_type: str = Query(...),
    environment: str = Query(...),
):
    record = resolve_active_prompt(
        capability_name=capability_name,
        usecase_name=usecase_name,
        agent_type=agent_type,
        prompt_type=prompt_type,
        environment=environment,
    )
    if not record:
        raise HTTPException(status_code=404, detail="No active approved prompt found for requested scope")
    return {"ok": True, "prompt": record}


@app.get("/prompts/{prompt_id}")
def get_prompt(prompt_id: str):
    record = get_prompt_by_id(prompt_id)
    if not record:
        raise HTTPException(status_code=404, detail=f"Prompt not found: {prompt_id}")
    return {"ok": True, "prompt": record}


@app.post("/prompts/{prompt_id}/approve")
def approve_prompt(prompt_id: str, version: int = Query(...)):
    row = approve_prompt_version(prompt_id, version)
    if not row:
        raise HTTPException(status_code=404, detail="Prompt version not found")
    return {"ok": True, "approved_version": row}


@app.post("/prompts/{prompt_id}/activate")
def activate_prompt(prompt_id: str, version: int = Query(...)):
    row = activate_prompt_version(prompt_id, version)
    if not row:
        raise HTTPException(status_code=404, detail="Prompt version not found")
    if isinstance(row, dict) and row.get("error") == "version_not_approved":
        raise HTTPException(status_code=400, detail="Version must be approved before activation")
    return {"ok": True, "activation": row}


@app.post("/eval/run")
def run_eval(payload: EvalRunRequest):
    prompt = get_prompt_by_id(payload.prompt_id)
    if not prompt:
        raise HTTPException(status_code=404, detail=f"Prompt not found: {payload.prompt_id}")

    actual_output = f"[SIMULATED_EVAL] prompt_id={payload.prompt_id} input={payload.input_query}"

    keyword_hits = 0
    for keyword in payload.expected_keywords:
        if keyword.lower() in actual_output.lower():
            keyword_hits += 1

    keyword_score = 1.0 if not payload.expected_keywords else keyword_hits / max(len(payload.expected_keywords), 1)
    tool_score = 1.0 if not payload.expected_tool else 0.5
    score = round((keyword_score + tool_score) / 2, 2)
    pass_fail = score >= 0.5

    result = build_eval_result(
        payload=payload,
        actual_output=actual_output,
        pass_fail=pass_fail,
        score=score,
    )
    append_eval(result.model_dump())

    return {"ok": True, "result": result.model_dump()}