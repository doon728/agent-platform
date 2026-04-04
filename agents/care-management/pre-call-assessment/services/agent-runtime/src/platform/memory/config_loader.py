from __future__ import annotations

from typing import Any, Dict


def load_memory_config(usecase_cfg: Dict[str, Any]) -> Dict[str, Any]:
    memory_cfg = usecase_cfg.get("memory") or {}
    if not isinstance(memory_cfg, dict):
        return {"enabled": False}
    return memory_cfg