# Backend API Documentation

## CV Parsing Module - FastAPI

## Quick Start

### Installation

```bash
# Create virtual environment
python -m venv venv
venv\bin\activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Download spaCy model
python -m spacy download en_core_web_sm
```

### Running the Server

```bash
# Development (with auto-reload)
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Production
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```

## API Reference

### Health Check

```
GET /health
```

Response: `{"status": "healthy", "service": "CV Parsing Module"}`

### Upload CV File

```
POST /api/cv/upload
Content-Type: multipart/form-data

Parameters:
- file: binary (PDF, DOC, DOCX - max 5MB)

Response:
{
  "file_id": "550e8400-e29b-41d4-a716-446655440000",
  "file_name": "resume.pdf",
  "size": 102400,
  "message": "File uploaded successfully"
}
```

### Parse CV

```
POST /api/cv/parse/{file_id}

Response:
{
  "file_id": "550e8400-e29b-41d4-a716-446655440000",
  "parsing_status": "completed",
  "parsed_data": {
    "skills": [
      {"name": "Python", "confidence": 0.95},
      {"name": "React", "confidence": 0.90},
      {"name": "Leadership", "confidence": 0.75}
    ],
    "education": [
      {
        "degree": "B.S. Computer Science",
        "institution": "MIT",
        "year": "2020",
        "confidence": 0.85
      }
    ],
    "experience": [
      {
        "title": "Senior Software Engineer",
        "company": "Google",
        "duration": "2020 - 2023",
        "confidence": 0.88
      }
    ]
  },
  "message": "CV parsed successfully"
}
```

### Verify and Save Data

```
PUT /api/cv/verify
Content-Type: application/json

Request Body:
{
  "file_id": "550e8400-e29b-41d4-a716-446655440000",
  "verified_data": {
    "skills": [
      {"name": "Python", "confidence": 1.0},
      {"name": "React", "confidence": 1.0},
      {"name": "Node.js", "confidence": 1.0}
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
        "duration": "2020 - 2023",
        "confidence": 1.0
      }
    ]
  }
}

Response:
{
  "file_id": "550e8400-e29b-41d4-a716-446655440000",
  "user_id": "user-123",
  "parsing_status": "verified",
  "message": "CV data verified and saved to profile"
}
```

### Get CV Summary

```
GET /api/cv/summary/{user_id}

Response:
{
  "user_id": "user-123",
  "file_name": "resume.pdf",
  "upload_date": "2024-01-15T10:30:00Z",
  "parsed_data": {...},
  "verified_data": {...},
  "parsing_status": "verified"
}
```

## Error Responses

### 400 Bad Request

```json
{
  "error": "Invalid file format",
  "message": "File type 'txt' not allowed. Allowed types: pdf, doc, docx",
  "status_code": 400
}
```

### 404 Not Found

```json
{
  "error": "File not found",
  "message": "The requested file does not exist",
  "status_code": 404
}
```

### 422 Unprocessable Entity

```json
{
  "error": "Processing failed",
  "message": "Failed to extract text from CV",
  "status_code": 422
}
```

### 500 Internal Server Error

```json
{
  "error": "Internal Server Error",
  "message": "An unexpected error occurred",
  "status_code": 500
}
```

## Environment Variables

```env
# Server Configuration
HOST=0.0.0.0
PORT=8000
DEBUG=False

# Database
MONGODB_URL=mongodb://localhost:27017
DATABASE_NAME=muqayyim

# File Upload
UPLOAD_DIRECTORY=./uploads
MAX_FILE_SIZE=5242880  # 5MB in bytes

# NLP
NLP_MODEL=en_core_web_sm

# Security
SECRET_KEY=your-secret-key-here
ALGORITHM=HS256

# CORS
CORS_ORIGINS=["http://localhost:3000","http://localhost:5173"]
```

## Project Structure

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI app entry point
│   ├── config/
│   │   ├── __init__.py
│   │   ├── database.py      # MongoDB async driver setup
│   │   └── settings.py      # Pydantic settings
│   ├── routes/
│   │   ├── __init__.py
│   │   └── cv_routes.py     # CV parsing endpoints
│   ├── services/
│   │   ├── __init__.py
│   │   ├── cv_parser.py     # Text extraction from files
│   │   └── nlp_extractor.py # NLP processing with spaCy
│   ├── models/
│   │   ├── __init__.py
│   │   └── cv_model.py      # MongoDB data models
│   ├── schemas/
│   │   ├── __init__.py
│   │   └── cv_schema.py     # Pydantic request/response schemas
│   └── utils/
│       ├── __init__.py
│       └── file_handler.py  # File upload utilities
├── requirements.txt
└── .env.example
```

## Development Tips

### Debugging

1. Enable debug mode in `.env`: `DEBUG=True`
2. Use FastAPI's built-in docs: `http://localhost:8000/docs`
3. Check logs for detailed error messages

### Testing with cURL

```bash
# Upload file
curl -X POST -F "file=@resume.pdf" http://localhost:8000/api/cv/upload

# Parse CV
curl -X POST http://localhost:8000/api/cv/parse/{file_id}

# Verify data
curl -X PUT -H "Content-Type: application/json" \
  -d @verified_data.json \
  http://localhost:8000/api/cv/verify
```

### Testing with Postman

1. Import the API endpoints
2. Set up environment variables for `file_id` and `user_id`
3. Execute requests in sequence

## Performance Optimization

### Caching

- Parsed CVs are cached in MongoDB
- Redis can be added for session caching

### Async Operations

- File uploads use async file I/O
- Database queries are asynchronous via Motor

### Rate Limiting (To be added)

```python
from slowapi import Limiter
limiter = Limiter(key_func=get_remote_address)
```

## Security Considerations

✅ File type validation
✅ File size limits (5MB)
✅ Input sanitization
✅ CORS configuration
✅ Trusted host middleware
✅ JWT token support (ready)

## Monitoring

### Health Check

```bash
curl http://localhost:8000/health
```

### Metrics (Future enhancement)

- File upload counts
- Parsing success rate
- Average processing time
- Error rates by type

## Deployment

### Docker

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0"]
```

### Docker Compose

```yaml
version: "3.8"
services:
  api:
    build: .
    ports:
      - "8000:8000"
  mongodb:
    image: mongo:latest
    ports:
      - "27017:27017"
```

## Troubleshooting

### ModuleNotFoundError

```bash
pip install -r requirements.txt
```

### spaCy model not found

```bash
python -m spacy download en_core_web_sm
```

### MongoDB connection refused

```bash
# Check if MongoDB is running
mongosh --version

# Start Docker MongoDB
docker run -d -p 27017:27017 mongo
```

### CORS errors

- Check `CORS_ORIGINS` in `.env`
- Ensure frontend URL is in the list

## API Documentation

Interactive docs available at:

- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`
- OpenAPI JSON: `http://localhost:8000/openapi.json`
