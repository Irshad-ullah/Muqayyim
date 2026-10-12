"""
Test fixture builders: real PDF/DOCX bytes generated in-process (no committed
binaries, no extra dependencies), plus a sample CV text.
"""

import io
from typing import List

from docx import Document

OLE2_HEADER = bytes.fromhex("D0CF11E0A1B11AE1")
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 200


def _pdf_string(text: str) -> bytes:
    raw = text.encode("cp1252", errors="replace")
    out = bytearray()
    for b in raw:
        if b in (0x28, 0x29, 0x5C):  # ( ) \
            out += b"\\" + bytes([b])
        elif b < 32 or b > 126:
            out += f"\\{b:03o}".encode()
        else:
            out.append(b)
    return bytes(out)


def make_pdf(lines: List[str]) -> bytes:
    """A valid one-page PDF with the given text lines (Helvetica, WinAnsi)."""
    stream = bytearray(b"BT /F1 9 Tf 11 TL 40 800 Td\n")
    for line in lines:
        stream += b"(" + _pdf_string(line) + b") Tj T*\n"
    stream += b"ET"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + bytes(stream) + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def make_image_only_pdf() -> bytes:
    """A PDF page with no text layer (what a scanned CV looks like to PyPDF2)."""
    return make_pdf([])


def make_encrypted_pdf(password: str = "secret") -> bytes:
    import PyPDF2

    reader = PyPDF2.PdfReader(io.BytesIO(make_pdf(SAMPLE_CV_LINES)))
    writer = PyPDF2.PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    writer.encrypt(user_password=password, owner_password=password, use_128bit=True)
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def make_docx(lines: List[str]) -> bytes:
    doc = Document()
    for line in lines:
        doc.add_paragraph(line)
    buffer = io.BytesIO()
    doc.save(buffer)
    return buffer.getvalue()


def make_fake_doc() -> bytes:
    """OLE2 container bytes with a WordDocument stream name (signature only)."""
    return OLE2_HEADER + b"\x00" * 504 + "WordDocument".encode("utf-16-le") + b"\x00" * 512


SAMPLE_CV_LINES = [
    "Ayesha Khan",
    "ayesha@example.com | +92 300 1234567",
    "Summary",
    "Full-stack developer with three years of experience building web applications.",
    "Experience",
    "Software Engineer at Systems Ltd, Lahore",
    "Jan 2022 – Present",
    "- Built REST APIs with Node.js and Express",
    "- Led migration from MySQL to PostgreSQL",
    "Junior Developer | Arbisoft | Mar'20 – Dec'21",
    "- Developed React dashboards",
    "Web Development Intern",
    "TechCorp",
    "- Fixed bugs in a Django app",
    "Education",
    "BS Computer Science, FAST NUCES, 2016 - 2020, CGPA 3.4/4.0",
    "FSc Pre-Engineering - Punjab College (2014 – 2016)",
    "Skills",
    "Python, JavaScript, React, Node.js, MongoDB, Docker, Git",
    "Projects",
    "Muqayyim | React, Node.js, MongoDB",
    "- AI career platform for university graduates with CV parsing and interview practice",
    "- github.com/ayesha-k/muqayyim",
    "Developed a complete e-commerce system with payment integration and admin dashboard features for small shops.",
    "Weather Now – real-time weather dashboard",
    "Live: https://weather-now.example.com",
    "Certifications",
    "AWS Certified Cloud Practitioner – Amazon Web Services (2023)",
    "Google Data Analytics Certificate | Coursera | 2022",
    "Meta Front-End Developer, Coursera, Jan 2023",
    "Azure AI Fundamentals",
    "Issued by Microsoft",
    "Machine Learning Specialization",
]
SAMPLE_CV_TEXT = "\n".join(SAMPLE_CV_LINES)
