from typing import List, Optional, Literal
from pydantic import BaseModel, Field


PromptType = Literal["planner", "responder", "router", "summarizer"]
PromptStatus = Literal["draft", "active", "retired"]
ApprovalStatus = Literal["pending", "approved", "rejected"]
EnvironmentType = Literal["dev", "test", "prod"]


class PromptCreate(BaseModel):
    prompt_name: str = Field(..., min_length=1)
    prompt_type: PromptType
    app_name: str
    agent_type: str
    usecase_name: str
    environment: EnvironmentType = "dev"
    version: int = 1
    template_text: str = Field(..., min_length=1)
    status: PromptStatus = "draft"
    approval_status: ApprovalStatus = "pending"
    is_active: bool = False
    tags: List[str] = []


class PromptRecord(BaseModel):
    prompt_id: str
    prompt_name: str
    prompt_type: PromptType
    app_name: str
    agent_type: str
    usecase_name: str
    environment: EnvironmentType
    version: int
    template_text: str
    status: PromptStatus
    approval_status: ApprovalStatus
    is_active: bool
    tags: List[str]
    created_at: str
    updated_at: str


class PromptResolveResponse(BaseModel):
    prompt_id: str
    prompt_name: str
    prompt_type: PromptType
    app_name: str
    agent_type: str
    usecase_name: str
    environment: EnvironmentType
    version: int
    template_text: str
    status: PromptStatus
    approval_status: ApprovalStatus
    is_active: bool
    tags: List[str]


class EvalRunRequest(BaseModel):
    prompt_id: str
    input_query: str
    expected_tool: Optional[str] = None
    expected_keywords: List[str] = []


class EvalRunResult(BaseModel):
    eval_id: str
    prompt_id: str
    input_query: str
    expected_tool: Optional[str] = None
    expected_keywords: List[str] = []
    actual_output: str
    pass_fail: bool
    score: float
