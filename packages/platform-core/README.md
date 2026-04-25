# platform-core

Shared platform library for agent runtimes. Used by all AEA services (C2 Platform Services, C3 Tool Policy Gateway, C4 Control Plane) and by generated agent instances.

## What's in here

| Module | Purpose |
|---|---|
| `memory/` | Memory adapters (file, Postgres, AgentCore Memory) + scope policy + read/write router |
| `rag/` | Retrieval orchestration + indexer interfaces (multi-dim: stage × source × extraction) |
| `hitl/` | Human-in-the-loop approval store + state machine |
| `reasoning/` | Planner, executor, responder + reasoning strategies (simple, ReAct, plan-execute, multi-hop, reflection) |
| `tools/` | Tool registry, MCP client adapters, allow/deny enforcement |
| `auth/` | Auth adapter interfaces (local, Cognito, AgentCore Identity) |
| `prompt/` | Prompt loader + skill loader + templating |
| `observability/` | Tracing + metrics primitives |
| `plugins/` | Adapter interfaces (memory, tools, identity, observability) |
| `context/` | Domain scope + session context |
| `llm/` | LLM client wrappers (Bedrock, OpenAI) |
| `schema/` | Shared Pydantic models |

## Install

For development (editable):

```bash
pip install -e packages/platform-core
```

With dev tooling:

```bash
pip install -e "packages/platform-core[dev]"
```

For external consumption (e.g., AgentCore Factory):

```bash
pip install platform-core==<version>
```

## Imports

```python
from platform_core.memory import MemoryRouter
from platform_core.reasoning import build_planner, build_executor
from platform_core.rag import RagOrchestrator
from platform_core.hitl import ApprovalStore
```

## Versioning

Semantic versioning. Published to internal registry on tag.
