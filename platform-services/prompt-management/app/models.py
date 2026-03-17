from datetime import datetime, UTC
from uuid import uuid4
from app.schemas import PromptCreate, PromptRecord, EvalRunRequest, EvalRunResult


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


def build_prompt_record(payload: PromptCreate) -> PromptRecord:
    now = utc_now_iso()
    return PromptRecord(
        prompt_id=f"prm-{uuid4().hex[:10]}",
        prompt_name=payload.prompt_name,
        prompt_type=payload.prompt_type,
        app_name=payload.app_name,
        agent_type=payload.agent_type,
        usecase_name=payload.usecase_name,
        environment=payload.environment,
        version=payload.version,
        template_text=payload.template_text,
        status=payload.status,
        approval_status=payload.approval_status,
        is_active=payload.is_active,
        tags=payload.tags,
        created_at=now,
        updated_at=now,
    )


def build_eval_result(payload: EvalRunRequest, actual_output: str, pass_fail: bool, score: float) -> EvalRunResult:
    return EvalRunResult(
        eval_id=f"eval-{uuid4().hex[:10]}",
        prompt_id=payload.prompt_id,
        input_query=payload.input_query,
        expected_tool=payload.expected_tool,
        expected_keywords=payload.expected_keywords,
        actual_output=actual_output,
        pass_fail=pass_fail,
        score=score,
    )
