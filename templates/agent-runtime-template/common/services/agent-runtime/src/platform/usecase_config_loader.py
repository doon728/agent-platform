from __future__ import annotations

import os
import yaml
from typing import Dict, Any


PLATFORM_ROOT = os.getenv("PLATFORM_ROOT", "/app")


def _load_yaml_if_exists(path: str) -> Dict[str, Any]:
    if not os.path.exists(path):
        return {}

    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def load_agent_config(agent_type: str) -> Dict[str, Any]:
    config_dir = os.path.join(PLATFORM_ROOT, "overlays", agent_type, "config")

    raw = _load_yaml_if_exists(os.path.join(config_dir, "agent.yaml"))
    prompts = _load_yaml_if_exists(os.path.join(config_dir, "prompt-defaults.yaml"))
    memory = _load_yaml_if_exists(os.path.join(config_dir, "memory.yaml"))
    workflow_rules = _load_yaml_if_exists(os.path.join(config_dir, "workflow-rules.yaml"))

    usecase_cfg = raw.get("usecase") or {}
    agent_cfg = raw.get("agent") or {}
    tools_cfg = raw.get("tools") or {}
    retrieval_cfg = raw.get("retrieval") or {}
    risk_cfg = raw.get("risk") or {}
    features_cfg = raw.get("features") or {}

    return {
        "usecase": {
            "name": usecase_cfg.get("name"),
            "description": usecase_cfg.get("description"),
        },
        "agent": {
            "type": agent_cfg.get("type"),
            "planner_mode": agent_cfg.get("planner_mode"),
        },
        "tool_policy": {
            "mode": tools_cfg.get("mode", "selected"),
            "allowed_tools": tools_cfg.get("allowed", []),
        },
        "retrieval": retrieval_cfg,
        "risk": risk_cfg,
        "features": features_cfg,
        "prompts": prompts,
        "memory": memory,
        "workflow_rules": workflow_rules,
    }