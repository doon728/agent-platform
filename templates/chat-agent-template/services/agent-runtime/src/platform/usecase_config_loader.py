from __future__ import annotations

import os
import yaml
from typing import Dict, Any


USECASES_ROOT = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    "usecases",
)


def _load_yaml(path: str) -> Dict[str, Any]:
    if not os.path.exists(path):
        raise RuntimeError(f"Config file not found: {path}")

    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def load_usecase_config(usecase_name: str) -> Dict[str, Any]:
    usecase_dir = os.path.join(USECASES_ROOT, usecase_name)

    usecase_yaml = os.path.join(usecase_dir, "usecase.yaml")
    prompts_yaml = os.path.join(usecase_dir, "prompts.yaml")

    usecase_config = _load_yaml(usecase_yaml)
    prompts_config = _load_yaml(prompts_yaml)

    return {
        "usecase": usecase_config,
        "prompts": prompts_config,
    }