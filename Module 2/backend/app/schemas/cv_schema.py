"""
Pydantic Schemas for API Request/Response validation
"""

from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, Field


class SkillSchema(BaseModel):
    """Skill schema"""
    name: str = Field(..., min_length=1, max_length=100)
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)


class EducationSchema(BaseModel):
    """Education schema"""
    degree: str = Field(..., min_length=1, max_length=200)
    institution: str = Field(..., min_length=1, max_length=200)
    year: Optional[str] = Field(default=None, max_length=10)
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)


class ExperienceSchema(BaseModel):
    """Experience schema"""
    title: str = Field(..., min_length=1, max_length=200)
    company: str = Field(..., min_length=1, max_length=200)
    duration: Optional[str] = Field(default=None, max_length=100)
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)


class ParsedDataSchema(BaseModel):
    """Parsed CV data schema"""
    skills: List[SkillSchema] = []
    education: List[EducationSchema] = []
    experience: List[ExperienceSchema] = []


class CVUploadResponseSchema(BaseModel):
    """Response for CV upload"""
    file_id: str
    file_name: str
    size: int
    message: str = "File uploaded successfully"


class CVParseResponseSchema(BaseModel):
    """Response for CV parsing"""
    file_id: str
    parsing_status: str = "completed"
    parsed_data: ParsedDataSchema
    message: str = "CV parsed successfully"


class CVVerifyRequestSchema(BaseModel):
    """Request for CV verification"""
    file_id: str
    verified_data: ParsedDataSchema


class CVVerifyResponseSchema(BaseModel):
    """Response for CV verification"""
    file_id: str
    user_id: str
    parsing_status: str = "verified"
    message: str = "CV data verified and saved"


class CVSummaryResponseSchema(BaseModel):
    """Response for CV summary"""
    user_id: str
    file_name: str
    upload_date: datetime
    parsed_data: ParsedDataSchema
    verified_data: Optional[ParsedDataSchema] = None
    parsing_status: str


class ErrorResponseSchema(BaseModel):
    """Error response schema"""
    error: str = Field(...)
    message: str = Field(...)
    status_code: int = Field(...)
