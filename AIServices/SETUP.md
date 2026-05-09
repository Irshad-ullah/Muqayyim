# 🚀 Quick Setup Guide
## Module 2: CV Parsing - Get Running in 10 Minutes

## ⚡ Express Setup

### Backend (5 minutes)

```bash
# 1. Navigate to backend
cd backend

# 2. Create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt
python -m spacy download en_core_web_sm

# 4. Create .env from template
cp ../.env.example .env

# 5. Start MongoDB (in another terminal)
docker run -d -p 27017:27017 --name mongo mongo:latest

# 6. Run server
uvicorn app.main:app --reload
```

✅ API running at `http://localhost:8000`
📚 Docs at `http://localhost:8000/docs`

### Frontend (5 minutes)

```bash
# 1. Navigate to frontend
cd frontend

# 2. Install dependencies
npm install

# 3. Create .env
echo "VITE_API_URL=http://localhost:8000" > .env

# 4. Start dev server
npm run dev
```

✅ App running at `http://localhost:5173`

## 🧪 Test the System

### 1. Upload a CV
```bash
curl -X POST \
  -H "Authorization: Bearer test-token" \
  -F "file=@sample.pdf" \
  http://localhost:8000/api/cv/upload
```

Save the `file_id` from response.

### 2. Parse the CV
```bash
curl -X POST \
  -H "Authorization: Bearer test-token" \
  http://localhost:8000/api/cv/parse/{file_id}
```

### 3. Verify Data
```bash
curl -X PUT \
  -H "Authorization: Bearer test-token" \
  -H "Content-Type: application/json" \
  -d '{
    "file_id": "{file_id}",
    "verified_data": {
      "skills": [{"name": "Python", "confidence": 1.0}],
      "education": [],
      "experience": []
    }
  }' \
  http://localhost:8000/api/cv/verify
```

## 🛠️ Environment Setup

### Create `.env` in root:
```env
# Backend
MONGODB_URL=mongodb://localhost:27017
HOST=0.0.0.0
PORT=8000

# Frontend
VITE_API_URL=http://localhost:8000
```

## 📦 Required Software

| Tool | Version | Command |
|------|---------|---------|
| Python | 3.9+ | `python --version` |
| Node.js | 16+ | `node --version` |
| MongoDB | 4.4+ | `docker run mongo` |

## ✅ Verify Installation

### Backend
```bash
curl http://localhost:8000/health
# Expected: {"status":"healthy"}
```

### Frontend
Open `http://localhost:5173` in browser
Should see CV upload interface

## 🔧 Common Issues

| Issue | Solution |
|-------|----------|
| `ModuleNotFoundError` | `pip install -r requirements.txt` |
| `spaCy model not found` | `python -m spacy download en_core_web_sm` |
| `MongoDB connection refused` | `docker run -d -p 27017:27017 mongo` |
| `CORS errors` | Check `CORS_ORIGINS` in `.env` |
| `Port already in use` | Change `PORT=8001` in `.env` |

## 📱 API Endpoints Quick Reference

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/cv/upload` | Upload CV file |
| POST | `/api/cv/parse/{id}` | Parse CV using NLP |
| PUT | `/api/cv/verify` | Save verified data |
| GET | `/api/cv/summary/{id}` | Get CV summary |
| GET | `/health` | Health check |

## 🎯 Next Steps

1. ✅ Backend running - try `/docs` for interactive API
2. ✅ Frontend running - upload a sample CV
3. ✅ Full flow - upload → parse → review → save
4. 📚 Read main [README.md](./README.md) for detailed docs
5. 🚀 Deploy to production

## 🐳 Docker Compose (Optional)

One command setup:
```bash
docker-compose up
```

`docker-compose.yml`:
```yaml
version: '3.8'
services:
  backend:
    build: ./backend
    ports:
      - "8000:8000"
    environment:
      MONGODB_URL: mongodb://mongo:27017
  frontend:
    build: ./frontend
    ports:
      - "5173:5173"
    environment:
      VITE_API_URL: http://localhost:8000
  mongo:
    image: mongo:latest
    ports:
      - "27017:27017"
```

## 📞 Support

- API Docs: http://localhost:8000/docs
- Frontend: http://localhost:5173
- Check logs for errors: `console` (frontend) or `terminal` (backend)

---

✨ **You're all set!** Start with uploading a CV.
