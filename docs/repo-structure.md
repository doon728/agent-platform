# Repository Structure

## Top-Level Layout

```
agent-platform/
├── templates/                        ← SOURCE OF TRUTH — always edit here first
│   ├── agent-runtime-template/       ← template for any agent runtime service
│   └── capability-ui-template/       ← template for any capability UI
│
├── generated-repos/                  ← scaffolded from templates — DO NOT edit directly
│   └── care-management/
│       ├── cm-hero-fl-app/           ← generated UI repo
│       └── usecases/
│           └── UC_PreCall_Assess/
│               └── cm-chat-buddy-assess/   ← generated agent runtime repo
│
├── shared-infra/                     ← shared across usecases, not per-agent
│   └── industry-tool-gateway-healthcare/
│       └── services/tool-gateway/    ← healthcare tool gateway service
│
├── platform/                         ← core platform CLI tools
├── platform-services/                ← platform microservices
├── platform-store/                   ← data store implementations
├── platform-tools/                   ← scaffolding CLI tools
└── docs/                             ← documentation (this folder)
```

---

## Agent Runtime Template

```
templates/agent-runtime-template/
│
├── common/                           ← shared across ALL agent types
│   ├── docker-compose.yml
│   └── services/agent-runtime/
│       ├── Dockerfile                ← builds the agent runtime container
│       ├── pyproject.toml            ← Python dependencies (poetry)
│       ├── poetry.lock
│       ├── config/
│       │   ├── base.yaml             ← base config: capability_name, tool_gateway url
│       │   ├── dev.yaml              ← dev overrides
│       │   └── prod.yaml             ← prod overrides
│       └── src/
│           ├── graph/
│           │   └── build_graph.py    ← dispatcher: reads AGENT_TYPE, loads overlay graph
│           └── platform/
│               ├── app.py            ← FastAPI app: /invocations, /health, /traces, /hitl/*
│               ├── usecase_contract.py ← main execute() entry point
│               ├── config.py         ← loads base.yaml + env vars into Config dataclass
│               ├── context.py        ← builds request context dict from HTTP payload
│               ├── auth.py           ← authentication (OPTIONAL mode for dev)
│               ├── authorization.py  ← tenant isolation enforcement
│               ├── manifest_loader.py ← loads agent_manifest.yaml from active overlay
│               ├── langgraph_runner.py ← runs the graph, handles memory before/after, traces
│               ├── usecase_config_loader.py ← loads agent.yaml + memory.yaml from overlay config/
│               ├── tool_gateway_client.py ← HTTP client for tool gateway /tools/invoke
│               ├── llm/
│               │   └── responder.py  ← calls OpenAI to generate final response
│               ├── prompt/
│               │   └── prompt_client.py ← fetches versioned prompts from prompt service
│               ├── memory/
│               │   ├── config_loader.py   ← reads memory config from agent.yaml
│               │   ├── scope_resolver.py  ← resolves which scopes apply to this request
│               │   ├── context_builder.py ← assembles memory into context before LLM call
│               │   ├── memory_store.py    ← file-based memory CRUD + scope index
│               │   ├── file_memory.py     ← low-level JSON file operations
│               │   ├── memory_interface.py ← abstract memory interface
│               │   ├── write_engine.py    ← writes episodic/semantic memories after tool calls
│               │   ├── summary_engine.py  ← compresses old turns into summaries
│               │   └── semantic_engine.py ← semantic memory operations
│               ├── tools/
│               │   ├── discovery.py  ← calls /tools/specs at startup, registers all tools
│               │   ├── registry.py   ← in-memory tool registry + invoke_approved()
│               │   ├── router.py     ← converts "tool_name: arg" string to tool input dict
│               │   ├── bootstrap.py  ← wires tool discovery at app startup
│               │   ├── bindings.py   ← function wrappers for each tool
│               │   └── validation.py ← validates tool inputs before execution
│               └── observability/
│                   ├── tracer.py     ← records planner/executor/responder steps as trace runs
│                   ├── tracing.py    ← trace utilities
│                   └── logging.py    ← structured logging setup
│
└── overlays/                         ← ONE FOLDER PER AGENT TYPE
    └── chat_agent/                   ← chat agent (exists today)
        ├── agent_manifest.yaml       ← declares agent type, components, entrypoint
        ├── config/                   ← agent-specific config
        │   ├── agent.yaml            ← tools allowed, features, risk levels, retrieval
        │   ├── memory.yaml           ← memory scopes, write policies, retrieval policies
        │   └── prompt-defaults.yaml  ← override system prompts (planner, responder)
        ├── agents/
        │   ├── llm_planner.py        ← decides which tool to call (HARD_ROUTE + LLM_ROUTE)
        │   ├── executor.py           ← calls tool gateway, handles HITL approval check
        │   ├── chat_responder.py     ← generates final natural language response
        │   └── planner.py            ← rules-based planner (fallback)
        ├── graph/
        │   └── state.py              ← TypedDict schema for graph state (prompt, ctx, history, answer)
        └── orchestration/
            └── build_graph.py        ← wires nodes + edges: planner → executor → responder
```

---

## Capability UI Template

```
templates/capability-ui-template/
├── docker-compose.yml                ← Node 20 Alpine, port 3000, volume mount for hot reload
├── app-config/
│   └── agents.yaml                   ← agent definitions and routing config
└── services/ui/
    ├── index.html                    ← HTML entry point
    ├── package.json                  ← npm dependencies (React, Vite, React Router)
    ├── vite.config.ts                ← Vite config + proxy: /invocations → agent runtime
    ├── tsconfig.json
    └── src/
        ├── main.tsx                  ← React entry point
        ├── App.tsx                   ← root component, all routes + nav links
        ├── style.css                 ← global dark theme styles
        ├── lib/
        │   └── api.ts                ← postJson() helper, base URL config
        ├── components/
        │   └── TraceGraph.tsx        ← LangGraph execution trace visualization
        └── pages/
            ├── Members.tsx           ← member search page (search-on-type, risk badge, case count)
            ├── MemberProfile.tsx     ← member detail + cases list
            ├── CaseView.tsx          ← case detail + assessments list
            ├── AssessmentView.tsx    ← 3-column: assessment+tasks | chat | memory+trace
            ├── Nurse.tsx             ← nurse dashboard with full memory panel + chat
            └── Supervisor.tsx        ← supervisor oversight view
```

---

## Generated Agent Runtime Repo

```
cm-chat-buddy-assess/                 ← usecase repo (UC_PreCall_Assess)
├── overlays/
│   └── chat_agent/                   ← copied from template + customized config
│       ├── agent_manifest.yaml
│       ├── config/
│       │   ├── agent.yaml            ← UC_PreCall_Assess specific: tools, approval, features
│       │   ├── memory.yaml           ← UC_PreCall_Assess memory config
│       │   └── prompt-defaults.yaml
│       ├── agents/                   ← same as template
│       ├── graph/                    ← same as template
│       └── orchestration/            ← same as template
├── services/
│   └── agent-runtime/                ← copied from template common/
│       ├── Dockerfile
│       ├── pyproject.toml
│       ├── config/
│       │   ├── base.yaml             ← capability_name: care-management, agent_type: chat_agent
│       │   └── dev.yaml
│       └── src/                      ← platform code, identical to template
├── state/
│   └── memory/                       ← runtime memory files (mounted as volume)
│       └── t1/
│           ├── conversation/         ← short-term turn files per thread
│           ├── assessment/           ← episodic memory per assessment
│           ├── case/                 ← episodic memory per case
│           ├── member/               ← semantic memory per member
│           └── _index/               ← scope relationship index for rollup
│               ├── case/             ← case → [assessment_ids]
│               └── member/           ← member → [case_ids]
├── docker-compose.yml                ← agent-runtime service definition
├── .env                              ← OPENAI_API_KEY, TOOL_GATEWAY_URL, ports
├── start-runtime.sh                  ← convenience script to start
└── rebuild-runtime.sh                ← convenience script to rebuild
```

---

## Tool Gateway (Shared Infrastructure)

```
shared-infra/industry-tool-gateway-healthcare/services/tool-gateway/
├── Dockerfile
├── docker-compose.yml                ← tool-gateway + postgres services
├── pyproject.toml
├── src/
│   ├── app.py                        ← FastAPI: /tools/invoke, /tools/specs, /members, /cases, /assessments
│   ├── tools/
│   │   └── registry.py               ← TOOL_REGISTRY dict: all tools with input/output schema + handler
│   ├── data/
│   │   └── pg_store.py               ← PostgreSQL queries: members, assessments, cases, tasks, notes
│   └── rag/
│       ├── ingest.py                 ← ingests policy docs into pgvector
│       └── retriever.py              ← vector similarity search for search_kb tool
├── config/
│   └── dev.yaml                      ← DB connection config
├── data/
│   ├── sql/
│   │   ├── structured_tables.sql     ← DB schema: all tables
│   │   ├── demo_seed.sql             ← demo data: members, assessments, cases, tasks
│   │   └── load_structured_data.sql  ← CSV data loader
│   └── synth/
│       ├── structured/               ← CSV files: members, assessments, cases, claims, auths, providers
│       └── policy_ingest/            ← clinical policy docs for RAG knowledge base
├── bootstrap_structured.py           ← seeds PostgreSQL from CSV files
└── bootstrap_kb.py                   ← ingests policy docs into pgvector
```
