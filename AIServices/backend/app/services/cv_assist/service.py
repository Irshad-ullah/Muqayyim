"""
CV assist (12 Part 2, Module 4): Generate / Improve the summary, one experience entry or one
project description from the user's OWN facts, with the truthfulness post-check.

CoreServices builds the facts on the server (profile context) and sends the target entry with
allowed fields only; contact details never arrive here, and the user's name (`redact`) is used
only to scrub free text before anything is sent to the model. The model's suggestion is returned
with flags; the user reviews it (accept / edit / discard) — nothing is saved here.
"""

from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.services.cv_assist import truthfulness
from app.services.llm import get_llm_client
from app.services.llm.privacy import minimise
from app.services.llm.prompts import data_block

FEATURE = "cv_assist"
PROMPT = "cv_assist"

TASKS = {
    ("summary", "generate"): "Write a professional summary of 2-3 sentences for the top of this person's CV.",
    ("summary", "improve"): "Improve the wording of the current professional summary (2-3 sentences).",
    ("experience", "generate"): "Write the responsibilities and achievements for this one job entry.",
    ("experience", "improve"): "Improve the wording of the responsibilities and achievements for this one job entry.",
    ("project", "generate"): "Write a short description of this one project.",
    ("project", "improve"): "Improve the wording of the description of this one project.",
}
FORMAT = {
    "summary": ("Output one paragraph of 2-3 natural sentences. Mention only the 6-8 skills most relevant to the "
                "person's experience, projects and headline; do not list every skill."),
    "experience": "Output 2-5 bullet points, one per line, each starting with '- ' and a strong verb.",
    "project": "Output 1-3 sentences or up to 4 bullet points (one per line, starting with '- ').",
}


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")  # anything unexpected (e.g. contact fields) is refused


class ExperienceFacts(_Strict):
    title: str = Field("", max_length=200)
    company: str = Field("", max_length=200)
    startDate: str = Field("", max_length=40)
    endDate: str = Field("", max_length=40)
    current: bool = False
    status: Literal["current", "past", ""] = ""  # set by Core from `current`


class EducationFacts(_Strict):
    degree: str = Field("", max_length=200)
    field: str = Field("", max_length=200)
    institution: str = Field("", max_length=200)
    # Set by Core from the end date: an in-progress degree must never read as completed.
    status: Literal["completed", "in_progress", "unknown"] = "unknown"
    expected_year: str = Field("", max_length=4)


class ProjectFacts(_Strict):
    name: str = Field("", max_length=200)
    technologies: List[str] = Field(default_factory=list, max_length=40)


class CertificationFacts(_Strict):
    name: str = Field("", max_length=200)
    issuer: str = Field("", max_length=200)


class ProfileContext(_Strict):
    headline: str = Field("", max_length=200)
    skills: List[str] = Field(default_factory=list, max_length=200)
    experience: List[ExperienceFacts] = Field(default_factory=list, max_length=30)
    education: List[EducationFacts] = Field(default_factory=list, max_length=20)
    projects: List[ProjectFacts] = Field(default_factory=list, max_length=40)
    certifications: List[CertificationFacts] = Field(default_factory=list, max_length=40)


class TargetEntry(_Strict):
    """The entry being written: an experience entry (title / company / dates) or a project."""
    title: str = Field("", max_length=200)
    company: str = Field("", max_length=200)
    startDate: str = Field("", max_length=40)
    endDate: str = Field("", max_length=40)
    current: bool = False
    status: Literal["current", "past", ""] = ""
    name: str = Field("", max_length=200)
    technologies: List[str] = Field(default_factory=list, max_length=40)


class AssistRequest(_Strict):
    target: Literal["summary", "experience", "project"]
    mode: Literal["generate", "improve"]
    entry: Optional[TargetEntry] = None
    current_text: str = Field("", max_length=4000)
    context: ProfileContext = Field(default_factory=ProfileContext)
    redact: List[str] = Field(default_factory=list, max_length=8)  # the user's name; never sent to the model


class AssistOutput(BaseModel):
    text: str = Field("", max_length=6000)
    insufficient_data: bool = False


def _profile(request: AssistRequest) -> dict:
    """Only the facts this target needs."""
    c = request.context
    if request.target == "summary":
        return {"headline": c.headline, "skills": c.skills,
                "experience": [e.model_dump() for e in c.experience],
                "education": [e.model_dump() for e in c.education],
                "projects": [p.model_dump() for p in c.projects],
                "certifications": [x.model_dump() for x in c.certifications]}
    entry = request.entry or TargetEntry()
    if request.target == "experience":
        return {"job": entry.model_dump(include={"title", "company", "startDate", "endDate", "current", "status"}), "skills": c.skills}
    return {"project": entry.model_dump(include={"name", "technologies"}), "skills": c.skills}


async def assist(request: AssistRequest, user_id: str) -> dict:
    profile = _profile(request)
    redact = [r for r in request.redact if r and r.strip()]
    values = {
        "task": TASKS[(request.target, request.mode)],
        "format_rule": FORMAT[request.target],
        "profile": data_block("profile", profile, redact=redact),
        "current": data_block("current_text", {"text": request.current_text}, redact=redact),
    }
    result = await get_llm_client().generate_json(FEATURE, PROMPT, AssistOutput, user_id=user_id, values=values)
    output: AssistOutput = result.data
    text = output.text.strip()
    # The check compares against exactly what the model was given (after minimisation).
    seen = minimise({"profile": profile, "current": request.current_text}, redact)
    flags = truthfulness.check(text, seen) if text else []
    return {
        "suggestion": text,
        "insufficient_data": bool(output.insufficient_data or not text),
        "flags": [f.public() for f in flags],
        "usage": {"cached": result.cached, "input_tokens": result.input_tokens, "output_tokens": result.output_tokens,
                  "latency_ms": result.latency_ms, "model": result.model, "prompt": result.prompt_ref},
    }
