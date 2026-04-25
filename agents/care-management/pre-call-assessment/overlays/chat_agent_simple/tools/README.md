# Tools — chat_agent_simple

Tools available to this overlay. Tool registration + allow/deny lives in `config/agent.yaml` for now (legacy); this folder is the future home for per-tool definitions when overlays gain inline tool authoring.

## Currently expected tools (registered in `config/agent.yaml`)

- `get_assessment_summary` — fetch clinical context for an assessment.
- `get_assessment_tasks` — list open tasks for an assessment.
- `write_case_note` — append a case note.
- `search_kb` — RAG over policy / guideline knowledge base.
- `get_member` / `get_member_summary` — member profile lookups.

When migrating to per-tool definitions, each tool gets its own subfolder with `tool.yaml` (schema) + optional `prompts/` (tool-specific instructions) + `evals/`.
