from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict

import yaml


def _deep_merge(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    """Merge override into base (dicts merge recursively, scalars replace)."""
    out = dict(base)
    for k, v in (override or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def _read_yaml(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    if not isinstance(data, dict):
        raise ValueError(f"Config file must be a YAML dict at top-level: {path}")
    return data


@dataclass(frozen=True)
class AppConfig:
    contract_version: str
    active_usecase: str
    capability_name: str


@dataclass(frozen=True)
class ToolGatewayConfig:
    url: str


@dataclass(frozen=True)
class PromptServiceConfig:
    url: str
    capability_name: str
    agent_type: str
    usecase_name: str
    environment: str


@dataclass(frozen=True)
class FeatureFlags:
    memory: bool
    hitl: bool
    observability: bool
    planner_mode: str


@dataclass(frozen=True)
class Config:
    app: AppConfig
    tool_gateway: ToolGatewayConfig
    prompt_service: PromptServiceConfig
    features: FeatureFlags


def load_config() -> Config:
    """
    Load YAML config and apply env overrides.
    Precedence: base.yaml -> env.yaml (optional) -> env vars.
    """
    repo_config_dir = Path(os.getenv("CONFIG_DIR", "/app/config"))
    base = _read_yaml(repo_config_dir / "base.yaml")

    env_name = os.getenv("APP_ENV", "").strip().lower()
    env_cfg = _read_yaml(repo_config_dir / f"{env_name}.yaml") if env_name else {}

    merged = _deep_merge(base, env_cfg)

    app = merged.get("app", {})

    merged = _deep_merge(
        merged,
        {
            "app": {
                "contract_version": os.getenv("CONTRACT_VERSION") or app.get("contract_version"),
                "capability_name": os.getenv("CAPABILITY_NAME") or app.get("capability_name"),
                "active_usecase": os.getenv("ACTIVE_USECASE") or app.get("active_usecase"),
            },
            "tool_gateway": {
                "url": os.getenv("TOOL_GATEWAY_URL") or merged.get("tool_gateway", {}).get("url"),
            },
            "prompt_service": {
                "url": os.getenv("PROMPT_SERVICE_URL") or merged.get("prompt_service", {}).get("url"),
                "capability_name": os.getenv("CAPABILITY_NAME")
                or merged.get("prompt_service", {}).get("capability_name")
                or app.get("capability_name"),
                "agent_type": os.getenv("AGENT_TYPE") or merged.get("prompt_service", {}).get("agent_type"),
                "usecase_name": os.getenv("USECASE_NAME") or merged.get("prompt_service", {}).get("usecase_name"),
                "environment": os.getenv("ENVIRONMENT") or merged.get("prompt_service", {}).get("environment"),
            },
        },
    )

    app = merged.get("app", {})
    tg = merged.get("tool_gateway", {})
    ff = merged.get("features", {})

    return Config(
        app=AppConfig(
            contract_version=str(app.get("contract_version", "v1")),
            active_usecase=str(app.get("active_usecase", "usecase")),
            capability_name=str(app.get("capability_name", "capability")),
        ),
        tool_gateway=ToolGatewayConfig(
            url=str(tg.get("url", "http://host.docker.internal:8080"))
        ),
        features=FeatureFlags(
            memory=bool(ff.get("memory", False)),
            hitl=bool(ff.get("hitl", False)),
            observability=bool(ff.get("observability", True)),
            planner_mode=str(ff.get("planner_mode", "rules")),
        ),
        prompt_service=PromptServiceConfig(
            url=str(merged.get("prompt_service", {}).get("url", "")),
            capability_name=str(
                merged.get("prompt_service", {}).get("capability_name", app.get("capability_name", ""))
            ),
            agent_type=str(merged.get("prompt_service", {}).get("agent_type", "chat_agent")),
            usecase_name=str(
                merged.get("prompt_service", {}).get("usecase_name", app.get("active_usecase", "usecase"))
            ),
            environment=str(merged.get("prompt_service", {}).get("environment", "dev")),
        ),
    )