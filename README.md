# Muqayyim — AI-Powered CV Intelligence Platform

A microservices-based platform that automates CV parsing, skill extraction, and professional profile management. Built as a Final Year Project using a React SPA, an Express API Gateway, a Node.js Core Service, and a Python AI Service.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    PRESENTATION LAYER                       │
│                                                             │
│              Unified React Frontend (SPA)                   │
│              React + Vite + Tailwind CSS                    │
│              http://localhost:5174                          │
│                                                             │
│   Routes: /login  /register  /dashboard  /cv-parsing       │
│           /profile-builder  /profile  /forgot-password      │
└──────────────────────────┬──────────────────────────────────┘
                           │  All API calls via Gateway
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                     API GATEWAY :8080                       │
│              Express + http-proxy-middleware                │
│                                                             │
│   /api/auth/*     ──────────▶  CoreServices  :3000         │
│   /api/profile/*  ──────────▶  CoreServices  :3000         │
│   /api/cv/*       ──────────▶  AIServices    :8000         │
└──────────────┬──────────────────────────────┬──────────────┘
               │                              │
               ▼                              ▼
┌──────────────────────────┐   ┌─────────────────────────────┐
│   CoreServices           │   │   AIServices                │
│   Node.js + Express      │   │   FastAPI + Python          │
│   http://localhost:3000  │   │   http://localhost:8000     │
│                          │   │                             │
│   • Register / Login     │   │   • Upload CV (PDF/DOCX)    │
│   • JWT issuance         │   │   • NLP skill extraction    │
│   • User profile CRUD    │   │   • Education / experience  │
│   • Password reset       │   │   • Verify & save data      │
│   • CV status tracking   │   │                             │
│   • Profile Builder      │   │                             │
│   • GitHub integration   │   │                             │
└──────────────┬───────────┘   └──────────────┬──────────────┘
               │                              │
               └──────────────┬───────────────┘
                              ▼
               ┌──────────────────────────┐
               │   MongoDB                │
               │   Database: muqayyim     │
               │                          │
               │   Collections:           │
               │   • users                │
               │   • profiles             │
               │   • cv_parsed_data       │
               └──────────────────────────┘
```

> **JWT flow:** CoreServices issues a JWT containing `userId` and `role`. Every request to AIServices carries that token in `Authorization: Bearer`. The gateway proxies it unchanged. AIServices decodes the JWT to get `user_id` — it never accepts `user_id` from the request body.

---

## Repository Structure

```
Muqayyim/
├── README.md
├── API Gateway/                       ← Express proxy (port 8080)
│   ├── server.js
│   └── package.json
├── CoreServices/                      ← Module 1: Auth + Profile + GitHub
│   ├── server.js
│   ├── package.json
│   ├── backend/
│   │   ├── config/db.js
│   │   ├── controllers/authController.js
│   │   ├── middleware/auth.js
│   │   ├── models/User.js
│   │   ├── routes/authRoutes.js
│   │   └── utils/emailService.js
│   └── frontend/                      ← Unified React SPA (port 5174)
│       └── src/
│           ├── pages/
│           ├── components/
│           ├── services/
│           └── context/
└── AIServices/                        ← Module 2: CV Parsing
    ├── backend/
    │   ├── app/
    │   │   ├── main.py
    │   │   ├── config/
    │   │   ├── models/
    │   │   ├── routes/
    │   │   ├── schemas/
    │   │   ├── services/
    │   │   └── utils/
    │   └── requirements.txt
    └── frontend/
        └── src/
```

---

## Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| Node.js | 18+ | `node -v` |
| Python | 3.9+ | `python --version` |
| MongoDB | 6+ | `mongod --version` |

---

## One-Time Setup

### 1. Start MongoDB

```powershell
# Windows — if installed as a service
net start MongoDB

# Windows — manual
mongod --dbpath "C:\data\db"
```

```bash
# macOS
brew services start mongodb-community

# Linux
sudo systemctl start mongod
```

### 2. Configure environment variables

Copy each `.env.example` to `.env` and fill in the required values.

**`CoreServices/.env`**
```env
MONGODB_URI=mongodb://localhost:27017/muqayyim
JWT_SECRET=pick-a-long-random-string    # must match AIServices
EMAIL_USER=your-gmail@gmail.com
EMAIL_PASSWORD=your-16-char-app-password
# GITHUB_TOKEN=ghp_...  (optional — raises rate limit to 5000 req/hour)
```

**`AIServices/backend/.env`**
```env
HOST=0.0.0.0
PORT=8000
DEBUG=False
MONGODB_URL=mongodb://localhost:27017
DATABASE_NAME=muqayyim
SECRET_KEY=same-string-you-used-in-coreservices
CORS_ORIGINS=["http://localhost:5173","http://localhost:8080"]
```

**`API Gateway/.env`**
```env
PORT=8080
AUTH_SERVICE_URL=http://localhost:3000
CV_SERVICE_URL=http://localhost:8000
MODULE1_FRONTEND_URL=http://localhost:5174
MODULE2_FRONTEND_URL=http://localhost:5173
```

> **Gmail App Password:** Google Account → Security → 2-Step Verification → App Passwords.

### 3. Install Python dependencies

```powershell
cd AIServices\backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python -m spacy download en_core_web_sm
```

---

## Running the Project

Four terminals are needed.

**Terminal 1 — CoreServices backend**
```powershell
cd CoreServices
npm install
npm run dev
# ✅ MongoDB connected  •  🚀 running on port 3000
```

**Terminal 2 — AIServices backend**
```powershell
cd AIServices\backend
venv\Scripts\activate
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
# INFO: Uvicorn running on http://0.0.0.0:8000
```

**Terminal 3 — API Gateway**
```powershell
cd "API Gateway"
npm install
npm start
# 🌐  MUQAYYIM API Gateway  →  http://localhost:8080
```

**Terminal 4 — Unified Frontend**
```powershell
cd CoreServices\frontend
npm install
npm run dev
# ➜  Local: http://localhost:5174/
```

Open **http://localhost:5174** in your browser.

---

## Port Reference

| Service | URL |
|---------|-----|
| Unified Frontend | http://localhost:5174 |
| API Gateway | http://localhost:8080 |
| CoreServices API | http://localhost:3000 |
| AIServices API | http://localhost:8000 |
| AIServices API Docs | http://localhost:8000/docs |

---

## API Reference (via Gateway at :8080)

### Authentication — `/api/auth`

| Method | Path | Auth | Description |
|--------|------|:----:|-------------|
| POST | `/api/auth/register` | | Create account |
| POST | `/api/auth/login` | | Get JWT token |
| POST | `/api/auth/forgot-password` | | Send reset email |
| POST | `/api/auth/reset-password/:token` | | Set new password |
| GET | `/api/auth/profile` | ✓ | Get user account info |
| PUT | `/api/auth/profile` | ✓ | Update name / email |
| GET | `/api/auth/cv-status` | ✓ | Get CV processing status |
| PATCH | `/api/auth/cv-status` | ✓ | Update CV status |

### Profile Builder — `/api/profile`

| Method | Path | Auth | Description |
|--------|------|:----:|-------------|
| GET | `/api/profile` | ✓ | Get full profile |
| PUT | `/api/profile` | ✓ | Create or update profile |
| POST | `/api/profile/github` | ✓ | Fetch GitHub repos & extract skills |

### CV Parsing — `/api/cv`

| Method | Path | Auth | Description |
|--------|------|:----:|-------------|
| POST | `/api/cv/upload` | ✓ | Upload CV file (PDF/DOC/DOCX) |
| POST | `/api/cv/parse/:file_id` | ✓ | Run NLP extraction |
| PUT | `/api/cv/verify` | ✓ | Save verified CV data |
| GET | `/api/cv/summary/:user_id` | ✓ | Fetch CV summary |

Auth = `Authorization: Bearer <JWT>` header required.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `401 Unauthorized` on CV upload | Make sure you are logged in through the app |
| `"Core Service is unavailable"` | CoreServices backend is not running — start Terminal 1 |
| `"CV Service is unavailable"` | AIServices backend is not running or venv not activated |
| MongoDB connection error | MongoDB is not running — start it before any backend |
| spaCy model not found | `python -m spacy download en_core_web_sm` inside activated venv |
| GitHub fetch returns 403 | Add `GITHUB_TOKEN` to `CoreServices/.env` |
| Port already in use | `netstat -ano \| findstr :<port>` then `taskkill /PID <pid> /F` |
