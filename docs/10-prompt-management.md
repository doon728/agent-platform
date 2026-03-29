# Section 10 — Prompt Management

## What Prompt Management Is and Why It Matters

A prompt is not just a string. It is the agent's instructions — how it thinks, what it prioritizes, how it talks to the nurse. Change the prompt and you change the agent's behavior without touching any code.

Without prompt management, prompts are static files baked into the container. To change a prompt you edit a YAML file, rebuild the container, and redeploy. No history of what changed. No way to test before activating. No approval process. No rollback.

With prompt management, prompts are versioned records. You write a new version, evaluate it, get it approved, activate it — all without touching files or redeploying. The running agent picks up the new prompt on the next request.

---

## Two Sources of Prompts

Every agent has two sources it can pull prompts from, in priority order:

```
1. Prompt Management Service  ← checked first, if enabled
        │
        │  if not found or service unavailable
        ▼
2. prompt-defaults.yaml       ← local fallback, always present
```

This means:
- An agent always works, even if the Prompt Management Service is down — it falls back to the local file
- The local file is the baseline. The service is the override layer.
- You can run the full platform without the Prompt Management Service — local prompts work fine for dev

---

## Prompt Types

Each agent declares which prompt types it uses in `agent_manifest.yaml`. The platform supports:

| Prompt Type | Used by | Purpose |
|---|---|---|
| `planner` | chat_agent | Drives the LLM planner — which tool to call, how to extract IDs, routing rules |
| `responder` | chat_agent | Drives the responder — tone, format, clinical language, bullet structure |
| `assessment_summary` | summary_agent | How to synthesize an assessment into a structured summary |
| `case_summary` | summary_agent | How to synthesize a case across multiple assessments |
| `member_summary` | summary_agent | How to produce a holistic member view across all cases |
| `router` | supervisor_agent | How to decide which sub-agent handles this conversation |
| `summarizer` | summary_agent | General summarization instructions |

Each is stored and versioned independently. Changing the responder prompt does not affect the planner prompt.

---

## Prompt Resolution — Step by Step

At the start of each request, the platform resolves the active prompt for each required type:

```
Request arrives
     │
     ▼
platform/prompt/prompt_client.py
     │
     ▼  GET /prompts/resolve?capability_name=care-management
     │                       &agent_type=chat_agent
     │                       &usecase_name=cm_assistant
     │                       &prompt_type=planner
     │                       &environment=prod
     │
     ▼
Prompt Management Service
     │  queries: prompts + prompt_versions + prompt_activations
     │  returns: active, approved version for this scope
     │
     ├── found → return template_text
     │
     └── not found / timeout (3s) → fallback to prompt-defaults.yaml
     │
     ▼
Resolved prompt injected into ctx["prompts"]["planner_system_prompt"]
     │
     ▼
LLM planner uses ctx["prompts"] as its system prompt
```

The resolution scope is: `capability_name + agent_type + usecase_name + prompt_type + environment`. This means you can have different active prompts for the same agent type in dev vs prod, or for different usecases.

---

## Prompt Lifecycle — Draft → Approved → Active

Every prompt version goes through a lifecycle before it can be used by a running agent:

```
Write new version
     │
     ▼
status: draft          ← exists, not approved, not active
     │
     ▼
POST /prompts/{id}/approve
     │
     ▼
status: approved       ← reviewed and signed off, but not yet active
     │
     ▼
POST /prompts/{id}/activate
     │
     ▼
status: active         ← running agents pick this up on next request
```

**Why the two-step (approve then activate)?**
Approval is a review gate — a human confirms the prompt is clinically correct and safe. Activation is the deployment decision — when to go live. These are separate concerns. You might approve a prompt on Tuesday but activate it on Thursday during a low-traffic window.

**Only one active version per scope at a time.** Activating a new version automatically retires the previous one.

---

## Prompt Versioning — What Gets Stored

Each prompt version is a separate record in the database:

```
prompts table
├── id (prompt_id)
├── prompt_name
├── capability_name        ← e.g. "care-management"
├── agent_type             ← e.g. "chat_agent"
├── usecase_name           ← e.g. "cm_assistant"
├── prompt_type            ← e.g. "planner"
├── environment            ← "dev" / "staging" / "prod"
├── tags                   ← ["care_management", "planner"]
└── lifecycle_status       ← draft / active / retired

prompt_versions table
├── version_id
├── prompt_id              ← FK to prompts
├── version_number
├── template_text          ← the actual prompt string
├── model_provider         ← "openai"
├── model_name             ← "gpt-4o-mini"
├── temperature
├── version_status         ← draft / approved / rejected
└── created_at

prompt_activations table
├── prompt_id
├── version_id             ← which version is currently active
└── activated_at
```

The `template_text` is the full prompt. Model and temperature are stored alongside so you know exactly which model the prompt was written and tested for.

---

## The Local Fallback — prompt-defaults.yaml

Every agent overlay has a `prompt-defaults.yaml`. This is the ground truth for prompts in dev and the fallback in production.

```yaml
# overlays/chat_agent/config/prompt-defaults.yaml

planner_system_prompt: |
  You are a care management assistant helping nurses during member calls.

  TOOL SELECTION RULES:
  - If the user asks about assessment findings, tasks, or scores → get_assessment_summary
  - If the user asks about open tasks or action items → get_assessment_tasks
  - If the user wants to write or create a note → write_case_note
  - If the user asks a clinical protocol or policy question → search_kb
  - If the user asks about member demographics or contact info → get_member
  - If the user asks for a member overview → get_member_summary

  Always extract IDs from the message or conversation history:
  - Assessment IDs match pattern: asmt-XXXX
  - Member IDs match pattern: m-XXXX
  - Case IDs match pattern: c-XXXX

responder_system_prompt: |
  You are a clinical assistant. Respond only using data returned by tools.
  ALWAYS use bullet points. Never respond in paragraph form.
  Group bullets under bold headers: **Member**, **Concerns**, **Tasks**, **Notes**.
  Use clinical language appropriate for a registered nurse.
  Never guess or fabricate clinical information.
```

The summary agent has its own prompt-defaults.yaml with assessment_summary, case_summary, and member_summary prompts.

---

## Planner Prompt vs Responder Prompt — Different Jobs

These are the two most important prompts in a chat_agent and they do very different things:

| | Planner prompt | Responder prompt |
|---|---|---|
| **Job** | Decide what to do | Say it clearly |
| **Input** | User message + conversation history + tool schema | Tool result (or LLM route signal) |
| **Output** | Structured: `{tool, argument}` or `LLM_ROUTE` | Natural language response to the nurse |
| **LLM call** | Yes — structured output (Pydantic schema) | Yes — free text generation |
| **What to tune** | Tool selection rules, ID extraction patterns, routing conditions | Tone, format, clinical language, bullet structure |
| **Wrong planner prompt** | Agent calls wrong tool, misses IDs, routes incorrectly | |
| **Wrong responder prompt** | | Agent uses wrong tone, wrong format, makes up content |

They must be tuned independently. A perfect planner with a bad responder gives correct tool calls but poorly formatted responses. A perfect responder with a bad planner gives beautifully formatted wrong answers.

---

## Evaluation — Testing Prompts Before Activating

The Prompt Management Service has a basic evaluation endpoint:

```
POST /eval/run
{
  "prompt_id": "...",
  "version_id": "...",
  "test_cases": [
    {
      "input": "What are the open tasks for assessment asmt-1001?",
      "expected_keywords": ["task", "assessment", "asmt-1001"]
    }
  ]
}
```

Each test case returns:
- `pass_fail` — did the output contain the expected keywords
- `score` — keyword match rate
- `output` — the actual LLM response

**Current limitation:** evaluation is keyword-based, not semantic. "The assessment has three open tasks" passes if "task" and "assessment" are in expected_keywords — but it cannot evaluate clinical correctness, appropriate tone, or whether the right tool was called. LLM-based evaluation (a judge model that scores the response) is the roadmap item.

---

## Seed Data — Bootstrapping Prompts

The Prompt Management Service ships with seed data (`data/prompts.json`) — 7 prompt templates covering the care management usecase:

- planner (chat_agent, cm_assistant)
- responder (chat_agent, cm_assistant)
- assessment_summary (summary_agent, cm_assistant)
- case_summary (summary_agent, cm_assistant)
- member_summary (summary_agent, cm_assistant)

Running `seed_prompts.py` loads these into the database. Safe to re-run — it skips records that already exist.

---

## Prompt Governance UI — What It Shows Today

The Prompt Governance tab in the Agent Registry UI shows:
- All prompt records for the current agent
- Version history per prompt type
- Current active version
- Approve / Activate buttons per version
- Lifecycle status (draft / active / retired)

**What it does not show yet:**
- Diff view between versions
- Eval results inline
- Rollback button (activate a previous version)
- A/B test configuration

---

## Config — Enabling the Prompt Service

Prompt service resolution is controlled in `agent.yaml`:

```yaml
features:
  prompt_versioning: true    # false = always use local prompt-defaults.yaml

prompt_service:
  capability_name: care-management
  agent_type: chat_agent
  usecase_name: cm_assistant
  environment: prod          # dev / staging / prod
```

Set `prompt_versioning: false` to skip the service entirely and always use local files. Useful in dev when you're iterating on prompts directly in the YAML.

---

## Current Limitations & Roadmap

**Keyword-based evaluation only**
Eval scores keyword presence, not semantic correctness or clinical quality. An LLM judge model would produce far better evaluation scores.

**No diff view**
Prompt Governance UI shows version history but no side-by-side diff between versions. Hard to see what changed between v1 and v2.

**No rollback button**
To roll back, you manually activate an older version. UI should make this a one-click operation.

**No A/B testing**
Today one version is active at a time — 100% of traffic. A/B testing would split traffic between two versions and compare outputs. Not built.

**No prompt analytics**
No tracking of which prompt version was used for which request, what the LLM returned, or how it correlated with user satisfaction or clinical outcomes.

**Summary agent prompts not in service today**
`prompt_versioning: false` in summary_agent's agent.yaml — summary prompts are always loaded from local file. Not wired to the Prompt Management Service yet.

### Roadmap summary

| Gap | What's needed |
|---|---|
| LLM-based evaluation | Judge model that scores clinical correctness, tone, format |
| Diff view | Side-by-side version comparison in Prompt Governance UI |
| Rollback | One-click activate-previous in UI |
| A/B testing | Traffic split between two active versions, output comparison |
| Prompt analytics | Per-request logging of which version ran + output tracking |
| Summary agent prompts | Wire summary_agent to Prompt Management Service |
| Config-driven model per prompt | Active prompt version specifies model + temperature → overrides agent.yaml default |

---

## These Capabilities Are Platform-Owned — Not Replaced by AgentCore

AgentCore handles orchestration. It does not provide:

- A prompt versioning and approval lifecycle
- Per-agent, per-usecase, per-environment prompt resolution
- Evaluation framework for prompt quality
- Prompt governance UI and approval workflows

These are your platform's prompt management capabilities — built once in the Prompt Management Service, used by every agent. When running on AgentCore, the prompt client may point at a different service endpoint — but the versioning model, approval lifecycle, and governance workflow all still need to exist and be built.

> **Prompt management capabilities must be built regardless of whether AgentCore is eventually adopted.**
