"""Skill loader — loads markdown-based reusable behavior patterns from an overlay's skills/ folder.

Skills are reusable behavior patterns (procedural knowledge) — markdown files describing
how an agent should perform a specific task. Aligns with Anthropic Claude Skills + Microsoft
Foundry's "skills as markdown" pattern.

A skill file may include front-matter (YAML between ``---`` markers) and a markdown body:

    ---
    name: triage_intake
    description: Classify an incoming document into appeal / PA / claim dispute
    triggers: ["new document arrived", "intake"]
    ---
    ## Steps
    1. Extract member ID, claim number, denial reason from the document.
    2. Match against historical patterns.
    3. Output classification with confidence.

Skills are typically referenced from prompts (e.g., the planner prompt can include the
skill body as additional context) or used as system-message fragments.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml


@dataclass
class Skill:
    """A loaded skill — front-matter metadata + markdown body."""

    name: str
    description: str
    body: str
    triggers: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    source_path: Path | None = None


class SkillLoader:
    """Loads skills from a directory of markdown files.

    Resilient: malformed files are skipped with a warning printed to stderr,
    not raised — one bad skill should not break agent boot.
    """

    def __init__(self, skills_dir: Path | str):
        self.skills_dir = Path(skills_dir)
        self._cache: dict[str, Skill] | None = None

    def _parse_front_matter(self, text: str) -> tuple[dict[str, Any], str]:
        """Split a markdown file into (front_matter_dict, body)."""
        if not text.startswith("---"):
            return {}, text
        try:
            _, fm_block, *body_parts = text.split("---", 2)
        except ValueError:
            return {}, text
        body = body_parts[0].lstrip("\n") if body_parts else ""
        try:
            fm = yaml.safe_load(fm_block) or {}
        except yaml.YAMLError:
            return {}, text
        if not isinstance(fm, dict):
            return {}, text
        return fm, body

    def _load_one(self, path: Path) -> Skill | None:
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            return None
        fm, body = self._parse_front_matter(text)
        name = fm.get("name") or path.stem
        description = fm.get("description", "")
        triggers = fm.get("triggers", []) or []
        if not isinstance(triggers, list):
            triggers = []
        return Skill(
            name=str(name),
            description=str(description),
            body=body,
            triggers=[str(t) for t in triggers],
            metadata={k: v for k, v in fm.items() if k not in ("name", "description", "triggers")},
            source_path=path,
        )

    def load_all(self) -> dict[str, Skill]:
        """Load every *.md file in skills_dir. Returns dict keyed by skill name."""
        if self._cache is not None:
            return self._cache
        skills: dict[str, Skill] = {}
        if not self.skills_dir.exists() or not self.skills_dir.is_dir():
            self._cache = skills
            return skills
        for path in sorted(self.skills_dir.glob("*.md")):
            skill = self._load_one(path)
            if skill is None:
                continue
            skills[skill.name] = skill
        self._cache = skills
        return skills

    def get(self, name: str) -> Skill | None:
        """Get a skill by name, or None if not found."""
        return self.load_all().get(name)

    def find_by_trigger(self, query: str) -> list[Skill]:
        """Return skills whose trigger phrases appear in the query (case-insensitive)."""
        q = query.lower()
        return [s for s in self.load_all().values() if any(t.lower() in q for t in s.triggers)]
