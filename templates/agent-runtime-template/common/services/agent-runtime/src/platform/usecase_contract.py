from __future__ import annotations

from importlib import import_module
from typing import Any, Dict, Tuple

from src.platform.langgraph_runner import LangGraphRunner
from src.platform.manifest_loader import load_agent_manifest


def _resolve_graph_module(manifest: Dict[str, Any]) -> Tuple[str, str]:
    agent_type = manifest.get("agent_type") or "chat_agent"
    entrypoint = manifest.get("entrypoint", {}) or {}

    graph_path = entrypoint.get("orchestration_graph")
    if not graph_path:
        raise ValueError("agent_manifest.yaml missing entrypoint.orchestration_graph")

    module_path = graph_path.replace("/", ".").replace(".py", "")
    module_name = f"src.overlays.{agent_type}.{module_path}"
    return module_name, "build_graph"


def _load_graph_builder():
    manifest = load_agent_manifest()
    module_name, func_name = _resolve_graph_module(manifest)
    module = import_module(module_name)
    return getattr(module, func_name)


def execute(prompt: str, ctx: Dict[str, Any]) -> Any:
    build_graph = _load_graph_builder()
    runner = LangGraphRunner(build_graph)

    out = runner.run(prompt, ctx)

    if isinstance(out, dict) and out.get("result") == "APPROVAL_REQUIRED":
        return out

    if isinstance(out, dict) and "answer" in out:
        return {"answer": out["answer"]}

    if isinstance(out, str):
        return {"answer": out}

    return out