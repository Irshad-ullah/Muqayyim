"""
Fits freshly parsed CV data inside the profile limits (app/constants/profile_limits.py)
so that verifying the parse result unchanged never fails validation.
Text is cut to the maximum length, lists to the maximum count, and skill
names that are too long to be a skill are dropped.
"""

from app.constants.profile_limits import (
    DESCRIPTION_MAX,
    MAX_EDUCATION,
    MAX_EXPERIENCE,
    MAX_PROJECTS,
    ORG_MAX,
    SKILL_MAX,
    SKILLS_TOTAL_MAX,
    TECHNOLOGIES_MAX,
    TITLE_MAX,
)


def _cut(value, max_length):
    return value.strip()[:max_length].strip() if isinstance(value, str) else value


def _fit_fields(items, limits, max_items):
    out = []
    for item in (items or [])[:max_items]:
        if isinstance(item, dict):
            item = dict(item)
            for key, max_length in limits.items():
                if key in item:
                    item[key] = _cut(item[key], max_length)
        out.append(item)
    return out


def _skill_names(values, max_items):
    names, seen = [], set()
    for value in values or []:
        name = value.strip() if isinstance(value, str) else ""
        if name and len(name) <= SKILL_MAX and name.lower() not in seen:
            seen.add(name.lower())
            names.append(name)
    return names[:max_items]


def fit_parsed_to_limits(skills, education, experience, projects):
    fitted_skills, seen = [], set()
    for skill in skills or []:
        name = skill.get("name", "").strip() if isinstance(skill, dict) and isinstance(skill.get("name"), str) else ""
        if name and len(name) <= SKILL_MAX and name.lower() not in seen:
            seen.add(name.lower())
            fitted_skills.append({**skill, "name": name})
    fitted_projects = _fit_fields(projects, {"name": TITLE_MAX, "description": DESCRIPTION_MAX}, MAX_PROJECTS)
    for project in fitted_projects:
        if isinstance(project, dict):
            project["technologies"] = _skill_names(project.get("technologies"), TECHNOLOGIES_MAX)
    return (
        fitted_skills[:SKILLS_TOTAL_MAX],
        _fit_fields(education, {"degree": TITLE_MAX, "institution": ORG_MAX, "year": 10}, MAX_EDUCATION),
        _fit_fields(experience, {"title": TITLE_MAX, "company": ORG_MAX, "duration": 100}, MAX_EXPERIENCE),
        fitted_projects,
    )
