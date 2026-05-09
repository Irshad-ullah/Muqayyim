"""
CV Routes
API endpoints for CV uploading, parsing, and verification
"""

import logging
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from bson import ObjectId
from datetime import datetime

from app.schemas.cv_schema import (
    CVUploadResponseSchema,
    CVParseResponseSchema,
    CVVerifyRequestSchema,
    CVVerifyResponseSchema,
    CVSummaryResponseSchema,
    ErrorResponseSchema,
)
from app.models.cv_model import CVParsedDataModel, ParsedDataModel
from app.services.cv_parser import parse_cv_file
from app.services.nlp_extractor import get_nlp_extractor
from app.utils.file_handler import (
    validate_file,
    save_upload_file,
    generate_file_id,
    get_file_extension,
    delete_file,
    file_exists,
)
from app.config.database import get_database
from app.config.settings import settings
from app.middleware.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/cv", tags=["CV Parsing"])


@router.post("/upload", response_model=CVUploadResponseSchema)
async def upload_cv(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user)
):
    """
    FE-1: Upload CV file
    Accepts PDF, DOC, or DOCX files (max 5MB)
    
    Returns:
        - file_id: Unique identifier for the uploaded file
        - file_name: Original filename
        - size: File size in bytes
    """
    try:
        # Read file content
        contents = await file.read()
        file_size = len(contents)

        # Rewind for downstream save (UploadFile stream is consumed by read()).
        try:
            await file.seek(0)
        except Exception:
            pass
        
        # Validate file
        is_valid, error_msg = validate_file(file.filename, file_size)
        if not is_valid:
            logger.warning(f"File validation failed: {error_msg}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=error_msg
            )
        
        # Generate file ID
        file_id = generate_file_id()
        
        # Save file temporarily
        file_path = await save_upload_file(
            file,
            file_id,
            file.filename
        )
        
        logger.info(f"File uploaded successfully: {file_id} by user {current_user['user_id']}")
        
        return CVUploadResponseSchema(
            file_id=file_id,
            file_name=file.filename,
            size=file_size,
            message="File uploaded successfully"
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error uploading file: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to upload file"
        )


@router.post("/parse/{file_id}", response_model=CVParseResponseSchema)
async def parse_cv(
    file_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    FE-2: Parse CV using NLP
    Extracts skills, education, and experience from uploaded CV
    
    Returns:
        - file_id: File identifier
        - parsed_data: Extracted skills, education, and experience
        - parsing_status: Status of parsing
    """
    try:
        # Get file path from file_id
        upload_dir = settings.UPLOAD_DIRECTORY
        file_path = None
        
        # Try to find the file with different extensions
        for ext in settings.ALLOWED_EXTENSIONS:
            potential_path = f"{upload_dir}/{file_id}.{ext}"
            if file_exists(potential_path):
                file_path = potential_path
                break
        
        if not file_path:
            logger.warning(f"File not found: {file_id}")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="File not found"
            )
        
        # Extract file extension
        ext = get_file_extension(file_path)
        
        # Extract text from file
        cv_text, extraction_success = parse_cv_file(file_path, ext)
        
        if not extraction_success or not cv_text.strip():
            logger.warning(f"Failed to extract text from CV: {file_id}")
            error_detail = "Failed to extract text from CV. The file might be:"
            if ext == "doc":
                error_detail += " - An older MS Word format (pre-2007). Please convert to .docx or .pdf"
            else:
                error_detail += " - Image-based, corrupted, or empty"
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=error_detail
            )
        
        # Get NLP extractor and extract data
        extractor = get_nlp_extractor()
        
        skills = extractor.extract_skills(cv_text)
        education = extractor.extract_education(cv_text)
        experience = extractor.extract_experience(cv_text)
        projects = extractor.extract_projects(cv_text)

        # Normalize extracted items to satisfy schema requirements even when
        # spaCy NER is unavailable (e.g. company names may be missing).
        normalized_experience = []
        for exp in experience or []:
            exp = dict(exp or {})
            exp.setdefault("title", "Unknown Title")
            exp.setdefault("company", "Unknown Company")
            exp.setdefault("confidence", 0.6)
            normalized_experience.append(exp)
        experience = normalized_experience

        parsed_data = ParsedDataModel(
            skills=skills,
            education=education,
            experience=experience,
            projects=projects,
        )
        
        # Store in database
        db = get_database()
        cv_collection = db["cv_parsed_data"]
        
        cv_record = CVParsedDataModel(
            user_id=current_user["user_id"],
            file_name=f"{file_id}.{ext}",
            file_path=file_path,
            parsed_data=parsed_data,
            parsing_status="completed"
        )
        
        # Upsert: update existing record for user or insert new one
        result = await cv_collection.update_one(
            {"user_id": current_user["user_id"]},
            {"$set": cv_record.model_dump(by_alias=True, exclude_none=True)},
            upsert=True
        )
        
        logger.info(f"CV parsed successfully: {file_id}")
        
        return CVParseResponseSchema(
            file_id=file_id,
            parsed_data=parsed_data.model_dump(),
            parsing_status="completed",
            message="CV parsed successfully"
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error parsing CV: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to parse CV"
        )


@router.put("/verify", response_model=CVVerifyResponseSchema)
async def verify_cv_data(
    request: CVVerifyRequestSchema,
    current_user: dict = Depends(get_current_user)
):
    """
    FE-4 & FE-5: Verify and save user-edited CV data to profile
    
    Returns:
        - file_id: File identifier
        - user_id: User identifier
        - parsing_status: Updated to 'verified'
    """
    try:
        db = get_database()
        if db is None:
            logger.error("Database connection not initialized")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Database connection not available"
            )

        cv_collection = db["cv_parsed_data"]
        
        # Find the CV record by user and file name
        file_name_candidates = [f"{request.file_id}.{ext}" for ext in settings.ALLOWED_EXTENSIONS]

        update_result = await cv_collection.update_one(
            {
                "user_id": current_user["user_id"],
                "file_name": {"$in": file_name_candidates}
            },
            {
                "$set": {
                    "parsed_data": request.verified_data.dict(),
                    "parsing_status": "verified",
                },
                "$unset": {
                    "verified_data": ""
                }
            }
        )
        
        if update_result.matched_count == 0:
            logger.warning(f"CV record not found for user: {current_user['user_id']} and file_id: {request.file_id}")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="CV record not found"
            )

        # Clean up temporary file after successful verification
        upload_dir = settings.UPLOAD_DIRECTORY
        file_path = None
        for ext in settings.ALLOWED_EXTENSIONS:
            potential_path = f"{upload_dir}/{request.file_id}.{ext}"
            if file_exists(potential_path):
                file_path = potential_path
                break

        if file_path and file_exists(file_path):
            delete_file(file_path)
        
        logger.info(f"CV verified and saved: {request.file_id}")
        
        return CVVerifyResponseSchema(
            file_id=request.file_id,
            user_id=current_user["user_id"],
            parsing_status="verified",
            message="CV data verified and saved to profile"
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error verifying CV data: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to verify CV data"
        )


@router.get("/summary/{user_id}", response_model=CVSummaryResponseSchema)
async def get_cv_summary(
    user_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Get parsed CV summary for a user
    
    Returns:
        - user_id: User identifier
        - file_name: Original filename
        - upload_date: Upload timestamp
        - parsed_data: Extracted data
        - verified_data: User-verified data (if available)
        - parsing_status: Current status
    """
    try:
        # Check if user is requesting their own data
        if current_user["user_id"] != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only access your own CV data"
            )
        
        db = get_database()
        cv_collection = db["cv_parsed_data"]
        
        # Fetch the most recent CV record for the user
        cv_record = await cv_collection.find_one(
            {"user_id": user_id},
            sort=[("upload_date", -1)]
        )
        
        if not cv_record:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No CV data found for this user"
            )
        
        return CVSummaryResponseSchema(
            user_id=cv_record["user_id"],
            file_name=cv_record["file_name"],
            upload_date=cv_record["upload_date"],
            parsed_data=cv_record["parsed_data"],
            verified_data=cv_record.get("verified_data"),
            parsing_status=cv_record["parsing_status"]
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching CV summary: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch CV summary"
        )


# Error handler
@router.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "ok", "message": "CV Parsing API is running"}
