# Full Test Checklist — Agent Registry + Runtime

### 0. Pre-flight
- [ ] Support API running (`cd services/agent-factory-support-api && uvicorn app:app`)
- [ ] Agent Factory UI running (`cd services/agent-factory-ui && npm run dev`)
- [ ] Care management UI running (`cd capabilities/care-management/ui/services/ui && npm run dev`)
- [ ] Tool gateway running (docker)
- [ ] Go to **Workspaces** → confirm `pre-call-assessment` shows as stopped, stale `test` record visible

---

### 1. Workspaces
- [ ] All registered agents appear (chat_agent + summary_agent for pre-call-assessment)
- [ ] Delete the stale `test` entry — confirm it disappears, no error
- [ ] Start `pre-call-assessment` → status chip turns green
- [ ] Try Delete while running → button is disabled
- [ ] Stop it → status turns grey
- [ ] Delete disabled message gone, Delete button active
- [ ] Start again for testing below

---

### 2. Agent Registry — Overview Tab
- [ ] Open `pre-call-assessment / chat_agent`
- [ ] Identity cards show correct capability, usecase, agent_type, repo name
- [ ] Reasoning strategy shows `simple`, features chips correct (memory ✅ rag ✅ hitl ✅)
- [ ] Live Flow Diagram renders — Pre-Graph / In-Graph / Post-Graph bands visible
- [ ] Hover a flow node → help panel updates on the right
- [ ] Hover reasoning strategy `i` → help panel shows reasoning content
- [ ] All 5 YAML files expand: `agent.yaml`, `memory.yaml`, `prompts.yaml`, `domain.yaml`, `overlay.yaml`
- [ ] Hover a YAML file header → help panel changes to that file's content
- [ ] YAML content matches what's on disk (spot-check one field)

---

### 3. Agent Registry — Memory Tab
- [ ] All 4 types shown: Short-Term, Episodic, Semantic, Summary
- [ ] Summary write shows 🔒 Locked (write_locked: true for chat_agent)
- [ ] Semantic write shows OFF (enabled: false in memory.yaml)
- [ ] Change `retain_last_n_turns` from 12 → 3 → Save
- [ ] Go to Overview → memory.yaml expands → confirm value changed to 3
- [ ] `write_intermediate_steps` toggle disabled (greyed) because strategy is `simple`
- [ ] Toggle Episodic write OFF → Save
- [ ] Restart agent from Workspaces
- [ ] Chat: ask something that calls a tool (e.g. "get member summary") → open Memory tab in chat panel → `episodic` should show as skipped
- [ ] Toggle Episodic back ON → Save → Restart → repeat → episodic shows as written
- [ ] Reset `retain_last_n_turns` back to 12 → Save

---

### 4. Agent Registry — Tools Tab
- [ ] Allowed tools list shows current tools from agent.yaml
- [ ] Add a new tool (e.g. `get_member`) if not present → Save
- [ ] Remove a tool → Save → Restart → agent can no longer call that tool
- [ ] `tools.mode` switch (selected vs auto) changes tool availability

---

### 5. Agent Registry — RAG Tab
- [ ] `planner_tool` enabled, `pre_graph` disabled — matches agent.yaml
- [ ] Change `planner_tool.top_k` from 5 → 2 → Save → Restart
- [ ] Ask a clinical question in chat → Memory tab trace should show fewer KB chunks returned
- [ ] Toggle `planner_tool` OFF → Save → Restart → ask same question → agent should answer without KB context (or say it doesn't know)
- [ ] Toggle back ON → Save

---

### 6. Agent Registry — HITL Tab
- [ ] Master HITL switch OFF → all controls disabled
- [ ] Toggle ON → Action Risk trigger row becomes active
- [ ] `write_case_note` risk level = high, routing rule high → requires_approval: true
- [ ] Save → Restart → ask agent to "write a case note" → chat shows ⏳ Awaiting Approval
- [ ] Go to Supervisor view in care management UI → approve → chat updates ✓ Approved
- [ ] Memory tab in chat → episodic shows written with `tool_success_post_hitl` trigger
- [ ] Change `write_case_note` risk to `low` → Save → Restart → same request goes through without approval
- [ ] Reset to `high`

---

### 7. Agent Registry — Routing Tab
- [ ] Add a hard route: phrase "get member summary", scope `member`, tool `get_member_summary` → Save
- [ ] Restart agent
- [ ] Chat: type exactly "get member summary" → Memory tab shows `route_type: HARD_ROUTE`, tool matches
- [ ] Chat: type something different → shows `route_type: LLM_ROUTE`
- [ ] Back in Routing tab: try adding a route with mismatched scope/tool → orange validation warning appears
- [ ] Remove the hard route → Save → Restart → same phrase now goes through LLM planner

---

### 8. Runtime Chat Panel — All 3 Tabs
- [ ] Open chat at **member level** (MemberProfile) → send a message → reply received
- [ ] Open chat at **case level** → send message → thread is separate from member-level thread
- [ ] Open chat at **assessment level** → send message → correct assessment_id passed (check Memory tab scope)
- [ ] **Memory tab**: after first message data appears (not "No memory data yet")
- [ ] Planner section shows route_type, tool name
- [ ] Written section shows short_term: written
- [ ] **Memory toggles**: flip `short_term: OFF` → send message → Written shows short_term: skipped
- [ ] Flip back ON → next message → short_term: written again
- [ ] **Trace tab**: shows execution steps after a tool call
- [ ] Clear button resets thread and messages

---

### 9. Create New Agent (End-to-End Scaffold)
- [ ] Go to Create Agent → fill in capability `care-management`, usecase `test-2`, agent type `chat_agent`
- [ ] Submit → success
- [ ] Go to Agent Registry → `test-2 / chat_agent` appears
- [ ] Overview tab loads, YAML files visible
- [ ] Go to Workspaces → new agent appears as stopped
- [ ] Start it → running
- [ ] Open care management UI → chat at member level → message goes through
- [ ] Delete from Workspaces → agent disappears from registry and Workspaces

---

### 10. Summary Agent (Smoke Test)
- [ ] Agent Registry → `pre-call-assessment / summary_agent`
- [ ] Overview: agent_type shows `summary_agent`, flow diagram shows summarizer pattern
- [ ] Memory tab: Summary write is NOT locked (summary_agent writes summary)
- [ ] Short-term write is locked (summary_agent doesn't write short-term)

---

## Memory — Read/Write Timing (chat_agent)

### When memory is read vs written

All memory **reads** are **pre-graph** — `context_builder.py` assembles every enabled memory type into `ctx` before the LangGraph graph starts executing. The graph never reaches back out to memory mid-turn; it only sees what was packed into `ctx` at the start.

| Type | Read stage | Write stage | Write trigger |
|---|---|---|---|
| **Short-Term** | pre-graph | post-graph | after turn completes — conversation pair (user + assistant) written |
| **Episodic** | pre-graph | **in-graph** | `write_on_tool_call` fires inside executor node immediately after a tool result comes back |
| **Semantic** | pre-graph | post-graph | LLM call (post-graph) extracts facts from the turn, then fact written to store |
| **Summary** | pre-graph | post-graph | summary_agent writes a compressed summary; triggered by explicit call, turn count, or token threshold |

For the `chat_agent` in pre-call-assessment:
- **Short-Term**: R/W
- **Episodic**: R/W
- **Semantic**: R only (write disabled — semantic is read at start of turn for context, but new facts are not extracted)
- **Summary**: R / W🔒 (write_locked — chat_agent cannot write summaries; only summary_agent can)

### Episodic vs Semantic — what's the difference

| | Episodic | Semantic |
|---|---|---|
| **What is stored** | Events — *what happened* (tool called, result returned, HITL outcome) | Facts — *what is true* (member prefers Spanish, diagnosis: CHF) |
| **Written by** | Executor node, directly, after each tool call | LLM post-graph — LLM reads the turn and extracts persistent facts |
| **Triggered by** | Tool execution | Every turn (if write enabled) — LLM decides what facts to extract |
| **Example entry** | `tool: get_member_summary executed, result: [200 tokens of member data]` | `fact_type: member_language, value: Spanish, scope: member/m-001` |

### What is sent to the LLM for semantic fact extraction (post-graph)

After the graph finishes, the semantic engine sends the LLM:
1. **The user message** for the current turn
2. **The assistant response** (the final answer from the graph)
3. **The tool call + result** (if a tool was called — what tool, what input, what output)
4. **The existing semantic facts** for this scope (so the LLM can decide whether to update an existing fact or create a new one)
5. **A system prompt** instructing it to extract only persistent, reusable facts — not conversation-level observations

The LLM returns a list of `{ fact_type, value }` pairs. Each is written to the semantic store under the active scope (member_id, case_id, etc.). Deduplication merges facts with the same `fact_type` rather than creating duplicates.

---

## What Runs Where

### Containers (Docker)
| What | Where defined | Shared or per-agent |
|---|---|---|
| **Tool Gateway** (FastAPI — tools API) | `services/tool-policy-gateway/docker-compose.yml` | **Shared** — one instance, all agents use it |
| **Postgres** (memory store + KB) | same shared docker-compose | **Shared** — one DB, all agents share it |
| **Agent Runtime** (LangGraph FastAPI) | `agents/care-management/pre-call-assessment/docker-compose.yml` | **Per-agent** — one container per running agent |

### NOT containers (run natively on host)
| What | How it runs |
|---|---|
| **Support API** | `uvicorn app:app` — plain Python process |
| **Agent Factory UI** | `npm run dev` — Vite dev server |
| **Care management UI** | `npm run dev` — Vite dev server |
| **App repo UI** (standalone test UI) | `npm run dev` — Vite dev server (only if app_repo was scaffolded) |

---

## What's Inside the Agent Runtime Container

The container is built from **3 layers**:

| Layer | What it is | Shared or per-agent |
|---|---|---|
| **platform-core** (pip installed) | Shared Python library — the engine every agent uses | **Shared** — same code in every agent container |
| **Agent runtime** (`src/platform/`) | Thin per-agent wiring — app.py, langgraph_runner.py | **Per-agent** |
| **Overlays** (`overlays/<agent_type>/`) | Agent-specific logic — planner, executor, graph, strategies | **Per-agent** |

### platform-core consists of:

| Module | What it does |
|---|---|
| `memory/` | Memory read/write engine, scope resolver, context builder, file + DB backends, semantic engine, summary engine |
| `rag/` | RAG patterns — naive, self_corrective, multi_hop, hyde, agentic |
| `hitl/` | HITL adapters (internal), approval store, memory writer post-approval |
| `llm/` | Responder (LLM call wrapper) |
| `tools/` | Tool bindings, bootstrap, router, discovery, validation, registry |
| `prompt/` | Prompt client (fetches from prompt service or falls back to defaults) |
| `observability/` | Tracer, logging, tracing |
| `auth.py` / `authorization.py` | Auth handling |
| `context.py` | Request context model |
| `config.py` | Config loading helpers |
| `manifest_loader.py` | Reads `overlay.yaml` |
| `usecase_config_loader.py` | Reads `agent.yaml`, `memory.yaml` |
| `tool_gateway_client.py` | HTTP client to call Tool Gateway |
| `schema/` | Shared Pydantic schemas |

**Key point:** when you delete an agent, platform-core code is NOT deleted — it lives at `platform-core/` at the repo root and is only copied into the container at build time. Next agent you scaffold gets the same platform-core.

---

## When You Delete an Agent from Workspaces

| What happens | Detail |
|---|---|
| **Agent runtime container stopped** | `docker compose down` on the agent repo |
| **App repo container stopped** | `docker compose down` on app_repo (if it had one) |
| **Agent repo folder deleted** | `agents/care-management/pre-call-assessment/` — gone from disk |
| **App repo folder deleted** | e.g. `agents/care-management/test-app/` — gone from disk |
| **Registry records removed** | All entries in `usecase_registry.json` for that agent_repo |
| **Workspace state cleared** | `workspace_state.json` reset to `{}` |

**NOT deleted:**
| What | Why |
|---|---|
| Shared infra (tool gateway + postgres) | Shared — other agents depend on it |
| Memory data in Postgres | Data stays in DB even after agent is gone |
| Templates | Source blueprints, never touched |
| Support API, Factory UI | Platform tools, not per-agent |
| KB documents in Postgres | Shared knowledge base, not per-agent |
| platform-core | Shared library at repo root, not per-agent |
