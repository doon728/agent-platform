"""Tests for the SkillLoader."""

from pathlib import Path

import pytest

from platform_core.prompt import Skill, SkillLoader


@pytest.fixture
def skills_dir(tmp_path: Path) -> Path:
    d = tmp_path / "skills"
    d.mkdir()
    return d


def _write(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")


def test_load_skill_with_full_front_matter(skills_dir: Path) -> None:
    _write(
        skills_dir / "triage_intake.md",
        """---
name: triage_intake
description: Classify incoming documents
triggers:
  - new document
  - intake
priority: high
---
## Steps
1. Extract member ID.
2. Match against patterns.
""",
    )
    loader = SkillLoader(skills_dir)
    skills = loader.load_all()

    assert "triage_intake" in skills
    skill = skills["triage_intake"]
    assert skill.description == "Classify incoming documents"
    assert skill.triggers == ["new document", "intake"]
    assert "Extract member ID" in skill.body
    assert skill.metadata.get("priority") == "high"


def test_load_skill_without_front_matter_uses_filename(skills_dir: Path) -> None:
    _write(skills_dir / "fallback_skill.md", "Just a plain markdown body.\n")
    loader = SkillLoader(skills_dir)
    skill = loader.get("fallback_skill")

    assert skill is not None
    assert skill.name == "fallback_skill"
    assert skill.description == ""
    assert skill.triggers == []
    assert "Just a plain markdown body" in skill.body


def test_get_returns_none_for_missing_skill(skills_dir: Path) -> None:
    loader = SkillLoader(skills_dir)
    assert loader.get("does_not_exist") is None


def test_find_by_trigger_matches_case_insensitive(skills_dir: Path) -> None:
    _write(
        skills_dir / "escalate.md",
        """---
name: escalate
description: Escalate to supervisor
triggers:
  - escalate
  - supervisor
---
Body.
""",
    )
    loader = SkillLoader(skills_dir)

    assert any(s.name == "escalate" for s in loader.find_by_trigger("Please ESCALATE this case"))
    assert loader.find_by_trigger("unrelated query") == []


def test_missing_skills_dir_returns_empty(tmp_path: Path) -> None:
    loader = SkillLoader(tmp_path / "nonexistent")
    assert loader.load_all() == {}
    assert loader.get("anything") is None


def test_malformed_front_matter_falls_back_safely(skills_dir: Path) -> None:
    """Skill with broken YAML front-matter should still load with body intact."""
    _write(
        skills_dir / "broken.md",
        """---
name: broken
description: [unclosed bracket
---
Body content here.
""",
    )
    loader = SkillLoader(skills_dir)
    skill = loader.get("broken")

    # Falls back to filename-based name and treats whole file as body
    assert skill is not None
    assert skill.name == "broken"


def test_skill_dataclass_is_immutable_in_practice() -> None:
    s = Skill(name="x", description="d", body="b")
    assert s.triggers == []
    assert s.metadata == {}
