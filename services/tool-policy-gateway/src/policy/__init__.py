"""Policy module — PDP (Policy Decision Point) responsibilities.

In Pattern A′, this gateway is a PDP: it authors policies and emits compiled
bundles to a downstream PEP (AgentCore Tool Gateway). Today the integration
with AgentCore is not yet wired (see backlog A1) so the compiler emits
bundles to local files; the audit consumer reads from a placeholder source.

Submodules:
- ``cedar_compiler`` — compile YAML allow/deny rules to Cedar policy bundles.
- ``audit_consumer`` — consume tool-call audit events from AgentCore Observability.
"""
