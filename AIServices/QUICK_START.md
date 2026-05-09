# 🚀 How to Start & Monitor the CV Parsing Application

## Quick Start (Next Time)

### 1️⃣ Start MongoDB
```powershell
docker start mongo
# If not created yet:
docker run -d -p 27017:27017 --name mongo mongo:latest
```

### 2️⃣ Start Backend (New Terminal/Tab)
```powershell
cd "c:\Users\Crown Tech\OneDrive - Higher Education Commission\Fyp2.0\Module 2\backend"
.\venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
✅ **Backend is ready at:** http://localhost:8000/docs

### 3️⃣ Start Frontend (New Terminal/Tab)
```powershell
cd "c:\Users\Crown Tech\OneDrive - Higher Education Commission\Fyp2.0\Module 2\frontend"
npm run dev
```
✅ **Frontend is ready at:** http://localhost:5173

### Done! 🎉
- Open http://localhost:5173 in your browser
- Upload a CV (PDF, DOCX)
- Data is automatically saved to MongoDB!

---

## 📊 Check Your Data in MongoDB

### Method 1: Use the Python Script (Easiest)
```powershell
cd backend
.\venv\Scripts\Activate.ps1
python check_db.py
```

**Output Example:**
```
============================================================
📊 CV PARSING DATABASE - MUQAYYIM
============================================================
Total CVs stored: 8

CV #1
------------------------------------------------------------
User ID:        user_123
File Name:      a96c1e17-dce3-4f9b-aab2-20255c440e32.docx
Upload Date:    2026-05-06 05:13:30.327000
Status:         completed

📋 Parsed Data:
  Skills:       3 found
    • Postgresql (95% confidence)
    • Django (95% confidence)
    • Python (95% confidence)
  Education:    0 found
  Experience:   1 found
    • Smith Python Developer Skills Python at Unknown Company

⚠️  Verified Data: Not yet saved
```

---

### Method 2: Use MongoDB Shell
```powershell
# Connect to MongoDB inside Docker
docker exec -it mongo mongosh

# Once connected:
use muqayyim

# View all CVs
db.cv_parsed_data.find().pretty()

# Count total CVs
db.cv_parsed_data.countDocuments()

# Get most recent CV
db.cv_parsed_data.findOne({}, {sort: {upload_date: -1}})

# Get verified CVs only
db.cv_parsed_data.find({parsing_status: "verified"})

# Exit
exit
```

---

### Method 3: MongoDB Compass GUI (Optional)
Install from: https://www.mongodb.com/products/compass

1. Open MongoDB Compass
2. Connect to `mongodb://localhost:27017`
3. Database: `muqayyim`
4. Collection: `cv_parsed_data`

---

## 📁 What Gets Saved

Each CV record in MongoDB contains:

```javascript
{
  "_id": ObjectId,                    // Unique MongoDB ID
  "user_id": "user_123",              // User identifier
  "file_name": "resume.docx",         // Original filename
  "file_path": "./uploads/abc123.docx", // Temporary file location
  "upload_date": ISODate,             // When CV was uploaded
  
  "parsed_data": {                    // Auto-extracted by NLP
    "skills": [
      {
        "name": "Python",
        "confidence": 0.95              // 0-1 confidence score
      },
      // ... more skills
    ],
    "education": [
      {
        "degree": "Bachelor of Science",
        "institution": "University Name",
        "year": "2020",
        "confidence": 0.85
      }
    ],
    "experience": [
      {
        "title": "Senior Developer",
        "company": "Tech Company",
        "duration": "2020-2023",
        "confidence": 0.8
      }
    ]
  },
  
  "verified_data": { ... },           // User-edited data (if saved)
  "parsing_status": "completed"       // "completed" or "verified"
}
```

---

## 🔍 Database Location & Details

**MongoDB Connection:** `mongodb://localhost:27017`
**Database Name:** `muqayyim`
**Collection Name:** `cv_parsed_data`
**Storage:** Inside Docker container (persistent with named volume)

### View stored files:
```powershell
dir "c:\Users\Crown Tech\OneDrive - Higher Education Commission\Fyp2.0\Module 2\backend\uploads\"
```

---

## ⚙️ Troubleshooting

### MongoDB won't start
```powershell
# Check if container exists
docker ps -a | findstr mongo

# Remove old container if stuck
docker rm mongo

# Start fresh
docker run -d -p 27017:27017 --name mongo mongo:latest
```

### Backend won't start
```powershell
# Check if Python venv is activated
# (venv) should appear at start of line

# If not, activate it:
cd backend
.\venv\Scripts\Activate.ps1

# Reinstall dependencies if needed:
pip install -r requirements.txt
```

### Port already in use
```powershell
# If port 8000 is in use
netstat -ano | findstr :8000

# Kill process (replace PID)
taskkill /PID <PID> /F

# Or use different port:
uvicorn app.main:app --reload --host 0.0.0.0 --port 8001
```

---

## 📝 Important Notes

- **User ID**: Currently hardcoded as `user_123` (shared across all uploads)
- **Authentication**: Uses Bearer token (any value works for local testing)
- **File Uploads**: Stored in `backend/uploads/` - deleted after verification
- **Auto-reload**: Backend automatically restarts on code changes
- **Data Persistence**: MongoDB data persists even if you stop the container

---

## 🎯 Common Tasks

### Check if everything is running
```powershell
Invoke-WebRequest http://localhost:8000/health
Invoke-WebRequest http://localhost:5173 -UseBasicParsing
```

### Stop all services
```powershell
# Press Ctrl+C in backend and frontend terminals
# Stop MongoDB
docker stop mongo
```

### Clean up everything
```powershell
docker stop mongo
docker rm mongo
cd backend
Remove-Item uploads\* -Force
```

