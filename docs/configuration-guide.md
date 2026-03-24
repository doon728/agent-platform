# Configuration Guide

Every aspect of agent behavior is controlled via config files. No code changes needed for a new usecase.

---

## 1. agent.yaml (overlays/{agent_type}/config/agent.yaml)

The most important config file. Controls what the agent does.

```yaml
agent:
  type: chat_agent          # agent type — matches overlay folder name
  planner_mode: llm         # llm | rules

tools:
  mode: selected            # selected = only listed tools | auto = all matching tags
  allowed:
    - search_kb             # search knowledge base
    - get_member            # fetch member record
    - get_member_summary    # full member profile + care plans + claims
    - get_assessment_summary # assessment + responses + case notes
    - get_assessment_tasks  # tasks (pre/during/post call) for assessment
    - write_case_note       # write a note (requires approval)

retrieval:
  enabled: true
  default_tool: search_kb   # fallback tool when planner is uncertain
  fallback:
    allow_no_results_response: true

risk:
  approval_required: true   # enables HITL for high-risk tools

features:
  memory: true              # enable memory system
  rag: true                 # enable knowledge base retrieval
  hitl: true                # enable human-in-the-loop approval
  observability: true       # enable trace recording
  prompt_versioning: false  # use prompt service for versioned prompts
```

---

## 2. memory.yaml (overlays/{agent_type}/config/memory.yaml)

Controls memory behavior — what gets written, what gets read, at which scopes.

```yaml
enabled: true

scope_taxonomy:             # all scopes this agent uses
  - conversation
  - assessment
  - case
  - member

write_policies:
  short_term:
    enabled: true
    trigger: every_turn     # write after every message
    primary_scope: conversation
    retain_last_n_turns: 12

  episodic:
    enabled: true
    triggers:
      - tool_success        # write only after successful tool execution
    allowed_scopes:
      - case
      - assessment

  semantic:
    enabled: false          # stable facts about members (future)

  summary:
    enabled: true
    triggers:
      every_n_turns: 10     # compress old turns into summary after 10 turns
    allowed_scopes:
      - conversation

retrieval_policies:
  conversation:
    short_term:
      include: true
      max_turns: 12         # how many recent turns to include in context
    summary:
      include: true
      max_items: 1

  case:
    episodic:
      include: true
      top_k: 5              # top 5 episodic memories from case scope

context_assembly:
  max_total_items: 12
  prefer_summaries_over_raw: true
  deduplicate: true
```

---

## 3. prompt-defaults.yaml (overlays/{agent_type}/config/prompt-defaults.yaml)

Override the default system prompts for planner and responder.
Leave empty to use built-in defaults.

```yaml
# planner_system_prompt: |
#   You are an AI planning agent for care management...

# responder_system_prompt: |
#   You are a helpful care management assistant...
```

---

## 4. agent_manifest.yaml (overlays/{agent_type}/agent_manifest.yaml)

Declares what the overlay contains and which graph to load.

```yaml
agent_type: chat_agent

components:
  - planner
  - responder
  - executor

features:
  memory: true
  observability: true
  prompt_versioning: true

required_prompts:
  - planner
  - responder

entrypoint:
  orchestration_graph: orchestration/build_graph.py
```

---

## 5. config/base.yaml (services/agent-runtime/config/base.yaml)

Runtime infrastructure config. Not agent-specific.

```yaml
app:
  contract_version: v1
  capability_name: care-management   # which capability this runtime serves

tool_gateway:
  url: http://healthcare-tool-gateway:8080   # tool gateway service URL

prompt_service:
  url: http://host.docker.internal:8101
  agent_type: chat_agent             # which overlay to load
  usecase_name: UC_PreCall_Assess
  environment: dev

features:
  memory: false       # base defaults (overridden by agent.yaml)
  hitl: false
  observability: true
  planner_mode: rules
```

---

## 6. Environment Variables (.env)

```bash
# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini

# Ports
AGENT_RUNTIME_PORT=8081

# Tool Gateway
TOOL_GATEWAY_URL=http://host.docker.internal:8080

# Agent
AGENT_TYPE=chat_agent           # overrides base.yaml prompt_service.agent_type
CAPABILITY_NAME=care-management # overrides base.yaml app.capability_name
USECASE_NAME=UC_PreCall_Assess

# Auth
AUTH_MODE=OPTIONAL              # OPTIONAL (dev) | REQUIRED (prod)
```

---

## 7. docker-compose.yml (per usecase repo)

```yaml
services:
  agent-runtime:
    build:
      context: .
      dockerfile: services/agent-runtime/Dockerfile
    image: agent-runtime:local
    ports:
      - "${AGENT_RUNTIME_PORT:-8081}:8080"
    environment:
      CONTRACT_VERSION: "v1"
      TOOL_GATEWAY_URL: ${TOOL_GATEWAY_URL:-http://host.docker.internal:8080}
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      OPENAI_MODEL: ${OPENAI_MODEL:-gpt-4o-mini}
      AUTH_MODE: "OPTIONAL"
      AGENT_ENV: "dev"
    volumes:
      - ./state:/app/state       # memory files persisted on host
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

---

## 8. Config Precedence

When the same setting exists in multiple places, this order wins:

```
Environment variable  (highest priority)
    ↓
dev.yaml / prod.yaml  (env-specific override)
    ↓
base.yaml             (base defaults)
    ↓
agent.yaml            (agent feature flags)
    ↓
built-in code default (lowest priority)
```
