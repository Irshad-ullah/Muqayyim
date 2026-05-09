"""
MongoDB Models and Schemas
"""

from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, Field
from bson import ObjectId


class PyObjectId(ObjectId):
    """Custom ObjectId type for Pydantic"""

    @classmethod
    def __get_validators__(cls):
        yield cls.validate

    @classmethod
    def validate(cls, v):
        if not ObjectId.is_valid(v):
            raise ValueError(f"Invalid ObjectId: {v}")
        return ObjectId(v)

    def __repr__(self):
        return f"ObjectId('{self}'"


class SkillItem(BaseModel):
    """Skill item model"""
    name: str
    confidence: float = 1.0


class EducationItem(BaseModel):
    """Education item model"""
    degree: str
    institution: str
    year: Optional[str] = None
    confidence: float = 1.0


class ExperienceItem(BaseModel):
    """Experience item model"""
    title: str
    company: str
    duration: Optional[str] = None
    confidence: float = 1.0


class ProjectItem(BaseModel):
    """Project item extracted from CV"""
    name: str
    description: Optional[str] = ""
    technologies: List[str] = []


class ParsedDataModel(BaseModel):
    """Parsed data from NLP extraction"""
    skills:     List[SkillItem]     = []
    education:  List[EducationItem] = []
    experience: List[ExperienceItem]= []
    projects:   List[ProjectItem]   = []


class CVParsedDataModel(BaseModel):
    """MongoDB CV Parsed Data Model"""

    id: Optional[PyObjectId] = Field(default=None, alias="_id")
    user_id:        str
    file_name:      str
    file_path:      Optional[str] = None
    upload_date:    datetime      = Field(default_factory=datetime.utcnow)
    parsed_data:    ParsedDataModel
    verified_data:  Optional[ParsedDataModel] = None
    parsing_status: str = "completed"

    class Config:
        populate_by_name = True
        json_encoders = {
            ObjectId: str,
            datetime: lambda v: v.isoformat(),
        }


class CVResponseModel(BaseModel):
    """Response model for CV data"""

    file_id:        str
    user_id:        str
    file_name:      str
    upload_date:    datetime
    parsed_data:    ParsedDataModel
    verified_data:  Optional[ParsedDataModel] = None
    parsing_status: str


COLLECTIONS = {
    "cv_parsed_data": "cv_parsed_data",
}
