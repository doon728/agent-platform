# overlay-templates

Source templates for agent overlays. Each overlay declares an agent's behavior via config + prompts + skills + tools + evals.

## Overlay layout (Brij-style — recommended for new overlays)

Each overlay under `overlays/<overlay_name>/` follows this layout:

```
overlays/<overlay_name>/
├── agent_manifest.yaml        ← overlay declaration: agent type, components, features, entrypoint
├── config/
│   ├── agent.yaml             ← runtime config (reasoning strategy, tools, RAG, planner)
│   ├── memory.yaml            ← per-scope memory read/write policies
│   └── prompt-defaults.yaml   ← legacy combined prompts (superseded by prompts/ folder)
│
├── prompts/                   ← individual prompt files (one role per file)
│   ├── planner_system.md
│   ├── responder_system.md
│   └── ... (per overlay-specific prompts)
│
├── skills/                    ← reusable behavior patterns (markdown with YAML front-matter)
│   └── escalate_to_human.md   (example)
│
├── tools/                     ← tool definitions + per-tool prompts (future home; today see config/agent.yaml)
│   └── README.md
│
└── evals/                     ← per-overlay test cases + scorecards
    └── README.md
```

## Why split into folders

- **`prompts/`** — one prompt per file is friendlier to non-developers and makes prompt versioning + A/B testing trivial. Aligned with Brij Kishore Pandey's "every prompt as a real file" pattern.
- **`skills/`** — reusable behavior patterns (Anthropic Skills, Microsoft Foundry Skills). Procedural knowledge as markdown.
- **`tools/`** — future home for per-tool definitions when overlays gain inline tool authoring.
- **`evals/`** — golden + edge-case scenarios per overlay. Drives the prompt evaluation workbench in C4.

## Backward compatibility

- `config/prompt-defaults.yaml` is still loaded by the runtime today (legacy path).
- New overlays should put prompts in `prompts/` as separate `.md` files.
- The migration plan is to teach `platform_core.prompt` how to load from either location, then deprecate `prompt-defaults.yaml`.

## Reference overlays

- `overlays/chat_agent_simple/` — interactive chat agent (planner → executor → responder).
- `overlays/summarization_agent_simple/` — read-only summarization agent (single-pass).

## Common files

- `common/` — files shared by all overlays (Dockerfile, agent-runtime config templates, etc.).
