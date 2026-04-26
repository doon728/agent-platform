from __future__ import annotations

import os
from typing import Any, Dict

import yaml

PLATFORM_ROOT = os.getenv("PLATFORM_ROOT", "/app")


def _load_yaml_if_exists(path: str) -> Dict[str, Any]:
    if not os.path.exists(path):
        return {}

    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def load_domain_config() -> Dict[str, Any]:
    """Load domain.yaml from the agent root — copied from capabilities/<cap>/domain.yaml at scaffold time."""
    return _load_yaml_if_exists(os.path.join(PLATFORM_ROOT, "domain.yaml"))


def load_agent_config(agent_type: str) -> Dict[str, Any]:
    """Load and merge per-concern overlay config files into the runtime context shape.

    New layout (Brij-style — preferred):
        overlays/<type>/overlay.yaml        — top manifest (agent_type, planner_mode, features)
        overlays/<type>/reasoning.yaml      — reasoning strategy
        overlays/<type>/rag.yaml            — retrieval config
        overlays/<type>/hitl.yaml           — HITL gating policy
        overlays/<type>/memory.yaml         — memory R/W policies
        overlays/<type>/tools/tools.yaml    — tool allow/deny
        overlays/<type>/prompts/prompts.yaml — prompts (legacy YAML format)

    Legacy fallback layout (still supported for backward compat):
        overlays/<type>/config/agent.yaml
        overlays/<type>/config/memory.yaml
        overlays/<type>/config/prompt-defaults.yaml
        overlays/<type>/config/workflow-rules.yaml
        overlays/<type>/agent_manifest.yaml

    Returns the same in-memory shape regardless of which layout is on disk, so downstream
    consumers (planner, executor, memory router, etc.) need no changes.
    """
    overlay_root = os.path.join(PLATFORM_ROOT, "overlays", agent_type)
    legacy_dir = os.path.join(overlay_root, "config")

    # ── Try new layout first ────────────────────────────────────────────────
    overlay_manifest = _load_yaml_if_exists(os.path.join(overlay_root, "overlay.yaml"))
    reasoning_yaml = _load_yaml_if_exists(os.path.join(overlay_root, "reasoning.yaml"))
    rag_yaml = _load_yaml_if_exists(os.path.join(overlay_root, "rag.yaml"))
    hitl_yaml = _load_yaml_if_exists(os.path.join(overlay_root, "hitl.yaml"))
    memory_yaml_new = _load_yaml_if_exists(os.path.join(overlay_root, "memory.yaml"))
    tools_yaml = _load_yaml_if_exists(os.path.join(overlay_root, "tools", "tools.yaml"))
    prompts_yaml_new = _load_yaml_if_exists(os.path.join(overlay_root, "prompts", "prompts.yaml"))

    using_new = bool(overlay_manifest)

    # ── Legacy fallback ─────────────────────────────────────────────────────
    legacy_agent = _load_yaml_if_exists(os.path.join(legacy_dir, "agent.yaml"))
    legacy_prompts = _load_yaml_if_exists(os.path.join(legacy_dir, "prompt-defaults.yaml"))
    legacy_memory = _load_yaml_if_exists(os.path.join(legacy_dir, "memory.yaml"))
    legacy_manifest = _load_yaml_if_exists(os.path.join(overlay_root, "agent_manifest.yaml"))
    workflow_rules = _load_yaml_if_exists(os.path.join(legacy_dir, "workflow-rules.yaml"))

    domain = load_domain_config()

    if using_new:
        # New layout — merge per-concern files into the shape downstream expects.
        agent_type_value = overlay_manifest.get("agent_role") or overlay_manifest.get("agent_type")
        planner_mode = overlay_manifest.get("planner_mode")
        features = overlay_manifest.get("features") or {}
        usecase_cfg: Dict[str, Any] = {}
        retrieval_cfg = rag_yaml or {}
        # approval_required is the master toggle the executor's _requires_approval() reads first.
        # Derive it from routing_rules: if any rule gates on approval, the system is "on" and
        # per-tool risk_levels decide actual gating. Hardcoding False here disables HITL entirely.
        _routing_rules = (hitl_yaml or {}).get("routing_rules", []) or []
        _approval_required = any(bool(r.get("requires_approval")) for r in _routing_rules)
        risk_cfg = {
            "approval_required": _approval_required,
            "risk_levels": (hitl_yaml or {}).get("risk_levels", {}),
        }
        hitl_cfg = {
            "adapter": (hitl_yaml or {}).get("adapter"),
            "routing_rules": _routing_rules,
            "sla": (hitl_yaml or {}).get("sla", {}),
        }
        tools_block = tools_yaml or {}
        prompts_block = prompts_yaml_new or {}
        memory_block = memory_yaml_new or {}
        reasoning_block = reasoning_yaml or {"strategy": "simple"}
        hard_routes: list[Any] = []
    else:
        # Legacy layout — same shape as before.
        usecase_cfg = legacy_agent.get("usecase") or {}
        agent_block = legacy_agent.get("agent") or {}
        agent_type_value = agent_block.get("type")
        planner_mode = agent_block.get("planner_mode")
        features = legacy_agent.get("features") or {}
        retrieval_cfg = legacy_agent.get("retrieval") or {}
        risk_cfg = legacy_agent.get("risk") or {}
        hitl_cfg = legacy_agent.get("hitl") or {}
        tools_block = legacy_agent.get("tools") or {}
        prompts_block = legacy_prompts
        memory_block = legacy_memory
        reasoning_block = legacy_agent.get("reasoning") or {"strategy": "simple"}
        hard_routes = legacy_agent.get("hard_routes") or []
        # Top-level features may also live in agent_manifest.yaml legacy
        if not features and legacy_manifest:
            features = legacy_manifest.get("features") or {}

    return {
        "usecase": {
            "name": usecase_cfg.get("name"),
            "description": usecase_cfg.get("description"),
        },
        "agent": {
            "type": agent_type_value,
            "planner_mode": planner_mode,
        },
        "tool_policy": {
            "mode": tools_block.get("mode", "selected"),
            "allowed_tools": tools_block.get("allowed", []),
        },
        "retrieval": retrieval_cfg,
        "risk": risk_cfg,
        "hitl": hitl_cfg,
        "features": features,
        "prompts": prompts_block,
        "memory": memory_block,
        "workflow_rules": workflow_rules,
        "domain": domain,
        "hard_routes": hard_routes,
        "reasoning": reasoning_block,
    }
