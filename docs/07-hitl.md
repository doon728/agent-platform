# Section 7 — HITL (Human-in-the-Loop)

## What HITL Is and Why It Exists

HITL is not gating a database write. It is gating the agent's judgment.

The human approver is not checking whether the technical write operation will succeed — they are validating whether the AI's decision to take that action was correct given the clinical context. The agent proposed something. A human decides if that proposal is sound before it becomes reality.

This distinction matters for how you think about HITL routing. The question is not "is this a write tool?" — it is "does this action require a human to verify the AI's reasoning before it executes?"

---

## How HITL Is Configured

HITL is driven entirely by `agent.yaml`. No code changes needed to enable, disable, or reconfigure it.

```yaml
risk:
  approval_required: true        # master switch — false disables HITL entirely for this agent
  risk_levels:
    write_case_note: high        # triggers HITL
    get_member_summary: low      # no HITL
    get_case_summary: low
    search_kb: low

hitl:
  adapter: internal              # which backend handles approvals (see Adapter Pattern below)
  routing_rules:
    - risk_level: high
      requires_approval: true
    - risk_level: medium
      requires_approval: true
    - risk_level: low
      requires_approval: false
  sla:
    timeout_minutes: 60          # how long before an approval request expires
```

**Risk level is tool-level only today.** The executor looks up the tool name in `risk_levels`, gets a level, checks the routing rules, and decides. No content inspection, no member context, no user role. See the Roadmap section for where this is heading.

---

## The Full HITL Flow

```
Turn 1 — user sends message
     │
     ▼
Planner selects: write_case_note
     │
     ▼
Executor: _requires_approval("write_case_note", ctx)
     │    looks up risk_levels → "high"
     │    checks routing_rules → requires_approval: true
     │
     ▼
HITLAdapter.submit_request(tool_name, tool_input, ctx, risk_level)
     │    creates approval record in SQLite (approval_store)
     │    stores: approval_id, tool_name, tool_input, thread_id,
     │            member_id, case_id, assessment_id, requested_at, expires_at
     │    writes episodic memory: "HITL requested for write_case_note"
     │
     ▼
Executor returns APPROVAL_REQUIRED to responder
     │
     ▼
Responder (call 1): formats immediate response
     │    "This action requires supervisor approval before it can be executed.
     │     You can continue working while it's reviewed."
     ▼
Response returned to UI — user sees pending message immediately

── async gap — approver acts independently ──────────────────────────

UI polls  GET /hitl/pending
Approver sees request in Admin UI (tool name, arguments, member context)
     │
     ▼
POST /hitl/decide
{
  "approval_id": "appr-abc123",
  "decision": "approved",          // or "rejected"
  "decided_by": "supervisor-001",
  "reason": "Clinically appropriate"
}
     │
     ├── APPROVED ────────────────────────────────────────────────────
     │        │
     │        ▼
     │   Tool Gateway executes the tool (write_case_note)
     │        │
     │        ▼
     │   approval_store updated: status="approved", decided_at, decided_by
     │   episodic memory written: "HITL APPROVED for write_case_note by supervisor-001"
     │        │
     │        ▼
     │   Response: { ok: true, tool_result: { written: true, note_id: "note-xyz" } }
     │
     └── REJECTED ────────────────────────────────────────────────────
              │
              ▼
         approval_store updated: status="rejected"
         episodic memory written: "HITL REJECTED for write_case_note. Reason: ..."
              │
              ▼
         Response: { ok: true, decision: "rejected" }
```

---

## What Gets Stored in the Approval Record

Every approval request is a row in SQLite (`/app/state/hitl/approvals.db`):

| Field | What it contains |
|---|---|
| `approval_id` | Unique ID e.g. `appr-abc123` |
| `tool_name` | Which tool was requested |
| `tool_input` | Exact arguments the agent passed — what the approver reviews |
| `risk_level` | high / medium / low |
| `status` | pending → approved or rejected |
| `thread_id` | Which conversation this came from |
| `member_id`, `case_id`, `assessment_id` | Clinical context for the approver |
| `requested_by` | Which user/agent triggered it |
| `decided_by` | Who approved or rejected |
| `decision_reason` | Free text reason from the approver |
| `requested_at` | Timestamp |
| `decided_at` | Timestamp |
| `expires_at` | SLA deadline (`requested_at + timeout_minutes`) |

An audit log table records every event (requested → approved/rejected → tool_executed) with actor and timestamp.

---

## HITL and Memory

HITL events are written to episodic memory at two points:

**On request** — when the executor stores an approval, it immediately writes an episodic event: `"HITL approval requested for tool 'write_case_note' (risk: high). Approval ID: appr-abc123"`. This means if the user asks in a subsequent turn "did we submit the case note?" the planner can see from memory that an approval is pending.

**On decision** — when `POST /hitl/decide` is called, the outcome is written to episodic memory: approved with tool result, or rejected with reason. Future turns in the same case/member context can reference this history.

---

## The Adapter Pattern — Swapping the Approval Backend

Today approvals are stored internally in SQLite and reviewed through the Agent Admin UI. In production you would likely route approval requests to an external workflow system — Pega, ServiceNow, Jira, or a custom approvals platform.

The HITL adapter pattern makes this a config + code swap with no changes to the agent runtime, the planner, or anything else.

**The base adapter interface** — `src/platform/hitl/adapters/base.py`

This is the contract every adapter must implement. It never changes — it is platform code. You never modify this file. Instead you create a new adapter file that implements this interface.

```python
# File: src/platform/hitl/adapters/base.py  ← platform code, never modify
class HITLAdapter(ABC):
    def submit_request(
        self,
        tool_name: str,
        tool_input: Dict[str, Any],
        ctx: Dict[str, Any],
        risk_level: str = "high",
    ) -> str:
        """Store approval request. Returns approval_id."""
        ...

    def get_status(self, approval_id: str) -> Dict[str, Any]:
        """Return current approval record."""
        ...
```

**Today — InternalAdapter (SQLite)** — defined in `src/platform/hitl/adapters/internal.py`:

```python
# File: src/platform/hitl/adapters/internal.py  ← active today
class InternalAdapter(HITLAdapter):
    def submit_request(self, tool_name, tool_input, ctx, risk_level) -> str:
        return approval_store.create_approval(...)   # writes to SQLite

    def get_status(self, approval_id) -> dict:
        return approval_store.get_approval(approval_id)
```

**To plug in Pega — create a new file** `src/platform/hitl/adapters/pega.py`:

```python
# File: src/platform/hitl/adapters/pega.py  ← NEW FILE — create this
class PegaAdapter(HITLAdapter):
    def submit_request(self, tool_name, tool_input, ctx, risk_level) -> str:
        response = requests.post(
            "https://pega.example.com/api/v1/cases",
            json={
                "caseTypeID": "APPROVAL",
                "content": {
                    "tool": tool_name,
                    "input": tool_input,
                    "risk": risk_level,
                    "member_id": ctx.get("member_id"),
                }
            },
            headers={"Authorization": f"Bearer {PEGA_TOKEN}"}
        )
        return response.json()["ID"]   # Pega case ID becomes the approval_id

    def get_status(self, approval_id) -> dict:
        response = requests.get(f"https://pega.example.com/api/v1/cases/{approval_id}")
        return response.json()
```

**Then update two things:**

```python
# File: overlays/chat_agent/agents/executor.py  ← change this one line
from src.platform.hitl.adapters.pega import PegaAdapter   # was internal
_hitl_adapter = PegaAdapter()
```

```yaml
# File: overlays/chat_agent/config/agent.yaml  ← update for documentation clarity
hitl:
  adapter: pega    # documents the intent — not yet wired as auto-selector
```

That is all that changes. `base.py`, `approval_store.py`, `app.py`, the planner, the responder, memory writes — nothing else is touched.

### Adapter options

| Adapter | Status | What it does |
|---|---|---|
| `InternalAdapter` | Today | SQLite + Admin UI review |
| `PegaAdapter` | Swap in | Pega BPM workflow case |
| `ServiceNowAdapter` | Swap in | ServiceNow approval task |
| `JiraAdapter` | Swap in | Jira issue for review |
| Custom webhook | Swap in | POST to any external endpoint |

---

## Approval UI & Notification Patterns

When an external system like Pega handles approvals, there are several design options for how the agent app participates — or doesn't. Each has different implications for the nurse's workflow, the agent's memory, and what gets built.

---

### Pattern 1 — Internal (Today)

Agent app owns everything: approval queue, review UI, decision, tool execution.

```
Nurse submits message
     │
     ▼
Agent stores approval in SQLite
     │
     ▼
Admin UI polls GET /hitl/pending on agent runtime  ← UI polls, agent is passive
     │
     ▼
Supervisor approves/rejects in Agent Admin UI
     │
     ▼
Agent executes tool → writes memory → notifies nurse in chat
```

Note: the agent runtime itself never polls anything in this pattern. It is always passive — it responds to requests from the UI. The UI is what periodically refreshes the pending queue.

| | |
|---|---|
| Pros | Everything in one place. Simple. Works today. No external dependencies. |
| Cons | Not production-grade. SQLite doesn't scale. Approval queue is buried in the agent app, not where supervisors typically work. |

---

### Pattern 2 — External System Owns Approval, Agent Polls

Agent submits to Pega/ServiceNow. Agent polls the external system periodically to check if a decision was made.

```
Agent submits approval → Pega
     │
     ▼
Agent polls GET pega/cases/{id} every N seconds
     │
     ▼
Decision found → agent executes tool → writes memory → notifies nurse
```

| | |
|---|---|
| Pros | Approver works in their native system. Agent stays informed. |
| Cons | Polling is inefficient. Latency between decision and agent response. Adds complexity — agent needs a background polling loop. Not built today. |

---

### Pattern 3 — External System Webhooks the Agent (Push)

Pega/ServiceNow calls `POST /hitl/decide` on the agent runtime when the decision is made. Agent finds out immediately, executes the tool, writes memory.

```
Agent submits approval → Pega
     │
     ▼
Approver reviews and decides in Pega
     │
     ▼
Pega webhooks POST /hitl/decide on agent runtime
     │
     ▼
Agent executes tool → writes memory → (optionally notifies nurse)
```

| | |
|---|---|
| Pros | No polling. Immediate response. `/hitl/decide` endpoint already exists — Pega just calls it. Cleanest integration. |
| Cons | Requires Pega to be configured to call the agent webhook. Agent runtime must be reachable from Pega (network/auth). |

---

### Pattern 4 — External System Owns Approval AND Execution, Agent Only Records Memory

The nurse works entirely in Pega (or Pega is part of the same workspace). Pega owns the approval UI, the decision, and the actual write to the system of record (Epic/PostgreSQL). The agent app never needs to notify the nurse — she sees the outcome in Pega directly.

The only thing the agent needs is a memory record of what happened, so future turns know the action was completed.

```
Agent submits approval → Pega
     │
     ▼
Nurse/supervisor approves in Pega (same workspace, no agent UI needed)
     │
     ▼
Pega executes write → Epic / system of record
     │
     ▼
Pega calls POST /hitl/memory on agent runtime (lightweight — just memory bookkeeping)
     │
     ▼
Agent writes episodic memory: "write_case_note approved + executed"
No tool execution by agent. No UI notification. Just memory.
```

| | |
|---|---|
| Pros | Agent is fully decoupled from execution. System of record is always written by the authoritative system (Epic, Pega), never by the agent directly. Clean separation of concerns. No approval queue needed in agent app. |
| Cons | Requires Pega to call a memory endpoint. If Pega doesn't call back, the agent has no record — future turns won't know the action completed. Requires `/hitl/memory` endpoint to be built (not today). |

---

### Pattern comparison

| | Who reviews | Who polls / pushes | Who executes | Agent notifies nurse |
|---|---|---|---|---|
| Pattern 1 (today) | Agent Admin UI | UI polls agent runtime | Agent runtime | Yes — in chat |
| Pattern 2 (polling) | External system | Agent runtime polls external | Agent runtime | Yes — in chat |
| Pattern 3 (webhook) | External system | External system pushes to agent | Agent runtime | Yes — in chat |
| Pattern 4 (fully external) | External system | External system pushes memory only | External system | No — nurse sees in Pega |

**The current architecture supports Patterns 1–3 today** (with adapter swap for 2 and 3). Pattern 4 requires a lightweight `POST /hitl/memory` endpoint to be added. The adapter pattern and `/hitl/decide` endpoint are already in place for all patterns.

---

## API Endpoints

All HITL endpoints live on the Agent Runtime (`localhost:8081`):

| Endpoint | What it does |
|---|---|
| `GET /hitl/pending` | List all pending approvals (optionally filtered by tenant_id) |
| `GET /hitl/status/{approval_id}` | Get a single approval record |
| `POST /hitl/decide` | Submit approved or rejected decision |
| `GET /hitl/history` | Full approval history (last 50 by default) |

The Admin UI polls `GET /hitl/pending` to display the approvals queue. The approver submits via `POST /hitl/decide`.

---

## Current Limitations & Roadmap

**Risk is tool-level only**
The executor does a simple dict lookup: `risk_levels[tool_name]`. Same tool always gets the same risk level, regardless of what the arguments contain or who the member is. See the full roadmap below.

**Content-aware routing requires LLM classification**
Keyword matching alone is not sufficient for clinical content — the same word ("medication") carries completely different risk depending on context. The right approach is a lightweight LLM classification call on the tool arguments before the risk decision: "Does this action represent a clinical change requiring review?" Combined with structured field rules (diagnosis code, dosage delta) and member context (risk score, comorbidities). This is a one-time code investment — once the classifier is built, all routing rules live in config with no further code changes per rule.

**No automatic expiry handling**
`expires_at` is stored but nothing acts on it today. Expired approvals stay in `pending` status indefinitely. A background job to auto-reject expired requests is on the roadmap.

**Sequential approvals only**
Today one tool call = one approval request, resolved before the next can proceed. Parallel approvals (fan-out) are not supported.

### Roadmap summary

| Gap | What's needed |
|---|---|
| Content-aware routing | LLM classifier on tool arguments in executor |
| Dynamic risk scoring | Runtime scoring function: tool + member context + user role |
| Auto-expiry | Background job to reject approvals past `expires_at` |
| Parallel approvals | LangGraph fan-out, multiple pending requests per turn |
| Approval routing by role | Route high-risk tools to medical director, others to care manager |
| External system execution | After approval, Pega/Epic executes — agent only proposes, never writes directly |
| Config-driven adapter selection | `hitl.adapter: pega` in agent.yaml auto-selects adapter without code change |

---

## These Capabilities Are Platform-Owned — Not Replaced by AgentCore

AgentCore handles orchestration and infrastructure. It does not provide:

- Tool-level and content-aware risk classification
- Approval workflow routing (which human, which system, which pattern)
- An approval store and decision lifecycle
- Dynamic risk scoring based on tool arguments, member context, and user role
- The four approval UI patterns and their tradeoffs

These are your platform's HITL capabilities — built once in `src/platform/hitl/`, configured per agent, owned by you. When running on AgentCore, the adapter may point at a managed workflow service (Pega, ServiceNow) rather than the internal SQLite store — but the risk classification logic, routing rules, and approval lifecycle all still need to exist and be built in your platform.

The `HITLAdapter` interface ensures the swap is clean — the executor calls the same interface regardless of what backend handles the approval. Swapping the engine does not change what judgment the human is being asked to validate or how risk decisions are made.

> **All HITL capabilities — risk scoring, content-aware routing, parallel approvals, external execution — must be built regardless of whether AgentCore is eventually adopted.**
