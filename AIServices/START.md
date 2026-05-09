# 🚀 Quick Start Guide - CV Parsing Module

## Starting the Application (Next Time)

### Step 1: Start MongoDB (Terminal 1)
```powershell
docker run -d -p 27017:27017 --name mongo mongo:latest
# Or if container already exists:
docker start mongo
```

### Step 2: Start Backend (Terminal 2)
```powershell
cd "c:\Users\Crown Tech\OneDrive - Higher Education Commission\Fyp2.0\Module 2\backend"
.\venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
✅ Backend ready at: http://localhost:8000/docs

### Step 3: Start Frontend (Terminal 3)
```powershell
cd "c:\Users\Crown Tech\OneDrive - Higher Education Commission\Fyp2.0\Module 2\frontend"
npm run dev
```
✅ Frontend ready at: http://localhost:5173

### That's it! 🎉
Open browser to http://localhost:5173 and start uploading CVs

---

## 📊 Checking MongoDB Data

### Option 1: Using MongoDB Shell (Recommended)
```powershell
# Connect to MongoDB
docker exec -it mongo mongosh

# Once connected:
use muqayyim
db.cv_parsed_data.find().pretty()
```

### Option 2: Using Python Script
Create file `check_db.py` in the backend folder:
```python
import asyncio
from motor.motor_asyncio import AsyncMotorClient

async def check_database():
    client = AsyncMotorClient('mongodb://localhost:27017')
    db = client['muqayyim']
    cv_collection = db['cv_parsed_data']
    
    # Get all CVs
    count = await cv_collection.count_documents({})
    print(f"Total CVs stored: {count}\n")
    
    # Show all CVs
    async for cv in cv_collection.find():
        print(f"User: {cv.get('user_id')}")
        print(f"File: {cv.get('file_name')}")
        print(f"Status: {cv.get('parsing_status')}")
        print(f"Skills: {len(cv.get('parsed_data', {}).get('skills', []))}")
        print(f"Education: {len(cv.get('parsed_data', {}).get('education', []))}")
        print(f"Experience: {len(cv.get('parsed_data', {}).get('experience', []))}")
        print("-" * 50)

asyncio.run(check_database())
```

Then run:
```powershell
cd backend
.\venv\Scripts\Activate.ps1
python check_db.py
```

---

## 📁 Database Structure

**Database Name:** `muqayyim`
**Collection Name:** `cv_parsed_data`

Each CV record contains:
```json
{
  "_id": "ObjectId",
  "user_id": "user_123",
  "file_name": "resume.docx",
  "file_path": "./uploads/abc123.docx",
  "upload_date": "2026-05-06T12:34:56.789Z",
  "parsed_data": {
    "skills": [
      { "name": "Python", "confidence": 0.95 },
      { "name": "React", "confidence": 0.95 }
    ],
    "education": [
      { "degree": "Bachelor", "institution": "University", "year": "2020", "confidence": 0.85 }
    ],
    "experience": [
      { "title": "Developer", "company": "Tech Co", "duration": "2020-2023", "confidence": 0.8 }
    ]
  },
  "verified_data": {
    // User-edited data after review (if saved)
  },
  "parsing_status": "completed" // or "verified"
}
```

---

## 🔧 Common Commands

### Check if services are running
```powershell
# Check MongoDB
docker ps | findstr mongo

# Check if backend is up
Invoke-WebRequest http://localhost:8000/health

# Check if frontend is up
Invoke-WebRequest http://localhost:5173 -UseBasicParsing
```

### Stop services
```powershell
# Stop MongoDB container
docker stop mongo

# Kill frontend/backend terminals: Ctrl+C
```

### Clean up
```powershell
# Remove MongoDB container
docker rm mongo

# Remove uploaded files
cd backend
Remove-Item uploads\* -Force
```

---

## 📝 Notes

- **User ID**: Currently hardcoded as `"user_123"` (see `backend/app/routes/cv_routes.py` line 42)
- **Default auth**: Uses Bearer token (any value works for testing)
- **File uploads**: Stored in `backend/uploads/` directory
- **Auto-reload**: Backend reloads on code changes (Uvicorn watch mode)

