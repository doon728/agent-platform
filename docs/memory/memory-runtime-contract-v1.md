# Memory Runtime Contract v1

## Runtime Responsibilities
- resolve active scopes from request
- load memory config for active capability/usecase/agent
- retrieve relevant memories
- assemble memory context
- persist raw chat turns
- trigger episodic/semantic/summary writes

## Inputs to Runtime
- tenant_id
- user_id
- thread_id
- optional member_id
- optional case_id
- optional assessment_id
- prompt
- active capability/usecase/agent metadata

## Required Runtime Interfaces

### resolve_scopes(ctx) -> list[ScopeRef]
Return ordered active scopes based on configured resolution priority.

### get_recent_history(thread_id, max_turns) -> list[dict]
Return recent raw conversation turns.

### get_memory_context(scopes, config) -> dict
Return assembled memory payload for prompt context.

### append_raw_turn(thread_id, role, content, metadata) -> None
Persist raw chat history.

### process_memory_write_triggers(event, scopes, config) -> None
Evaluate whether episodic, semantic, or summary memories should be written.

## Context Assembly Output Shape
Example:

{
  "recent_turns": [...],
  "conversation_summary": "...",
  "episodic_memories": [...],
  "semantic_memories": [...]
}

Runtime will convert this into prompt-ready context.