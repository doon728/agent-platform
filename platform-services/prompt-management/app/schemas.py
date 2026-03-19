from typing import List, Optional, Literal
from pydantic import BaseModel, Field


PromptType = Literal["planner", "responder", "router", "summarizer"]
PromptLifecycleStatus = Literal["draft", "active", "retired"]
PromptVersionStatus = Literal["draft", "approved", "rejected"]
EnvironmentType = Literal["dev", "test", "prod"]


class PromptCreate(BaseModel):
    prompt_name: str = Field(..., min_length=1)
    capability_name: str = Field(..., min_length=1)
    usecase_name: str = Field(..., min_length=1)
    agent_type: str = Field(..., min_length=1)
    prompt_type: PromptType
    environment: EnvironmentType = "dev"

    version: int = 1
    template_text: str = Field(..., min_length=1)

    model_provider: str = "openai"
    model_name: str = "gpt-4o-mini"
    temperature: float = 0

    lifecycle_status: PromptLifecycleStatus = "draft"
    version_status: PromptVersionStatus = "draft"
    is_active: bool = False
    tags: List[str] = []


class PromptRecord(BaseModel):
    prompt_id: str
    prompt_name: str
    capability_name: str
    usecase_name: str
    agent_type: str
    prompt_type: PromptType
    environment: EnvironmentType

    version: int
    template_text: str

    model_provider: Optional[str] = None
    model_name: Optional[str] = None
    temperature: Optional[float] = None

    lifecycle_status: PromptLifecycleStatus
    version_status: PromptVersionStatus
    is_active: bool

    tags: List[str] = []
    created_at: str
    updated_at: str


class PromptResolveResponse(BaseModel):
    prompt_id: str
    prompt_name: str
    capability_name: str
    usecase_name: str
    agent_type: str
    prompt_type: PromptType
    environment: EnvironmentType

    version: int
    template_text: str

    model_provider: Optional[str] = None
    model_name: Optional[str] = None
    temperature: Optional[float] = None

    lifecycle_status: PromptLifecycleStatus
    version_status: PromptVersionStatus
    is_active: bool


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