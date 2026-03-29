# Documentation Agenda

Status key: ✅ Done | 🔄 In Progress | ⬜ Not Started

---

## Part 1 — Platform Structure

| # | Section | Status |
|---|---|---|
| 01 | Repo & File Structure | ✅ |
| 02 | Agent Types | ✅ |
| 03 | New Usecase Checklist — chat_agent | ✅ |
| 04 | Architecture Walkthrough | ✅ |

---

## Part 2 — Infrastructure & Deployment

| # | Section | Status |
|---|---|---|
| 05 | Deployment & Runtime Infrastructure — containers, ports, Docker Compose, what's shared vs isolated per usecase | ✅ |

---

## Part 3 — Core Platform Features

| # | Section | Status |
|---|---|---|
| 06 | Tool Design & Tool Gateway — how tools are built, registered, routed, adapter pattern, Lambda vs REST vs local | ✅ |
| 07 | HITL — approval store, routing rules, admin UI, async flow, current limitation (tool-level only), roadmap (content-aware routing, dynamic risk, external execution) | ✅ |
| 08 | RAG / Retrieval — pre-graph vs planner tool, embedding, strategy, top_k tuning, vector DB, multi-KB routing roadmap | ✅ |
| 09 | Memory — four types (short-term / episodic / semantic / summary), scopes, write policies, hierarchy, toggle behavior, read/write split roadmap | ✅ |
| 10 | Prompt Management — system prompts, versioning, prompt-defaults.yaml, planner vs responder prompts, Prompt Management UI roadmap | ✅ |

---

## Part 4 — Admin & Observability

| # | Section | Status |
|---|---|---|
| 11 | Agent Admin UI — Agent Registry, what each tab controls, locked_features, Workspaces, Prompt Governance | ⬜ |
| 12 | Tool Gateway UI — what it should show, current state (code only), roadmap for UI | ⬜ |
| 13 | Observability — tracing, run_id, memory debug panel, trace graph, LLM Ops roadmap | ⬜ |

---

## Part 5 — Advanced Patterns

| # | Section | Status |
|---|---|---|
| 14 | Multi-Agent — supervisor pattern, how agents hand off, backlog | ⬜ |
| 15 | AgentCore / Gateway Pattern — enterprise AgentCore vs Tool Gateway, pros/cons, when to use which | ⬜ |
| 16 | Lambda as a Tool — how to plug in Lambda without code changes, adapter pattern | ⬜ |
| 17 | Security & Tenancy — tenant isolation, auth, tool access control | ⬜ |

---

## Part 6 — Operations & Evolution

| # | Section | Status |
|---|---|---|
| 18 | New Agent Type Checklists — summary_agent, workflow_agent, supervisor_agent | ⬜ |
| 19 | Evaluation & Testing — prompt eval, regression testing, memory correctness | ⬜ |
| 20 | Platform Evolution Story — how each dimension evolved from hardcoded → configurable → production-grade, design decisions and why | ⬜ |
