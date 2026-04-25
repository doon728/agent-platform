# Evals — chat_agent_simple

Per-overlay evaluation cases. Format: one `.yaml` per scenario, each with input prompt, expected behavior, scoring rubric.

## Structure

```
evals/
├── golden/                  ← regression test cases (must always pass)
│   └── basic_status.yaml
├── edge_cases/              ← edge cases worth tracking
│   └── missing_assessment_id.yaml
└── scorecards/              ← rubric definitions
    └── tone.yaml
```

## Example case (`golden/basic_status.yaml`)

```yaml
scenario: nurse asks for member status
input:
  prompt: "what is the current status of this assessment"
  ctx:
    assessment_id: A123
expected:
  tool_called: get_assessment_summary
  response_contains:
    - "Member"
    - "Status"
  format: bullets
```

Run via the prompt evaluation workbench in C4 (services/prompt-management/) once wired.
