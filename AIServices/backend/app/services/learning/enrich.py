"""
Learning path enrichment (Module 6) with the shared LLM client (consent checked by Core; quota, cache, delimited data
blocks, usage records as for every feature). Prompt files learning_path@v2 and learning_more@v2.

Sent to the model: the role title, the ordered module skills, the user's skill NAMES and the cost preference (free
only / include paid). Nothing else (no profile text, no contact details). Resources are in English only. The cache key
contains the prompt text, so it includes the cost preference.

Validation, all in the schema (an invalid answer gets the client's one corrective retry, then LLMInvalidOutput — Core
then keeps the path without enrichment). Named checks, logged and recorded by name only (llm_usage.reject_reason):
  url_found             a URL / web address / domain anywhere
  hours_out_of_range    hours outside 2–80 per module, hours_min > hours_max, or Σ hours_max > 400
  module_set_mismatch   the modules differ from the path's (added, dropped, renamed or repeated; validation context)
  schema                anything else (platform not in PLATFORMS, 3–6 sub-topics, 2–4 recommendations, …)
Afterwards: free-only preference: paid recommendations are dropped (a module keeps at least one).
Links are built only here: "Find on {platform}" search URLs from the title and the instructor. Labels: every
recommendation "AI recommendation" (paid: "AI recommendation, check before buying"); hours "estimated". Prerequisite
pairs go through structure.validate_prerequisites / apply_prerequisites.
"""

import re
from typing import List, Literal, Optional
from urllib.parse import quote_plus

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator, model_validator
from pydantic_core import PydanticCustomError

from app.services.embeddings.normalise import normalise_skill
from app.services.learning import structure
from app.services.llm import get_llm_client
from app.services.llm.errors import LLMInvalidOutput
from app.services.llm.prompts import data_block

FEATURE, MORE_FEATURE = "learning_path", "learning_more"
PLATFORMS = ("YouTube", "Coursera", "Udemy", "freeCodeCamp", "edX", "Official docs")
MIN_HOURS, MAX_HOURS, MAX_TOTAL_HOURS = 2, 80, 400
URL = re.compile(r"(https?://|ftp://|www\.|\b[a-z0-9-]+\.(?:com|org|net|io|dev|edu|gov|co|ai|app|ly|me|tv|info|uk|pk|in)\b)", re.I)
SEARCH = {
    "YouTube": "https://www.youtube.com/results?search_query={q}",
    "Coursera": "https://www.coursera.org/search?query={q}",
    "Udemy": "https://www.udemy.com/courses/search/?q={q}",
    "freeCodeCamp": "https://www.freecodecamp.org/news/search?query={q}",
    "edX": "https://www.edx.org/search?q={q}",
    "Official docs": "https://duckduckgo.com/?q={q}",
}
LABEL_FREE, LABEL_PAID, HOURS_LABEL = "AI recommendation", "AI recommendation, check before buying", "estimated"


def _no_url(value: str) -> str:
    if isinstance(value, str) and URL.search(value):
        raise PydanticCustomError("url_found", "URLs, web addresses and domain names are not allowed")
    return value


def _hours_error(message: str) -> PydanticCustomError:
    return PydanticCustomError("hours_out_of_range", message)


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Recommendation(_Strict):
    platform: Literal[PLATFORMS]  # type: ignore[valid-type]
    title: str = Field(..., min_length=2, max_length=160)
    instructor: str = Field("", max_length=100)
    description: str = Field("", max_length=300)
    free: bool

    @field_validator("title", "instructor", "description")
    @classmethod
    def _text_no_url(cls, value: str) -> str:
        return _no_url(value)


class ModuleEnrichment(_Strict):
    skill: str = Field(..., max_length=120)
    why: str = Field(..., min_length=10, max_length=400)
    subtopics: List[str] = Field(..., min_length=3, max_length=6)
    project: str = Field(..., min_length=10, max_length=400)
    hours_min: int = Field(..., json_schema_extra={"minimum": MIN_HOURS, "maximum": MAX_HOURS})
    hours_max: int = Field(..., json_schema_extra={"minimum": MIN_HOURS, "maximum": MAX_HOURS})
    recommendations: List[Recommendation] = Field(..., min_length=2, max_length=4)

    @field_validator("why", "project", "skill")
    @classmethod
    def _text_no_url(cls, value: str) -> str:
        return _no_url(value)

    @field_validator("subtopics")
    @classmethod
    def _subtopics(cls, value: List[str]) -> List[str]:
        for item in value:
            _no_url(item)
            if not 2 <= len(item) <= 120:
                raise ValueError("a sub-topic must be 2-120 characters")
        return value

    @field_validator("hours_min", "hours_max")
    @classmethod
    def _hours_range(cls, value: int) -> int:
        if not MIN_HOURS <= value <= MAX_HOURS:
            raise _hours_error(f"hours must be between {MIN_HOURS} and {MAX_HOURS}")
        return value

    @model_validator(mode="after")
    def _hours_order(self):
        if self.hours_min > self.hours_max:
            raise _hours_error("hours_min must not exceed hours_max")
        return self


class PathEnrichment(_Strict):
    modules: List[ModuleEnrichment] = Field(..., min_length=1, max_length=structure.MAX_MODULES)
    prerequisites: List[List[str]] = Field(default_factory=list, max_length=30)

    @model_validator(mode="after")
    def _modules_and_total(self, info: ValidationInfo):
        expected = (info.context or {}).get("module_keys")
        if expected is not None:  # the module set must equal the path's: nothing added, renamed, dropped or repeated
            keys = [normalise_skill(m.skill)[0] for m in self.modules]
            if len(set(keys)) != len(keys) or sorted(keys) != sorted(expected):
                raise PydanticCustomError("module_set_mismatch", "cover exactly the modules in MODULES, once each")
        if sum(m.hours_max for m in self.modules) > MAX_TOTAL_HOURS:
            raise _hours_error(f"total hours_max must not exceed {MAX_TOTAL_HOURS}")
        for pair in self.prerequisites:
            if len(pair) != 2:
                raise ValueError("a prerequisite is a pair [before, after]")
            for item in pair:
                _no_url(item)
        return self


class MoreRecommendations(_Strict):
    recommendations: List[Recommendation] = Field(..., min_length=2, max_length=4)


class Preferences(_Strict):
    cost: Literal["free", "include_paid"] = "free"
    hours_per_week: int = Field(5, ge=1, le=60)


class EnrichRequest(_Strict):
    role_title: str = Field(..., max_length=200)
    modules: List[dict] = Field(..., min_length=1, max_length=structure.MAX_MODULES)  # [{key, skill}] in path order
    user_skills: List[str] = Field(default_factory=list, max_length=300)
    preferences: Preferences = Field(default_factory=Preferences)


class MoreRequest(_Strict):
    role_title: str = Field(..., max_length=200)
    skill: str = Field(..., max_length=120)
    exclude_titles: List[str] = Field(default_factory=list, max_length=30)
    preferences: Preferences = Field(default_factory=Preferences)


def cost_rule(preferences: Preferences) -> str:
    return ("Recommend only free resources (free = true)." if preferences.cost == "free"
            else "Free and paid resources are both allowed; mark each one correctly with free = true or false.")


def search_link(rec: Recommendation, skill: str) -> dict:
    """"Find on {platform}": a search URL built by our code from the title and instructor (never from the model)."""
    terms = " ".join(t for t in (rec.title, rec.instructor) if t)
    if rec.platform == "Official docs":
        terms = f"{skill} {rec.title} official documentation"
    return {"search_url": SEARCH[rec.platform].format(q=quote_plus(terms)), "search_label": f"Find on {rec.platform}"}


def public_recommendations(recs: List[Recommendation], skill: str, preferences: Preferences) -> List[dict]:
    kept = [r for r in recs if r.free or preferences.cost == "include_paid"] or recs[:1]
    return [{**r.model_dump(), **search_link(r, skill), "label": LABEL_FREE if r.free else LABEL_PAID} for r in kept]


def _usage(result) -> dict:
    return {"cached": result.cached, "input_tokens": result.input_tokens, "output_tokens": result.output_tokens,
            "latency_ms": result.latency_ms, "model": result.model, "prompt": result.prompt_ref}


async def enrich(request: EnrichRequest, user_id: str) -> dict:
    module_keys = [str(m.get("key") or normalise_skill(m.get("skill", ""))[0]) for m in request.modules]
    names = [str(m.get("skill") or "") for m in request.modules]
    values = {
        "cost_rule": cost_rule(request.preferences),
        "role": data_block("role", {"title": request.role_title}),
        "modules": data_block("modules", [{"skill": n} for n in names]),
        "known": data_block("known_skills", sorted(set(request.user_skills))),
    }
    result = await get_llm_client().generate_json(FEATURE, "learning_path", PathEnrichment, user_id=user_id, values=values,
                                                  max_output_tokens=4096, validation_context={"module_keys": module_keys})
    output: PathEnrichment = result.data
    by_key = {normalise_skill(m.skill)[0]: m for m in output.modules}  # equal to the path's set (validated)
    accepted, rejected = structure.validate_prerequisites(output.prerequisites, module_keys)
    ordered = structure.apply_prerequisites([{"key": k} for k in module_keys], accepted)
    modules = []
    for key, name in zip(module_keys, names):
        m = by_key[key]
        modules.append({"key": key, "skill": name, "why": m.why, "subtopics": m.subtopics, "project": m.project,
                        "hours": {"min": m.hours_min, "max": m.hours_max, "label": HOURS_LABEL},
                        "recommendations": public_recommendations(m.recommendations, name, request.preferences)})
    return {"modules": modules, "order": [m["key"] for m in ordered],
            "prerequisites": {"accepted": [list(p) for p in accepted], "rejected": rejected},
            "total_hours": {"min": sum(m["hours"]["min"] for m in modules), "max": sum(m["hours"]["max"] for m in modules),
                            "label": HOURS_LABEL},
            "usage": _usage(result)}


async def more(request: MoreRequest, user_id: str) -> dict:
    values = {
        "cost_rule": cost_rule(request.preferences),
        "role": data_block("role", {"title": request.role_title}),
        "skill": data_block("skill", {"skill": request.skill}),
        "shown": data_block("already_shown", request.exclude_titles),
    }
    result = await get_llm_client().generate_json(MORE_FEATURE, "learning_more", MoreRecommendations, user_id=user_id,
                                                  values=values, max_output_tokens=1024)
    shown = {t.strip().lower() for t in request.exclude_titles}
    fresh = [r for r in result.data.recommendations if r.title.strip().lower() not in shown]
    if not fresh:
        raise LLMInvalidOutput()
    return {"recommendations": public_recommendations(fresh, request.skill, request.preferences), "usage": _usage(result)}
