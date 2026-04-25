from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

import yaml

from platform_core.config import load_config


def load_agent_manifest() -> Dict[str, Any]:
    cfg = load_config()
    agent_type = cfg.prompt_service.agent_type or "chat_agent"

    manifest_path = Path(f"/app/overlays/{agent_type}/agent_manifest.yaml")

    if not manifest_path.exists():
        raise FileNotFoundError(f"Agent manifest not found: {manifest_path}")

    with manifest_path.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}

    if not isinstance(data, dict):
        raise ValueError("agent_manifest.yaml must contain a top-level mapping")

    return data