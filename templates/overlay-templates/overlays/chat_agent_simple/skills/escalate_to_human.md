---
name: escalate_to_human
description: Escalate the conversation to a human reviewer when confidence is low or risk is high.
triggers:
  - escalate
  - supervisor
  - i don't know
  - low confidence
---
## When to escalate

Escalate to a human reviewer when:

1. Confidence in the answer is below the configured threshold.
2. The user explicitly asks for a human / supervisor.
3. The query touches a high-risk action (irreversible operation, sensitive data exposure, financial commitment).
4. The required tool is denied for this agent or unavailable.

## How to escalate

1. Pause current reasoning. Do not commit any non-reversible action.
2. Capture context: full conversation, last tool result, the specific reason for escalation.
3. Open an HITL approval ticket via `hitl.create_approval(reason, context)`.
4. Reply to the user: "I'm bringing in a human reviewer to make sure this is right. They'll follow up shortly."
5. Wait. Do not retry until the reviewer responds.

## Resume behavior

When the reviewer approves with edits, integrate their guidance into the response. When the reviewer rejects, acknowledge to the user and offer alternatives that don't require the rejected action.
