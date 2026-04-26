# How To Extend

---

## Add a New Tool

**Files to touch: 2 files in tool-gateway + 1 file in overlay config**

### Step 1 — Tool Gateway: add to registry.py

```python
# services/.../src/tools/registry.py

class GetMyNewToolInput(BaseModel):
    some_id: str

class GetMyNewToolOutput(BaseModel):
    found: bool
    data: Optional[dict] = None

def get_my_new_tool_handler(inp: GetMyNewToolInput) -> GetMyNewToolOutput:
    result = store().get_something(inp.some_id)
    return GetMyNewToolOutput(found=True, data=result)

TOOL_REGISTRY["get_my_new_tool"] = ToolSpec(
    name="get_my_new_tool",
    description="What this tool does.",
    input_model=GetMyNewToolInput,
    output_model=GetMyNewToolOutput,
    handler=get_my_new_tool_handler,
    primary_arg="some_id",
    mode="read",
    tags=["care_management"],
)
```

### Step 2 — Tool Gateway: add data query to pg_store.py (if needed)

```python
def get_something(self, some_id: str) -> Dict[str, Any]:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT ... FROM ... WHERE id = %s", (some_id,))
            row = cur.fetchone()
            return {"found": bool(row), ...}
```

### Step 3 — Overlay config: add to agent.yaml

```yaml
tools:
  allowed:
    - get_my_new_tool    # add here
```

### Step 4 — Rebuild tool-gateway + restart agent-runtime

```bash
# In services
docker compose up -d --build

# In usecase repo — restart so it re-discovers tools
docker compose restart agent-runtime
```

### Step 5 — (Optional) Add HARD_ROUTE in llm_planner.py

If you want deterministic routing for this tool without LLM:

```python
# overlays/chat_agent/agents/llm_planner.py
my_tool_phrases = ["some phrase", "another phrase"]

if active_assessment_id and any(x in lower_p for x in my_tool_phrases):
    if "get_my_new_tool" in allowed_tools:
        return ([f"get_my_new_tool: {active_assessment_id}"], {"route_type": "HARD_ROUTE", ...})
```

---

## Add a New Agent Type

**Files to create: 1 new overlay folder in template**

### Step 1 — Create overlay in template

```
templates/overlay-templates/overlays/summary_agent/
  overlay.yaml
  config/
    agent.yaml
    memory.yaml
    prompt-defaults.yaml
  agents/
    summarizer.py       ← your agent logic
    executor.py         ← can copy from chat_agent
  graph/
    state.py            ← define state schema for this graph
  orchestration/
    build_graph.py      ← wire your nodes and edges here
```

### Step 2 — Copy overlay to generated repo

```bash
cp -r templates/overlay-templates/overlays/summary_agent/ \
      generated-repos/care-management/usecases/UC_PreCall_Assess/cm-chat-buddy-assess/overlays/
```

### Step 3 — Set AGENT_TYPE to run it

In docker-compose.yml or .env:
```yaml
environment:
  AGENT_TYPE: summary_agent
```

Or run two agents from same repo on different ports:
```yaml
services:
  chat-runtime:
    environment:
      AGENT_TYPE: chat_agent
    ports: ["8081:8080"]

  summary-runtime:
    environment:
      AGENT_TYPE: summary_agent
    ports: ["8082:8080"]
```

**Nothing in common/src/ changes. Platform picks up the new overlay automatically.**

---

## Add a New Usecase

**Files to create: 1 new usecase repo + 1 overlay config**

### Step 1 — Scaffold new repo from template

```bash
# Copy template to new usecase location
cp -r templates/overlay-templates/common/ \
      generated-repos/care-management/usecases/UC_PostCall_Document/cm-post-call-agent/services/agent-runtime/

cp -r templates/overlay-templates/overlays/ \
      generated-repos/care-management/usecases/UC_PostCall_Document/cm-post-call-agent/overlays/
```

### Step 2 — Customize agent.yaml for this usecase

```
generated-repos/care-management/usecases/UC_PostCall_Document/cm-post-call-agent/
  overlays/chat_agent/overlay.yaml + reasoning.yaml + rag.yaml + hitl.yaml + tools/tools.yaml   ← different tools, different risk config
```

### Step 3 — Update base.yaml

```yaml
app:
  capability_name: care-management
prompt_service:
  agent_type: chat_agent
  usecase_name: UC_PostCall_Document   ← new usecase name
```

### Step 4 — Start the new runtime

```bash
cd generated-repos/care-management/usecases/UC_PostCall_Document/cm-post-call-agent
docker compose up -d --build
```

**The UI connects to whichever agent runtime it's proxied to — set VITE_API_PROXY_TARGET.**

---

## Add a New UI Page

**Files to touch: 2 files in UI template**

### Step 1 — Create page in template

```
templates/capability-ui-template/services/ui/src/pages/MyNewPage.tsx
```

### Step 2 — Add route in App.tsx

```tsx
// templates/capability-ui-template/services/ui/src/App.tsx
import MyNewPage from "./pages/MyNewPage";

// In routes:
<Route path="/my-new-page" element={<MyNewPage />} />

// In nav:
<NavLink to="/my-new-page">My Page</NavLink>
```

### Step 3 — Copy to generated repo

```bash
cp templates/capability-ui-template/services/ui/src/pages/MyNewPage.tsx \
   generated-repos/care-management/cm-hero-fl-app/services/ui/src/pages/MyNewPage.tsx

cp templates/capability-ui-template/services/ui/src/App.tsx \
   generated-repos/care-management/cm-hero-fl-app/services/ui/src/App.tsx
```

UI hot-reloads automatically — no rebuild needed.

---

## Add a New Memory Scope

**Files to touch: memory.yaml + context_builder.py + memory_store.py**

### Step 1 — Add scope to memory.yaml

```yaml
scope_taxonomy:
  - conversation
  - assessment
  - case
  - member
  - care_plan    ← new scope
```

### Step 2 — Add rollup logic in context_builder.py

```python
# templates/.../src/platform/memory/context_builder.py
if "care_plan" in scopes:
    care_plan_id = scopes.get("care_plan")
    memories = store.read_episodic(tenant_id, "care_plan", care_plan_id)
    # add to context...
```

### Step 3 — Register child scope relationships in langgraph_runner.py

```python
care_plan_id = ctx.get("care_plan_id")
if care_plan_id and case_id:
    memory_store.register_child_scope(tenant_id, "case", case_id, "care_plan", care_plan_id)
```
