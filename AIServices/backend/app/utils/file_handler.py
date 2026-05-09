"""
File Handling Utilities
"""

import os
import shutil
from typing import Optional
from pathlib import Path
import uuid
from app.config.settings import settings


def generate_file_id() -> str:
    """Generate unique file ID"""
    return str(uuid.uuid4())


def get_file_extension(filename: str) -> str:
    """Get file extension"""
    return filename.rsplit(".", 1)[1].lower() if "." in filename else ""


def validate_file(filename: str, file_size: int) -> tuple[bool, Optional[str]]:
    """
    Validate uploaded file
    Returns: (is_valid, error_message)
    """
    # Check if file is empty
    if file_size == 0:
        return False, "File is empty. Please upload a valid CV file with content."
    
    # Check file extension
    ext = get_file_extension(filename)
    if ext not in settings.ALLOWED_EXTENSIONS:
        return False, f"File type '{ext}' not allowed. Allowed types: {', '.join(settings.ALLOWED_EXTENSIONS)}"
    
    # Check file size
    if file_size > settings.MAX_FILE_SIZE:
        max_size_mb = settings.MAX_FILE_SIZE / (1024 * 1024)
        current_size_mb = file_size / (1024 * 1024)
        return False, f"File size {current_size_mb:.2f}MB exceeds maximum {max_size_mb:.2f}MB"
    
    return True, None


async def save_upload_file(file, file_id: str, original_filename: str) -> str:
    """
    Save uploaded file to disk
    Returns: file_path
    """
    # Create file path
    ext = get_file_extension(original_filename)
    filename = f"{file_id}.{ext}"
    file_path = os.path.join(settings.UPLOAD_DIRECTORY, filename)
    
    # Save file
    os.makedirs(settings.UPLOAD_DIRECTORY, exist_ok=True)

    # The request handler may have already read the stream (e.g. to validate size),
    # so always rewind before persisting to disk.
    try:
        await file.seek(0)
    except Exception:
        # Fallback for file-like objects without async seek
        try:
            file.file.seek(0)
        except Exception:
            pass

    contents = await file.read()
    with open(file_path, "wb") as f:
        f.write(contents)
    
    return file_path


def delete_file(file_path: str) -> bool:
    """Delete file from disk"""
    try:
        if os.path.exists(file_path):
            os.remove(file_path)
            return True
        return False
    except Exception as e:
        print(f"Error deleting file {file_path}: {e}")
        return False


def get_file_size(file_path: str) -> int:
    """Get file size in bytes"""
    try:
        return os.path.getsize(file_path)
    except OSError:
        return 0


def file_exists(file_path: str) -> bool:
    """Check if file exists"""
    return os.path.exists(file_path)
