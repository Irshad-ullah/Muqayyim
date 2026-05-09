"""
Pydantic Schemas for API Request/Response validation
"""

from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, Field


class SkillSchema(BaseModel):
    name:       str   = Field(..., min_length=1, max_length=100)
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)


class EducationSchema(BaseModel):
    degree:      str           = Field(..., min_length=1, max_length=200)
    institution: str           = Field(..., min_length=1, max_length=200)
    year:        Optional[str] = Field(default=None, max_length=10)
    confidence:  float         = Field(default=1.0, ge=0.0, le=1.0)


class ExperienceSchema(BaseModel):
    title:      str           = Field(..., min_length=1, max_length=200)
    company:    str           = Field(..., min_length=1, max_length=200)
    duration:   Optional[str] = Field(default=None, max_length=100)
    confidence: float         = Field(default=1.0, ge=0.0, le=1.0)


class ProjectSchema(BaseModel):
    """Project extracted from CV"""
    name:         str           = Field(..., min_length=1, max_length=200)
    description:  Optional[str] = Field(default="", max_length=1000)
    technologies: List[str]     = Field(default=[])


class ParsedDataSchema(BaseModel):
    skills:     List[SkillSchema]     = []
    education:  List[EducationSchema] = []
    experience: List[ExperienceSchema]= []
    projects:   List[ProjectSchema]   = []


class CVUploadResponseSchema(BaseModel):
    file_id:   str
    file_name: str
    size:      int
    message:   str = "File uploaded successfully"


class CVParseResponseSchema(BaseModel):
    file_id:        str
    parsing_status: str             = "completed"
    parsed_data:    ParsedDataSchema
    message:        str             = "CV parsed successfully"


class CVVerifyRequestSchema(BaseModel):
    file_id:       str
    verified_data: ParsedDataSchema


class CVVerifyResponseSchema(BaseModel):
    file_id:        str
    user_id:        str
    parsing_status: str = "verified"
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
