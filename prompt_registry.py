"""Versioned prompt templates, loaded by ID instead of being inlined as
string literals scattered through the codebase. Every answer can now be
traced back to exactly which prompt version produced it — the prerequisite
for the Eval Bench project to be able to diff runs at all."""

from pathlib import Path

PROMPTS_DIR = Path(__file__).parent / "prompts"


def load_prompt_template(version: str) -> str:
    path = PROMPTS_DIR / f"{version}.txt"
    if not path.exists():
        raise FileNotFoundError(f"No prompt template for version '{version}' at {path}")
    return path.read_text()
