"""
Pydantic Schemas for API Request/Response validation
"""

import re
from typing import Annotated, Optional, List
from datetime import datetime
from pydantic import BaseModel, BeforeValidator, Field, StringConstraints

from app.constants.cv_status import PARSED, VERIFIED
from app.constants.profile_limits import (
    PROFILE_LIMITS,
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

URL_MAX = PROFILE_LIMITS["urlMax"]
GPA_MAX = PROFILE_LIMITS["gpaMax"]
LOCATION_MAX = PROFILE_LIMITS["locationMax"]
MAX_CERTIFICATIONS = PROFILE_LIMITS["maxEntries"]["certifications"]


class SkillSchema(BaseModel):
    name:       str
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)


# Parse results: required fields may be empty and are then listed in
# needsReview (the user fills them in before verifying). Lengths are already
# fitted to the profile limits by app/utils/parsed_normaliser.py.
class EducationSchema(BaseModel):
    degree:      str           = ""
    institution: str           = ""
    field:       str           = ""
    startDate:   str           = ""
    endDate:     str           = ""
    gpa:         str           = ""
    year:        Optional[str] = None
    confidence:  float         = Field(default=1.0, ge=0.0, le=1.0)
    needsReview: List[str]     = []


class ExperienceSchema(BaseModel):
    title:       str           = ""
    company:     str           = ""
    location:    str           = ""
    startDate:   str           = ""
    endDate:     str           = ""
    current:     bool          = False
    description: str           = ""
    duration:    Optional[str] = None
    confidence:  float         = Field(default=1.0, ge=0.0, le=1.0)
    needsReview: List[str]     = []


class CertificationSchema(BaseModel):
    name:        str       = ""
    issuer:      str       = ""
    date:        str       = ""
    url:         str       = ""
    confidence:  float     = Field(default=1.0, ge=0.0, le=1.0)
    needsReview: List[str] = []


class ProjectSchema(BaseModel):
    """Project extracted from CV"""
    name:         str           = ""
    description:  Optional[str] = ""
    technologies: List[str]     = Field(default=[])
    githubUrl:    str           = ""
    liveUrl:      str           = ""
    needsReview:  List[str]     = []


class ParsedDataSchema(BaseModel):
    skills:         List[SkillSchema]         = []
    education:      List[EducationSchema]     = []
    experience:     List[ExperienceSchema]    = []
    certifications: List[CertificationSchema] = []
    projects:       List[ProjectSchema]       = []


class CVUploadResponseSchema(BaseModel):
    file_id:   str
    file_name: str
    size:      int
    message:   str = "File uploaded successfully"


class CVParseResponseSchema(BaseModel):
    file_id:        str
    parsing_status: str             = PARSED
    parsed_data:    ParsedDataSchema
    message:        str             = "CV parsed successfully"


# ── Verify request (user-edited data) ─────────────────────────────────────────
# Same limits as CoreServices' profile validation (app/constants/profile_limits.py).
# Strings are trimmed and control characters stripped before the length checks.
# Response schemas above stay unconstrained so parse results always serialise.
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _clean_line(value):
    if isinstance(value, str):
        value = _CONTROL_CHARS.sub("", value.replace("\r\n", "\n").replace("\r", "\n"))
        return re.sub(r"[\t\n]+", " ", value).strip()
    return value


def _clean_multiline(value):
    if isinstance(value, str):
        return _CONTROL_CHARS.sub("", value.replace("\r\n", "\n").replace("\r", "\n")).strip()
    return value


def _drop_empty(values):
    if isinstance(values, list):
        return [v for v in (_clean_line(x) for x in values) if not (isinstance(v, str) and not v)]
    return values


def _line(max_length: int, min_length: int = 0):
    return Annotated[str, StringConstraints(min_length=min_length, max_length=max_length), BeforeValidator(_clean_line)]


SkillName = _line(SKILL_MAX, 1)


Multiline = Annotated[str, StringConstraints(max_length=DESCRIPTION_MAX), BeforeValidator(_clean_multiline)]
DateText = Optional[_line(40)]
UrlText = Optional[_line(URL_MAX)]


class VerifiedSkillSchema(BaseModel):
    name:       SkillName
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)


class VerifiedEducationSchema(BaseModel):
    degree:      _line(TITLE_MAX, 1)
    institution: _line(ORG_MAX, 1)
    field:       Optional[_line(TITLE_MAX)] = ""
    startDate:   DateText = ""
    endDate:     DateText = ""
    gpa:         Optional[_line(GPA_MAX)] = ""
    year:        Optional[_line(10)] = None
    confidence:  float = Field(default=1.0, ge=0.0, le=1.0)


class VerifiedExperienceSchema(BaseModel):
    title:       _line(TITLE_MAX, 1)
    company:     _line(ORG_MAX, 1)
    location:    Optional[_line(LOCATION_MAX)] = ""
    startDate:   DateText = ""
    endDate:     DateText = ""
    current:     bool = False
    description: Optional[Multiline] = ""
    duration:    Optional[_line(100)] = None
    confidence:  float = Field(default=1.0, ge=0.0, le=1.0)


class VerifiedCertificationSchema(BaseModel):
    name:       _line(TITLE_MAX, 1)
    issuer:     _line(ORG_MAX, 1)
    date:       DateText = ""
    url:        UrlText = ""
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)


class VerifiedProjectSchema(BaseModel):
    name:         _line(TITLE_MAX, 1)
    description:  Optional[Multiline] = ""
    technologies: Annotated[List[SkillName], BeforeValidator(_drop_empty), Field(max_length=TECHNOLOGIES_MAX)] = []
    githubUrl:    UrlText = ""
    liveUrl:      UrlText = ""


class VerifiedDataSchema(BaseModel):
    skills:         List[VerifiedSkillSchema]         = Field(default=[], max_length=SKILLS_TOTAL_MAX)
    education:      List[VerifiedEducationSchema]     = Field(default=[], max_length=MAX_EDUCATION)
    experience:     List[VerifiedExperienceSchema]    = Field(default=[], max_length=MAX_EXPERIENCE)
    certifications: List[VerifiedCertificationSchema] = Field(default=[], max_length=MAX_CERTIFICATIONS)
    projects:       List[VerifiedProjectSchema]       = Field(default=[], max_length=MAX_PROJECTS)


class CVVerifyRequestSchema(BaseModel):
    file_id:       str = Field(..., pattern=r"^[A-Za-z0-9-]{1,64}$")
    verified_data: VerifiedDataSchema


class CVVerifyResponseSchema(BaseModel):
    file_id:        str
    user_id:        str
    parsing_status: str = VERIFIED
    message:        str = "CV data verified and saved"


class CVSummaryResponseSchema(BaseModel):
    user_id:        str
    file_name:      str
    upload_date:    datetime
    parsed_data:    ParsedDataSchema
    verified_data:  Optional[ParsedDataSchema] = None
    parsing_status: str


class ErrorResponseSchema(BaseModel):
    error:       str = Field(...)
    message:     str = Field(...)
    status_code: int = Field(...)
