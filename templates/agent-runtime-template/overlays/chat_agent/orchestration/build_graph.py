from __future__ import annotations

# Strategy dispatcher for chat_agent.
#
# Reads `reasoning.strategy` from the agent config (agent.yaml) and delegates
# to the corresponding strategy file under agents/strategies/.
#
# To add a new strategy: create agents/strategies/<name>.py with a build_graph()
# function — no changes needed here.

import importlib
from typing import Optional

from src.platform.usecase_config_loader import load_agent_config

_VALID_STRATEGIES = {
    "simple",
    "react",
    "self_corrective",
    "chain_of_thought",
    "multi_hop",
    "plan_execute",
    "reflection",
    "tree_of_thought",
}


def build_graph(checkpointer: Optional[object] = None):
    agent_cfg = load_agent_config("chat_agent")
    reasoning = agent_cfg.get("reasoning") or {}
    strategy = (reasoning.get("strategy") or "simple").strip()

    if strategy not in _VALID_STRATEGIES:
        print(f"[build_graph] unknown strategy '{strategy}', falling back to simple", flush=True)
        strategy = "simple"

    print(f"[build_graph] reasoning.strategy={strategy}", flush=True)

    mod = importlib.import_module(f"overlays.chat_agent.agents.strategies.{strategy}")
    return mod.build_graph(checkpointer)
