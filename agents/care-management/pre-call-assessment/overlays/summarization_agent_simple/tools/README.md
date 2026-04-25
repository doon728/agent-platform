# Tools — summarization_agent_simple

This overlay is read-only summarization. It reads assessment / case / member data via tools but does not write.

Tool registration lives in `config/agent.yaml`. Currently:

- `get_assessment_summary` — fetch assessment context.
- `get_case_summary` — fetch case-level context.
- `get_member_summary` — fetch member context across cases.

Future per-tool definitions land here (one folder per tool with `tool.yaml` + optional `prompts/` + `evals/`).
