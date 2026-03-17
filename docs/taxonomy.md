AGENT PLATFORM TAXONOMY (TARGET STATE)

LEVEL 1 — CAPABILITY
A business domain or platform capability.

Examples:
- care_management
- payment_integrity
- appeals_management
- fraud_waste_abuse
- provider_operations

Each capability will eventually map to:
- a real enterprise application
- its own UI
- its own agent runtime(s)
- its own tool gateway integrations


LEVEL 2 — USE CASE
A concrete AI problem inside a capability.

Examples under care_management:
- nurse_assistant_chat
- assessment_summarization
- care_gap_recommendation
- case_note_autodraft

Examples under appeals_management:
- appeal_intake_assist
- appeal_clinical_summary
- determination_letter_draft


LEVEL 3 — AGENT TYPE
How AI reasoning is orchestrated.

Types:
- chat_agent (interactive reasoning)
- workflow_agent (multi-step cognitive pipeline)
- multi_agent (specialized agents collaborating)
- batch_agent (offline processing)
- copilot_agent (embedded assistance)


LEVEL 4 — APPLICATION
Actual UI / system where agent runs.

Examples:
- CM Nurse App
- Supervisor Dashboard
- Appeals Portal
- IVR Bot
- Batch Processing Engine


IMPORTANT PRINCIPLES

1. Capability owns tools + policies + data contracts.
2. Use case owns prompts + reasoning config.
3. Agent type owns runtime orchestration logic.
4. Application owns UX + integration surface.
5. Generated repos are per capability → per use case.
6. Templates must NOT contain hardcoded business use cases.