from __future__ import annotations

# Container 1 — thin graph loader.
# After the split, this file is a pass-through — the actual graph is built
# dynamically based on agent_type from the environment.
# Strategy logic lives in Container 2. This only wires the topology.

import importlib
import os


def build_graph(checkpointer=None):
    agent_type = os.getenv("AGENT_TYPE", "chat_agent")
    module_path = f"overlays.{agent_type}.orchestration.build_graph"
    module = importlib.import_module(module_path)
    return module.build_graph(checkpointer)
