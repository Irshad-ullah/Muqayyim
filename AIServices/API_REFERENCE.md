# API Quick Reference
## Module 2 Endpoints

## Base URL
```
http://localhost:8000
```

## Endpoints Summary

### 1️⃣ Upload CV
**POST** `/api/cv/upload`

Upload a CV file (PDF, DOC, DOCX - max 5MB)

**Request:**
```bash
curl -X POST \
  -H "Authorization: Bearer {token}" \
  -F "file=@resume.pdf" \
  http://localhost:8000/api/cv/upload
```

**Response:**
```json
{
  "file_id": "123e4567-e89b-12d3-a456-426614174000",
  "file_name": "resume.pdf",
  "size": 102400,
  "message": "File uploaded successfully"
}
```

---

### 2️⃣ Parse CV
**POST** `/api/cv/parse/{file_id}`

Trigger NLP parsing of uploaded CV

**Request:**
```bash
curl -X POST \
  -H "Authorization: Bearer {token}" \
  http://localhost:8000/api/cv/parse/123e4567-e89b-12d3-a456-426614174000
```

**Response:**
```json
{
  "file_id": "123e4567-e89b-12d3-a456-426614174000",
  "parsing_status": "completed",
  "parsed_data": {
    "skills": [
      {"name": "Python", "confidence": 0.95},
      {"name": "React", "confidence": 0.92},
      {"name": "Docker", "confidence": 0.88},
      {"name": "Leadership", "confidence": 0.75}
    ],
    "education": [
      {
        "degree": "B.S. Computer Science",
        "institution": "Massachusetts Institute of Technology",
        "year": "2020",
        "confidence": 0.9
      }
    ],
    "experience": [
      {
        "title": "Senior Software Engineer",
        "company": "Google",
        "duration": "2021 - 2024",
        "confidence": 0.92
      },
      {
        "title": "Software Engineer",
        "company": "Facebook",
        "duration": "2020 - 2021",
        "confidence": 0.88
      }
    ]
  },
  "message": "CV parsed successfully"
}
```

---

### 3️⃣ Verify & Save Data
**PUT** `/api/cv/verify`

Save user-reviewed and edited CV data

**Request:**
```bash
curl -X PUT \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d @verify_payload.json \
  http://localhost:8000/api/cv/verify
```

**Request Body:**
```json
{
  "file_id": "123e4567-e89b-12d3-a456-426614174000",
  "verified_data": {
    "skills": [
      {"name": "Python", "confidence": 1.0},
      {"name": "React", "confidence": 1.0},
      {"name": "Docker", "confidence": 1.0},
      {"name": "TypeScript", "confidence": 1.0},
      {"name": "Node.js", "confidence": 1.0},
      {"name": "Leadership", "confidence": 1.0}
    ],
    "education": [
      {
        "degree": "B.S. Computer Science",
        "institution": "MIT",
        "year": "2020",
        "confidence": 1.0
      }
    ],
    "experience": [
      {
        "title": "Senior Software Engineer",
        "company": "Google",
        "duration": "2021 - 2024",
        "confidence": 1.0
      },
      {
        "title": "Software Engineer",
        "company": "Facebook",
        "duration": "2020 - 2021",
        "confidence": 1.0
      }
    ]
  }
}
```

**Response:**
```json
{
  "file_id": "123e4567-e89b-12d3-a456-426614174000",
  "user_id": "user-123",
  "parsing_status": "verified",
  "message": "CV data verified and saved to profile"
}
```

---

### 4️⃣ Get CV Summary
**GET** `/api/cv/summary/{user_id}`

Retrieve user's parsed CV summary

**Request:**
```bash
curl -X GET \
  -H "Authorization: Bearer {token}" \
  http://localhost:8000/api/cv/summary/user-123
```

**Response:**
```json
{
  "user_id": "user-123",
  "file_name": "resume.pdf",
  "upload_date": "2024-01-15T10:30:00Z",
  "parsed_data": {
    "skills": [...],
    "education": [...],
    "experience": [...]
  },
  "verified_data": {
    "skills": [...],
    "education": [...],
    "experience": [...]
  },
  "parsing_status": "verified"
}
```

---

### 5️⃣ Health Check
**GET** `/health`

Check API status

**Response:**
```json
{
  "status": "healthy",
  "service": "CV Parsing Module",
  "version": "1.0.0"
}
```

---

## Status Codes

| Code | Status | Meaning |
|------|--------|---------|
| 200 | OK | Success |
| 400 | Bad Request | Invalid input (file format, size) |
| 404 | Not Found | Resource not found |
| 422 | Unprocessable Entity | Processing failed |
| 500 | Internal Error | Server error |

## Error Response Format

```json
{
  "error": "Invalid file format",
  "message": "File type 'txt' not allowed. Allowed types: pdf, doc, docx",
  "status_code": 400
}
```

## Common Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| `File type not allowed` | Unsupported format | Use PDF, DOC, or DOCX |
| `File size exceeds 5MB` | File too large | Compress or split file |
| `File not found` | File ID invalid | Check file_id |
| `Failed to extract text` | Image-based PDF | Use OCR (future feature) |
| `Failed to parse CV` | NLP error | Try another file |

## Authentication

All endpoints require JWT Bearer token:
```bash
Authorization: Bearer {jwt_token}
```

Mock token for testing:
```
Authorization: Bearer test-token
```

## Data Types

### Skill Object
```json
{
  "name": "Python",
  "confidence": 0.95
}
```

### Education Object
```json
{
  "degree": "B.S. Computer Science",
  "institution": "MIT",
  "year": "2020",
  "confidence": 0.9
}
```

### Experience Object
```json
{
  "title": "Senior Software Engineer",
  "company": "Google",
  "duration": "2021 - 2024",
  "confidence": 0.92
}
```

## Testing with Tools

### Postman
1. Import endpoints
2. Set `Authorization` header with token
3. Execute requests in sequence

### Thunder Client (VS Code)
1. Create requests in `.requests/` folder
2. Use variables for `{file_id}` and `{user_id}`

### cURL
```bash
# Save response to file
curl http://localhost:8000/api/cv/parse/id > response.json

# Pretty print JSON
curl http://localhost:8000/api/cv/parse/id | jq .

# Verbose mode (see headers)
curl -v http://localhost:8000/api/cv/parse/id
```

## Rate Limiting
(To be implemented)

Default: No limits currently

## CORS

Allowed origins (from `.env`):
- `http://localhost:3000`
- `http://localhost:5173`

Add more in `.env`: `CORS_ORIGINS=["http://example.com"]`

## WebSocket (Future)

Real-time parsing updates:
```javascript
ws = new WebSocket('ws://localhost:8000/ws/parse/{file_id}');
ws.onmessage = (e) => console.log(e.data);
```

---

**API Version**: 1.0.0
**Last Updated**: January 2024
**Status**: Stable
