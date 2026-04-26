# Section 3 — New Usecase Checklist: chat_agent

> **This checklist covers `chat_agent` only.** Each agent type has its own checklist because the files that matter differ. See:
> - `03-new-usecase-checklist-summary-agent.md` — for `summary_agent`
> - `03-new-usecase-checklist-workflow-agent.md` — for `workflow_agent`
> - `03-new-usecase-checklist-supervisor-agent.md` — for `supervisor_agent`

## The Right Mental Model First

A usecase maps to an **agent repo**. One usecase = one agent repo = one deployment.

When you build for a new usecase, you do not modify an existing agent's files. You **generate a new agent repo** from the template using the Create Agent flow in the Admin UI. The template scaffolds a complete, working repo with all the right files in the right places.

After generation, you have a new repo that looks identical in structure to every other agent repo. Your job is then to go into that repo and configure it for your specific usecase — change the values, not the structure.

**The checklist below is what you do inside that newly generated repo.**

---

## Two Scenarios

**Scenario A — New usecase, same capability**
Example: Adding `UC_PostDischarge` to the `care-management` capability.
Same domain (healthcare, members, cases), different workflow and tools.
Most config changes are minor — update usecase name, swap tools, update prompt.

**Scenario B — New capability entirely**
Example: Building a `benefits-management` agent from scratch.
Different domain, different entities, different tools, different business logic.
More changes needed — full prompt rewrite, new tool routing rules, new ID extraction patterns.

---

## Step 1 — Generate the Repo (Admin UI)

Go to Agent Admin UI → Create Agent. Fill in:
- Capability name
- Usecase name
- Agent type

The platform scaffolds a complete repo under:
```
generated-repos/{capability}/usecases/{usecase}/{agent-repo}/
```

Everything from here is inside that generated repo.

---

## Step 2 — Set the Agent Identity

**`overlays/chat_agent/overlay.yaml`**

This is the agent's identity card. Update the three identity fields to match your usecase:
```yaml
capability_name: care-management      # your capability
usecase_name: UC_PostDischarge        # your usecase
agent_type: chat_agent
```

These three values must be identical across every file that references them. Getting this wrong causes silent failures — prompts resolve to null, registry lookup fails.

---

## Step 3 — Configure Tools and Risk

**`overlays/chat_agent/overlay.yaml + reasoning.yaml + rag.yaml + hitl.yaml + tools/tools.yaml`**

Define which tools this agent can use and what risk level each carries:
```yaml
agent:
  tools:
    mode: selected
    allowed:
      - get_discharge_summary
      - get_follow_up_tasks
      - write_discharge_note
  risk:
    risk_levels:
      write_discharge_note: high
      get_discharge_summary: low
```

Every tool name here must be registered in the Tool Gateway. If a tool is listed here but not in the gateway, you get a runtime error.

---

## Step 4 — Write the System Prompt

**`overlays/chat_agent/prompts/prompts.yaml`**

Replace the default prompt with your domain-specific persona and format rules:
```yaml
system_prompt: |
  You are a post-discharge care assistant helping nurses manage follow-up care.
  ALWAYS use bullet points. Never respond in paragraph form.
  Group under headers: **Patient**, **Discharge Summary**, **Follow-up Tasks**, **Alerts**.
```

This is the most important file for making the agent feel right for your usecase.

---

## Step 5 — Update Planner Routing (if new domain)

**`overlays/chat_agent/agents/llm_planner.py`**

Only needed for Scenario B (new capability with different domain entities).

Two things to update:

**ID extraction patterns** — match your domain's identifiers:
```python
# care-management used: asmt-001, m-001
# benefits uses: pol-001 (policy), clm-001 (claim)

def _extract_policy_number(text: str) -> str | None:
    m = re.search(r"\b(pol-\d+)\b", text or "", re.IGNORECASE)
    return m.group(1) if m else None
```

**Hard routing rules** — replace with your domain's tool routing logic:
```python
# Replace: "if assessment mentioned → get_assessment_summary"
# With:    "if policy mentioned → get_policy_details"
```

For Scenario A (same capability, new usecase), the existing routing rules often carry over with minor changes.

---

## Step 6 — Register Prompts in Prompt Service

**`platform-services/prompt-management/data/prompts.json`**

Add seed records for your new usecase. One per prompt type:
```json
{
  "capability_name": "care-management",
  "usecase_name": "UC_PostDischarge",
  "agent_type": "chat_agent",
  "prompt_type": "planner",
  "content": "You are a planning agent for post-discharge care...",
  "version": "1.0",
  "environment": "dev",
  "is_active": true
}
```

Then seed:
```bash
python seed_prompts.py --url http://localhost:8101
```

**Known gotcha:** `capability_name` must use a hyphen (`care-management`), never an underscore (`care_management`). Mismatch causes prompt resolution to silently fall back to the hardcoded default — no error thrown.

---

## What You Do NOT Need to Change

These files are generic platform code — reuse them as-is for every usecase:

| File | Why you don't touch it |
|---|---|
| `executor.py` | HITL and tool execution logic is generic |
| `chat_responder.py` | Response formatting is driven by prompt-defaults.yaml, not code |
| `memory.yaml` | Memory scopes are reusable; only change if you need different retention |
| `build_graph.py` | Planner → executor → responder wiring never changes for chat_agent |
| `services/agent-runtime/src/platform/` | Platform core — never edit |

---

## Critical Invariants

These three values must be **identical** across every file that references them:

| Value | Must match in |
|---|---|
| `capability_name` | `overlay.yaml`, `base.yaml`, prompt seed records |
| `usecase_name` | `overlay.yaml`, `base.yaml`, prompt seed records |
| `agent_type` | `overlay.yaml`, `base.yaml`, prompt seed records |

And always: tool names in `agent.yaml` must exist in the Tool Gateway.

---

## Minimum Change Summary

**Scenario A — New usecase, same capability, same tools:**
1. `overlay.yaml` — update `usecase_name`
2. `base.yaml` — update `usecase_name`
3. `prompt-defaults.yaml` — update system prompt
4. `prompts.json` — add seed records, run `seed_prompts.py`

**Scenario B — New capability, new tools, new domain:**
1. Everything in Scenario A, plus:
2. `agent.yaml` — update tools allowed list and risk levels
3. `llm_planner.py` — update ID extraction and routing rules
4. Register new tools in the Tool Gateway first
