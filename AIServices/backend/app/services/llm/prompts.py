"""
Prompts as versioned files (12): app/services/llm/prompts/<name>.txt.

File format: the first line is "# version: <n>", then optional "# ..." comment lines, then the
template. Placeholders use string.Template syntax: $name / ${name}. Untrusted data (CV, profile,
GitHub text) is NEVER substituted directly: it goes through `data_block`, which minimises it (no
contact details), serialises it as JSON and wraps it in a delimited section that the system
instruction tells the model to treat as data only.
"""

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from string import Template
from typing import Any, Sequence

from app.services.llm.privacy import minimise

PROMPT_DIR = Path(__file__).resolve().parent / "prompts"
OPEN, CLOSE = "<<<DATA {name}>>>", "<<<END DATA {name}>>>"
_NAME = re.compile(r"^[a-z][a-z0-9_]{0,40}$")


@dataclass(frozen=True)
class PromptTemplate:
    name: str
    version: str
    template: str

    @property
    def ref(self) -> str:
        return f"{self.name}@v{self.version}"

    def render(self, **values: str) -> str:
        return Template(self.template).substitute(**values)


@lru_cache(maxsize=None)
def load(name: str) -> PromptTemplate:
    if not _NAME.match(name):
        raise ValueError(f"bad prompt name {name!r}")
    text = (PROMPT_DIR / f"{name}.txt").read_text(encoding="utf8")
    lines = text.splitlines()
    match = re.match(r"^#\s*version:\s*(\S+)\s*$", lines[0] if lines else "")
    if not match:
        raise ValueError(f"prompt {name} must start with '# version: <n>'")
    body = [line for line in lines[1:] if not line.startswith("#")]
    return PromptTemplate(name, match.group(1), "\n".join(body).strip() + "\n")


def data_block(name: str, data: Any, redact: Sequence[str] = ()) -> str:
    """Untrusted data, minimised (contact details and `redact` terms removed) and delimited.
    Delimiter look-alikes inside the data are defused."""
    if not _NAME.match(name):
        raise ValueError(f"bad data block name {name!r}")
    payload = json.dumps(minimise(data, redact), ensure_ascii=False, indent=1)
    payload = payload.replace("<<<", "< < <").replace(">>>", "> > >")
    return f"{OPEN.format(name=name)}\n{payload}\n{CLOSE.format(name=name)}"
