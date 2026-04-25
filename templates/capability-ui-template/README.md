# capability-ui-template

Generic scaffold for capability-level UIs (e.g., the Care Management nurse console, Pre-Authorization reviewer console, etc.).

Each capability owns its own UI under `capabilities/<capability>/ui/`. This template is the starting point used by Agent Factory when scaffolding a new capability.

## Layout (when materialized into a new capability)

```
capabilities/<capability>/ui/
├── docker-compose.yml          ← UI deployment + ports
├── app-config/                 ← per-capability config
└── services/
    └── ui/                     ← React/Vite app
        ├── package.json
        ├── src/
        │   ├── pages/          ← capability-specific pages
        │   └── components/
        └── public/
```

## Driven by `domain.yaml`

The UI reads `capabilities/<capability>/domain.yaml` to render scope-driven inputs (member ID, case ID, etc.). No hardcoding — fields come from the capability's domain config.

## Reference implementation

`capabilities/care-management/ui/` is the live reference — nurse console with members, cases, assessments pages.

## Scaffolding a new capability UI

The Agent Factory UI scaffolds a new capability by copying this template + selecting reference patterns from existing capabilities. Owner of the capability customizes pages, components, and styling.
