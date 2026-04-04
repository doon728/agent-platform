# Simple reasoning strategy for chat_agent.
#
# This is the default strategy: hard routing (deterministic phrase matching)
# followed by LLM structured output for tool selection.
#
# Current reasoning logic lives in llm_planner.py.
# When reasoning.strategy wiring is implemented (platform-core), this file
# will contain the extracted strategy logic and llm_planner.py will
# dispatch to it via: strategy = load_strategy(cfg.reasoning.strategy)
