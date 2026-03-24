# HITL Design Spec — Internal Adapter
## Agent Platform — Care Management

---

## 1. Overview

HITL (Human-in-the-Loop) allows the agent to pause execution and request human approval before executing a high-risk tool (e.g. writing a case note, updating a care plan).

**Key principles:**
- Async — nurse is never blocked, can continue chatting while approval is pending
- Decoupled — agent fires an event and moves on, HITL service handles the rest
- Pluggable — internal adapter today, Pega/ServiceNow adapter in future with zero agent code change
- Memory-integrated — every approval decision (approved/rejected + reason) written to episodic memory
- Audit trail — every event logged to database

---

## 2. Scope (Phase 1 — Internal Adapter)

- Internal approval queue stored in PostgreSQL
- Supervisor reviews and acts in Approval Console UI
- Nurse notified in chat panel via polling
- No external workflow engine (Pega, ServiceNow) in this phase
- Pega adapter is a future plug-in, no code changes needed in agent when added

---

## 3. Flow

### Step 1 — Agent triggers HITL
- Planner selects a tool that has `approval_required: true` in `agent.yaml`
- Agent creates an `ApprovalRequest` record in PostgreSQL with status `pending`
- Agent returns immediately to nurse: *"This action requires approval. You can continue working."*
- Nurse is NOT blocked — can send new messages in the same chat

### Step 2 — Supervisor reviews
- Approval Console UI polls `GET /hitl/pending`
- Supervisor sees queue of pending approvals with full context:
  - Which nurse requested it
  - Which tool and what input (e.g. full note text)
  - Member and assessment context
  - Risk level
  - How long it has been waiting
- Supervisor clicks Approve or Reject, must enter a reason

### Step 3 — Decision callback
- UI posts `POST /hitl/decide` with `{approval_id, decision, reason, decided_by}`
- Agent runtime receives decision
- If **approved**: tool executes, result returned
- If **rejected**: reason stored, nurse notified

### Step 4 — Memory write
- Decision written to episodic memory at assessment + case scope
- Includes: tool name, decision, decided_by, reason, timestamp
- Future planner calls see this in context

### Step 5 — Nurse notification
- Chat panel polls `GET /hitl/status/{approval_id}` every 5 seconds
- When decision arrives, chat shows:
  - **Approved**: tool result shown inline — *"Case note written ✓ (approved by supervisor-001)"*
  - **Rejected**: reason shown — *"Rejected: Note content incomplete — please add medication details"*

---

## 4. Data Model

### approvals table
```
approval_id       TEXT PRIMARY KEY
tenant_id         TEXT
thread_id         TEXT
assessment_id     TEXT
case_id           TEXT
member_id         TEXT
requested_by      TEXT        -- nurse user_id
tool_name         TEXT
tool_input        JSONB       -- full tool arguments
risk_level        TEXT        -- high | medium | low
status            TEXT        -- pending | approved | rejected | expired
adapter           TEXT        -- internal (pega in future)
decided_by        TEXT
decision_reason   TEXT
requested_at      TIMESTAMPTZ
decided_at        TIMESTAMPTZ
expires_at        TIMESTAMPTZ
```

### approval_audit_log table
```
log_id            SERIAL PRIMARY KEY
approval_id       TEXT
event_type        TEXT   -- requested | approved | rejected | expired | tool_executed | memory_written
actor             TEXT   -- user_id or "system"
detail            JSONB
created_at        TIMESTAMPTZ
```

---

## 5. API Endpoints

### Agent Runtime

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/hitl/pending` | List all pending approvals (Approval Console) |
| GET | `/hitl/status/{approval_id}` | Nurse polls for decision |
| POST | `/hitl/decide` | Supervisor submits decision |
| GET | `/hitl/history` | Full audit log |

### POST /hitl/decide payload
```json
{
  "approval_id": "appr-uuid",
  "decision": "approved | rejected",
  "reason": "Note content is complete and accurate",
  "decided_by": "supervisor-001"
}
```

---

## 6. agent.yaml Config

```yaml
hitl:
  enabled: true
  adapter: internal
  routing_rules:
    - risk_level: high
      requires_approval: true
    - risk_level: medium
      requires_approval: true
    - risk_level: low
      requires_approval: false
  sla:
    timeout_minutes: 60

tools:
  allowed:
    - write_case_note
  risk_levels:
    write_case_note: high
    get_assessment_summary: low
    get_assessment_tasks: low
    search_kb: low
```

---

## 7. Memory Integration

### Written on approval requested:
```json
{
  "type": "hitl_requested",
  "tool": "write_case_note",
  "risk_level": "high",
  "requested_by": "nurse-001",
  "timestamp": "2026-03-24T10:00:00Z"
}
```

### Written on approved:
```json
{
  "type": "hitl_approved",
  "tool": "write_case_note",
  "tool_result": "note-12345 written successfully",
  "decided_by": "supervisor-001",
  "reason": "Note is complete and accurate",
  "timestamp": "2026-03-24T10:15:00Z"
}
```

### Written on rejected:
```json
{
  "type": "hitl_rejected",
  "tool": "write_case_note",
  "decided_by": "supervisor-001",
  "reason": "Note content incomplete — add medication details",
  "timestamp": "2026-03-24T10:12:00Z"
}
```

Scope: written to **episodic memory** at both `assessment` and `case` scope.

Effect on future planner calls:
- Planner sees prior rejection → suggests nurse elaborate before retrying same tool
- Pattern of rejections visible in Approval Console audit log

---

## 8. Nurse UX

| State | What nurse sees |
|-------|----------------|
| Approval triggered | *"Write case note submitted for approval. You can continue working."* Amber badge in chat header |
| Waiting | Can send new messages, amber badge remains visible |
| Approved | *"Case note written ✓ — approved by supervisor-001"* Badge removed |
| Rejected | *"Rejected by supervisor-001: Note content incomplete — add medication details"* Badge removed |

---

## 9. Approval Console UI

| Section | Content |
|---------|---------|
| Pending queue | All pending approvals — nurse, tool, assessment, time waiting |
| Detail view | Full context — member name, assessment summary, exact tool input |
| Action | Approve / Reject buttons, reason field (required) |
| History | All decided approvals — actor, timestamp, reason |
| Filters | By nurse, by tool, by risk level, by date range |

---

## 10. What Needs to Be Built

### Tool Gateway — PostgreSQL
- [ ] `approvals` table
- [ ] `approval_audit_log` table

### Agent Runtime Template
- [ ] `src/platform/hitl/approval_store.py` — read/write approvals in PostgreSQL
- [ ] `src/platform/hitl/approval_router.py` — reads routing rules from agent config
- [ ] `src/platform/hitl/adapters/base.py` — abstract adapter interface
- [ ] `src/platform/hitl/adapters/internal.py` — internal queue adapter
- [ ] `src/platform/hitl/memory_writer.py` — writes decision to episodic memory
- [ ] New endpoints in `app.py`: `/hitl/pending`, `/hitl/status/{id}`, `/hitl/decide`, `/hitl/history`
- [ ] Update `langgraph_runner.py` — decouple HITL from inline approval flow

### UI Template
- [ ] Approval Console page — real backend integration
- [ ] Chat panel — async pending banner, poll `/hitl/status/{id}` every 5s
- [ ] Notification on decision — inline result or rejection reason

### agent.yaml (per overlay)
- [ ] `hitl.adapter` field
- [ ] `hitl.routing_rules` per risk level
- [ ] `hitl.sla.timeout_minutes`
- [ ] `tools.risk_levels` per tool

---

## 11. Future — Pega Adapter

When a customer uses Pega, the only change is:

1. Add `hitl/adapters/pega.py` implementing the same `HITLAdapter` interface
2. Set `hitl.adapter: pega` in `agent.yaml`
3. Add Pega API credentials to `.env`

Zero changes to agent runtime, memory, or UI.
