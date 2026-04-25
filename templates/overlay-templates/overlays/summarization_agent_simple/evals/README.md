# Evals — summarization_agent_simple

Per-overlay evaluation cases for summarization quality.

## Suggested cases

- Assessment summary — golden cases with known input + expected JSON shape + tone.
- Case summary across multiple assessments.
- Member summary across multiple cases.

## Format

```yaml
scenario: assessment summary for active depression case
input:
  assessment_id: A123
expected:
  shape:
    summary: string
    key_concerns: list
    last_action: string
    next_steps: list
  must_contain:
    - "PHQ-9"
  must_not_contain:
    - "I think"
    - "maybe"
```
