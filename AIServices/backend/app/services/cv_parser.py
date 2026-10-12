"""
CV Parsing Service
Handles CV text extraction and processing
"""

import logging
import re
from typing import Dict, Optional, Tuple
import PyPDF2
from docx import Document

from app.services.cv_errors import doc_unsupported, encrypted_file, no_text_found
from app.services.doc_converter import DocConversionError, converted_docx

logger = logging.getLogger(__name__)

# Fewer non-whitespace characters than this = no usable text (scanned or
# image-only document). OCR is out of scope (SRS LI-1).
MIN_TEXT_CHARS = 100


def count_text_chars(text: str) -> int:
    return len(re.sub(r"\s+", "", text or ""))


class CVParser:
    """
    CV Parser Service
    Extracts text from PDF, DOC, and DOCX files
    """
    
    @staticmethod
    def extract_text_from_pdf(file_path: str) -> Tuple[str, bool]:
        """
        Extract text from PDF file
        Returns: (text, success)
        """
        try:
            text = []
            with open(file_path, 'rb') as file:
                pdf_reader = PyPDF2.PdfReader(file)
                if pdf_reader.is_encrypted:
                    try:
                        opened = pdf_reader.decrypt("")
                    except Exception:
                        opened = False
                    if not opened:
                        raise encrypted_file(422)
                
                # Check if PDF is image-based (no extractable text)
                if len(pdf_reader.pages) == 0:
                    return "", False
                
                for page_num, page in enumerate(pdf_reader.pages):
                    try:
                        page_text = page.extract_text()
                        if page_text:
                            text.append(page_text)
                    except Exception as e:
                        logger.warning(f"Error extracting text from PDF page {page_num}: {e}")
                        continue
            
            extracted_text = "\n".join(text)
            
            # Check if text was successfully extracted
            if not extracted_text or len(extracted_text.strip()) < 10:
                logger.warning("PDF appears to be image-based or empty")
                return extracted_text, len(extracted_text.strip()) > 10
            
            return extracted_text, True
        
        except Exception as e:
            if getattr(e, "code", None) == "ENCRYPTED_FILE":
                raise
            logger.error(f"Error extracting text from PDF: {e}")
            return "", False
    
    @staticmethod
    def extract_text_from_docx(file_path: str) -> Tuple[str, bool]:
        """
        Extract text from DOCX file
        Returns: (text, success)
        """
        try:
            doc = Document(file_path)
            paragraphs = [para.text for para in doc.paragraphs if para.text.strip()]
            
            # Extract text from tables
            for table in doc.tables:
                for row in table.rows:
                    for cell in row.cells:
                        if cell.text.strip():
                            paragraphs.append(cell.text)
            
            extracted_text = "\n".join(paragraphs)
            
            if not extracted_text or len(extracted_text.strip()) < 10:
                logger.warning("DOCX file is empty or has insufficient content")
                return extracted_text, len(extracted_text.strip()) > 10
            
            return extracted_text, True
        
        except Exception as e:
            logger.error(f"Error extracting text from DOCX: {e}")
            return "", False
    
    @staticmethod
    def extract_text_from_doc(file_path: str) -> Tuple[str, bool]:
        """
        Extract text from a legacy Word .doc: convert to .docx with LibreOffice
        headless (app/services/doc_converter.py), then use the DOCX path.
        Raises CVProcessingError(DOC_UNSUPPORTED) when that is not possible.
        """
        try:
            with converted_docx(file_path) as docx_path:
                return CVParser.extract_text_from_docx(docx_path)
        except DocConversionError as exc:
            error = doc_unsupported(exc.reason)
            error.libreoffice_missing = exc.missing
            raise error from exc
    
    @staticmethod
    def extract_text(file_path: str, file_extension: str) -> Tuple[str, bool]:
        """
        Extract text from file based on extension
        Returns: (text, success)
        """
        file_extension = file_extension.lower()
        
        if file_extension == "pdf":
            return CVParser.extract_text_from_pdf(file_path)
        elif file_extension == "docx":
            return CVParser.extract_text_from_docx(file_path)
        elif file_extension == "doc":
            return CVParser.extract_text_from_doc(file_path)
        else:
            logger.error(f"Unsupported file format: {file_extension}")
            return "", False
    
    @staticmethod
    def clean_text(text: str) -> str:
        """
        Clean extracted text while preserving line structure.

        IMPORTANT: do NOT collapse the whole text with ' '.join(text.split()).
        That destroys every newline, which makes _split_sections unable to find
        any section heading (it relies on ^ anchors with re.MULTILINE).
        Clean each line individually instead.
        """
        import re

        # Normalise Windows / old-Mac line endings first
        text = text.replace("\r\n", "\n").replace("\r", "\n")

        # Replace literal escape sequences that sometimes survive PDF extraction
        text = text.replace("\\n", "\n")
        text = text.replace("\\t", "\t")

        # Normalise bullet characters so the NLP layer sees plain hyphens
        for bullet in ("•", "●", "◦", "▪", "▸", "→", "✓", "✔"):
            text = text.replace(bullet, "-")

        # Clean each line independently: collapse intra-line whitespace only
        cleaned_lines = [" ".join(line.split()) for line in text.split("\n")]
        text = "\n".join(cleaned_lines)

        # Collapse runs of 3+ blank lines to a single blank line
        text = re.sub(r"\n{3,}", "\n\n", text)

        return text.strip()


# Helper function for quick parsing
def parse_cv_file(file_path: str, file_extension: str) -> Tuple[str, bool]:
    """
    Extract and clean the CV text. Returns (text, True) or raises
    CVProcessingError: ENCRYPTED_FILE, DOC_UNSUPPORTED, or NO_TEXT_FOUND when
    fewer than MIN_TEXT_CHARS non-whitespace characters could be read.
    """
    text, success = CVParser.extract_text(file_path, file_extension)
    text = CVParser.clean_text(text) if text else ""
    chars = count_text_chars(text)
    if not success or chars < MIN_TEXT_CHARS:
        raise no_text_found(f"{chars} characters of text extracted from .{file_extension}")
    return text, True
