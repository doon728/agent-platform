from __future__ import annotations

from typing import Any, Dict

from src.platform.langgraph_runner import LangGraphRunner
from src.graph.build_graph import build_graph

runner = LangGraphRunner(build_graph)


def execute(prompt: str, ctx: Dict[str, Any]) -> Any:
    out = runner.run(prompt, ctx)

    if isinstance(out, dict) and out.get("result") == "APPROVAL_REQUIRED":
        return out

    if isinstance(out, dict) and "answer" in out:
        return {"answer": out["answer"]}

    if isinstance(out, str):
        return {"answer": out}

    return out