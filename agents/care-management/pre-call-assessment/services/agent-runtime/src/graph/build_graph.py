import importlib


def _load_overlay_module():
    from src.platform.config import load_config

    cfg = load_config()
    agent_type = getattr(cfg.app, "agent_type", "chat_agent")
    module_path = f"overlays.{agent_type}.orchestration.build_graph"
    return importlib.import_module(module_path)


def build_graph(checkpointer=None):
    module = _load_overlay_module()
    return module.build_graph(checkpointer)


def run_graph(prompt: str, ctx=None):
    app = build_graph()
    initial_state = {
        "prompt": prompt,
        "ctx": ctx or {},
        "history": [],
    }
    out = app.invoke(initial_state)
    if isinstance(out, dict) and "answer" in out:
        return out["answer"]
    return out