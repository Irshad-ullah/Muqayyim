# ⚡ Quick Reference Card

## 🚀 Startup Commands (Copy-Paste Ready)

### Terminal 1 - MongoDB
```powershell
docker start mongo
```

### Terminal 2 - Backend
```powershell
cd "c:\Users\Crown Tech\OneDrive - Higher Education Commission\Fyp2.0\Module 2\backend"
.\venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Terminal 3 - Frontend
```powershell
cd "c:\Users\Crown Tech\OneDrive - Higher Education Commission\Fyp2.0\Module 2\frontend"
npm run dev
```

---

## 🌐 URLs

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:8000 |
| API Docs | http://localhost:8000/docs |
| Health Check | http://localhost:8000/health |

---

## 📊 Check Database

```powershell
cd backend
.\venv\Scripts\Activate.ps1
python check_db.py
```

Shows all stored CVs with:
- User ID
- File name
- Upload date
- Parsed skills, education, experience
- Verification status

---

## 🗄️ MongoDB Info

| Property | Value |
|----------|-------|
| Connection | mongodb://localhost:27017 |
| Database | muqayyim |
| Collection | cv_parsed_data |
| Docker Port | 27017 |

### Manual MongoDB Query
```powershell
docker exec -it mongo mongosh
use muqayyim
db.cv_parsed_data.find().pretty()
exit
```

---

## 📂 File Locations

| Item | Path |
|------|------|
| Frontend | `.../Module 2/frontend/` |
| Backend | `.../Module 2/backend/` |
| DB Script | `.../backend/check_db.py` |
| Uploads | `.../backend/uploads/` |

---

## 🛑 Stop Services

```powershell
# In each terminal: Ctrl+C
# Then stop MongoDB:
docker stop mongo
```

---

## 🔄 Full Reset

```powershell
# Stop everything
docker stop mongo
cd backend
Remove-Item uploads\* -Force

# Start fresh
docker start mongo
# (then start backend and frontend again)
```

---

## 💡 Tips

✅ Keep MongoDB running while developing
✅ Backend auto-reloads on code changes
✅ Frontend auto-reloads on code changes
✅ Use `check_db.py` to verify data saved
✅ All data is stored in MongoDB (Docker persistent storage)
✅ Uploaded CV files are temporary (deleted after verification)

---

## 📖 Full Documentation

- See `QUICK_START.md` for detailed instructions
- See `START.md` for initial setup
- See `SETUP.md` for complete installation guide
