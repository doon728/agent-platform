# Agent Platform — Documentation Index

## Architecture & Overview
- [platform-overview.md](platform-overview.md) — What the platform is, high-level architecture, key concepts
- [taxonomy.md](taxonomy.md) — Capability → Usecase → Agent → Application hierarchy

## Repository & Structure
- [repo-structure.md](repo-structure.md) — Complete file tree, what every folder and file does
- [template-guide.md](template-guide.md) — Template → generated repo flow, what gets carried over automatically

## Configuration
- [configuration-guide.md](configuration-guide.md) — Every config file and field explained (agent.yaml, memory.yaml, docker-compose, env vars)

## Platform Components
- [platform-components.md](platform-components.md) — Deep dive: Planner, Router, Executor, Responder, Memory, Tools, Observability

## How To Extend
- [how-to-extend.md](how-to-extend.md) — Step-by-step recipes: add a new tool, new agent type, new usecase

## Containers & Build
- [containers-and-build.md](containers-and-build.md) — All containers, ports, how to build and run each

## Backlog
- [backlog.md](backlog.md) — Items agreed to build: RAG config wiring, multi-RAG patterns, HITL, AgentCore swap, Summary Agent, PowerPoint generation

## Cloud Deployment
- [agentcore-compatibility.md](agentcore-compatibility.md) — AWS AgentCore integration: what maps where, observability gap (infra vs agent-level), incremental migration path

## Feature Specs
- [hitl-design-spec.md](hitl-design-spec.md) — HITL design: async approval flow, internal adapter, memory integration
- [memory/memory-architecture-v1.md](memory/memory-architecture-v1.md) — Memory system: types, scopes, hierarchy, rollup

## Diagrams
All diagrams are in [diagrams/](diagrams/) as PNG files — insert directly into Word or PowerPoint.
