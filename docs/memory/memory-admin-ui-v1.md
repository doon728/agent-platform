# Memory Admin UI v1

## Goal
Allow memory policy to be configured per capability/usecase/agent without code changes.

## Required UI Sections

### 1. Enablement
- memory enabled yes/no

### 2. Scope Selection
- conversation
- user
- member
- case
- assessment
- care_plan

### 3. Short-Term Memory
- enabled yes/no
- retain last N turns

### 4. Episodic Memory
- enabled yes/no
- triggers:
  - tool success
  - workflow checkpoint
  - assessment completed
- link to parent scope yes/no
- link to root scope yes/no
- link to member scope yes/no

### 5. Semantic Memory
- enabled yes/no
- extractor profile
- confidence threshold
- allowed scopes

### 6. Summary Memory
- enabled yes/no
- every N turns
- on session end
- on workflow end

### 7. Retrieval Policy
- top_k per scope/memory type
- include parent/root scope yes/no
- include summaries yes/no
- max total items

## Phase 1 Delivery
UI can generate memory.yaml config first.
Central config service can come later.