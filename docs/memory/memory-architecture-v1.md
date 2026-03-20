# Memory Architecture v1

## Purpose
Provide a generic, config-driven memory framework for different usecases and agent types.

## Goals
- support short_term, episodic, semantic, and summary memory
- support hierarchical scopes such as parent/child case relationships
- make memory config-driven per capability/usecase/agent
- keep memory retrieval separate from chat UI history
- make retrieved memory part of runtime context assembly

## Scope Types
Stable platform scope taxonomy:
- conversation
- user
- member
- case
- assessment
- care_plan

## Scope Model
Scope types are predefined by platform.
Scope instances are dynamic at runtime.

For hierarchical scopes like case:
- scope_type = case
- scope_id = dynamic case id
- parent_scope_id = optional
- root_scope_id = optional
- scope_level = integer
- scope_kind = business subtype such as medication_review, discharge_followup

Do not create separate scope types for parent_case or child_case.

## Memory Types

### 1. short_term
Purpose:
- recent conversation continuity

Write trigger:
- every turn

Primary scope:
- conversation

### 2. episodic
Purpose:
- meaningful events and outcomes

Write triggers:
- tool success
- workflow checkpoint
- assessment completed
- explicit case event

Primary scopes:
- case
- assessment

Linked scopes:
- member
- parent/root case if configured

### 3. semantic
Purpose:
- durable facts and preferences

Write trigger:
- extractor job only

Primary scopes:
- member
- user

Examples:
- preferred language
- communication preference
- durable barrier or preference

### 4. summary
Purpose:
- compression of long interactions or case state

Write triggers:
- every N turns
- session end
- workflow end

Primary scopes:
- conversation
- case

## Write Policy
Memory is not stored by magic.
Runtime applies configured policies.

Always store:
- raw conversation history

Selectively store:
- episodic memory
- semantic memory
- summaries

## Retrieval Policy
Runtime retrieves:
- recent conversation turns
- latest summaries
- scoped episodic memory
- relevant semantic memory

UI may show full chat history.
LLM should usually receive only a curated subset.

## Runtime Sequence
1. resolve active scopes
2. load memory config
3. retrieve recent turns
4. retrieve summaries
5. retrieve scoped memories
6. assemble memory context
7. invoke planner/responder
8. persist raw turn
9. evaluate write triggers
10. write episodic/semantic/summary memories

## Hierarchy Handling
Use relationship metadata, not separate scope types.

When writing child case memory:
- primary scope can be child case
- optional links can point to parent case, root case, and member

When retrieving for a child case:
- retrieve child case memory first
- optionally include parent/root case memory based on policy

## Storage Model
Use hybrid storage:
- Postgres for records, links, metadata, summaries
- pgvector or vector store for semantic retrieval
- Redis optional for short-term cache

## Phase 1 Storage
Use Postgres + JSONB + pgvector if needed later.

## Phase 1 Output Artifacts
- memory.yaml config
- memory service API contract
- Postgres schema
- runtime integration interfaces