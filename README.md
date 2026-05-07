# MUQAYYIM — AI-Powered CV Intelligence Platform

A microservices-based Final Year Project that automates CV parsing, skill extraction, and user profile management using NLP and a secure API Gateway.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLIENT LAYER                               │
│                                                                     │
│   Module 1 Frontend          Module 2 Frontend                      │
│   React + Tailwind            React + Tailwind                      │
│   http://localhost:5174       http://localhost:5173                 │
└──────────────────┬───────────────────────┬──────────────────────────┘
                   │                       │
                   └──────────┬────────────┘
                              │  All API traffic
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        API GATEWAY                                  │
│                     Express (http-proxy-middleware)                 │
│                       http://localhost:8080                         │
│                                                                     │
│    /api/auth/*  ──────────────────────────▶  Module 1 Backend      │
│    /api/cv/*    ──────────────────────────▶  Module 2 Backend      │
└──────────────────────────────────────────────────────────────────────┘
                   │                                    │
                   ▼                                    ▼
┌──────────────────────────┐          ┌─────────────────────────────┐
│   MODULE 1               │          │   MODULE 2                  │
│   User Management        │          │   CV Parsing Service        │
│   Node.js + Express      │          │   FastAPI + Python          │
│   http://localhost:3000  │          │   http://localhost:8000     │
│                          │          │                             │
│   • Register / Login     │          │   • Upload CV (PDF/DOCX)   │
│   • JWT issuance         │          │   • NLP skill extraction   │
│   • Profile management   │          │   • Education / experience │
│   • Password reset       │          │   • Verify & save data     │
│   • CV status tracking   │          │                             │
└──────────────┬───────────┘          └──────────────┬──────────────┘
               │                                     │
               └─────────────────┬───────────────────┘
                                 ▼
                    ┌────────────────────────┐
                    │   MongoDB              │
                    │   Database: muqayyim   │
                    │                        │
                    │   collections:         │
                    │   • users              │
                    │   • cv_parsed_data     │
                    └────────────────────────┘
```

**Identity flow:** Module 1 issues a JWT containing `userId` and `role`. Every request to Module 2 carries that JWT in the `Authorization: Bearer` header. The API Gateway proxies it through. Module 2 decodes the JWT to get `user_id` — it never accepts `user_id` from the request body.

---

## Repository Structure

```
Module 1,2/
│
├── README.md                        ← You are here
│
├── API Gateway/                     ← Express proxy (port 8080)
│   ├── server.js
│   ├── package.json
│   └── .env
│
├── Module 1/                        ← User Management Service
│   ├── README.md                    ← Backend-specific docs
│   ├── server.js
│   ├── package.json
│   ├── .env
│   ├── backend/
│   │   ├── config/db.js
│   │   ├── controllers/authController.js
│   │   ├── middleware/auth.js
│   │   ├── models/User.js
│   │   ├── routes/authRoutes.js
│   │   └── utils/emailService.js
│   └── frontend/                    ← React auth frontend (port 5174)
│       ├── README.md                ← Frontend-specific docs
│       ├── src/
│       │   ├── pages/               (Login, Register, Dashboard, Profile, ...)
│       │   ├── components/          (Navbar, CVStatusBadge, ...)
│       │   ├── context/AuthContext.jsx
│       │   └── services/authService.js
│       └── .env
│
└── Module 2/                        ← CV Parsing Service
    ├── backend/                     ← FastAPI service (port 8000)
    │   ├── app/
    │   │   ├── main.py
    │   │   ├── routes/cv_routes.py
    │   │   ├── middleware/auth.py   ← JWT verification
    │   │   ├── services/            (cv_parser, nlp_extractor)
    │   │   ├── models/
    │   │   ├── schemas/
    │   │   └── config/
    │   ├── requirements.txt
    │   └── .env
    └── frontend/                    ← React CV frontend (port 5173)
        ├── src/
        │   ├── pages/CVParsingPage.jsx
        │   ├── components/          (CVUpload, ParsedSummary, ...)
        │   └── services/cvService.js
        └── .env
```

---

## Prerequisites

Install these before anything else.

| Tool | Version | Download |
|---|---|---|
| Node.js | 18 or higher | https://nodejs.org |
| Python | 3.9 or higher | https://python.org |
| MongoDB | 6 or higher | https://www.mongodb.com/try/download/community |
| Git | any | https://git-scm.com |

Verify your installs:

```bash
node -v        # should print v18.x.x or higher
npm -v         # should print 9.x.x or higher
python --version   # should print 3.9.x or higher
pip --version
mongod --version
```

---

## One-Time Setup

### 1. Start MongoDB

MongoDB must be running before you start any service.

**Windows (if installed as a Windows Service):**
```powershell
net start MongoDB
```

**Windows (manual):**
```powershell
mongod --dbpath "C:\data\db"
```

**macOS / Linux:**
```bash
brew services start mongodb-community   # macOS with Homebrew
sudo systemctl start mongod             # Linux
```

---

### 2. Configure environment variables

Each service has its own `.env` file. The files already exist with sensible defaults. The only values you **must** change before running are the JWT secret (must match between Module 1 and Module 2) and the email credentials (for password reset).

**`Module 1/.env`** — open and edit:
```env
JWT_SECRET=pick-a-long-random-string-and-use-the-same-value-in-module-2
EMAIL_USER=your-gmail@gmail.com
EMAIL_PASSWORD=your-16-char-gmail-app-password
```

**`Module 2/backend/.env`** — open and edit:
```env
JWT_SECRET=same-string-you-used-in-module-1
```

> All other values (ports, MongoDB URL, database name) are pre-configured and do not need to change for local development.

**How to generate a Gmail App Password:**
1. Go to [myaccount.google.com](https://myaccount.google.com) → Security
2. Enable 2-Step Verification if not already on
3. Search for "App Passwords" → create one for "Mail"
4. Paste the 16-character password into `EMAIL_PASSWORD`

---

### 3. Install Python dependencies for Module 2

```bash
cd "Module 2/backend"
python -m venv venv

# Windows
venv\Scripts\activate

# macOS / Linux
source venv/bin/activate

pip install -r requirements.txt
python -m spacy download en_core_web_sm
```

---

## Running the Project

You need **5 terminals** running simultaneously. Open them all, then start each service in the order shown below.

---

### Terminal 1 — Module 1 Backend (Auth Service)

```bash
cd "Module 1"
npm install
npm run dev
```

Expected output:
```
✅ MongoDB connected successfully
🚀 Auth Service running on port 3000
```

---

### Terminal 2 — Module 2 Backend (CV Parsing Service)

```bash
cd "Module 2/backend"

# Activate virtual environment (Windows)
venv\Scripts\activate

# macOS / Linux
# source venv/bin/activate

uvicorn app.main:app --reload --port 8000
```

Expected output:
```
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000
```

---

### Terminal 3 — API Gateway

```bash
cd "API Gateway"
npm install
npm run dev
```

Expected output:
```
🌐  MUQAYYIM API Gateway
    Listening on   → http://localhost:8080
    /api/auth/*    → http://localhost:3000  (Module 1)
    /api/cv/*      → http://localhost:8000  (Module 2)
```

---

### Terminal 4 — Module 1 Frontend

```bash
cd "Module 1/frontend"
npm install
npm run dev
```

Expected output:
```
  VITE v5.x.x  ready in xxx ms
  ➜  Local:   http://localhost:5174/
```

---

### Terminal 5 — Module 2 Frontend

```bash
cd "Module 2/frontend"
npm install
npm run dev
```

Expected output:
```
  VITE v5.x.x  ready in xxx ms
  ➜  Local:   http://localhost:5173/
```

---

## Using the Application

Once all five services are running:

1. Open **http://localhost:5174** in your browser
2. Click **Create one** to register a new account
3. After logging in you will see the **Dashboard**
4. Click **Upload CV** — this opens the CV Parsing module at port 5173 with your session automatically transferred
5. Upload a PDF, DOC, or DOCX file (max 5 MB)
6. The AI extracts your skills, education, and experience
7. Review and confirm the extracted data
8. Return to the Dashboard — your CV Status updates to **Verified**

---

## Port Reference

| Service | URL | Notes |
|---|---|---|
| API Gateway | http://localhost:8080 | Single entry point for all API calls |
| Module 1 Backend | http://localhost:3000 | Never called directly by the frontend |
| Module 2 Backend | http://localhost:8000 | Never called directly by the frontend |
| Module 1 Frontend | http://localhost:5174 | Login, Register, Dashboard, Profile |
| Module 2 Frontend | http://localhost:5173 | CV Upload and Parsing |

---

## API Endpoints (via Gateway)

All requests go through `http://localhost:8080`.

### Authentication — `/api/auth`

| Method | Path | Auth | Description |
|---|---|:---:|---|
| POST | `/api/auth/register` | No | Create account |
| POST | `/api/auth/login` | No | Get JWT token |
| POST | `/api/auth/forgot-password` | No | Send reset email |
| POST | `/api/auth/reset-password/:token` | No | Set new password |
| GET | `/api/auth/profile` | Yes | Get user profile |
| PUT | `/api/auth/profile` | Yes | Update name / email |
| GET | `/api/auth/cv-status` | Yes | Get CV status |
| PATCH | `/api/auth/cv-status` | Yes | Update CV status |

### CV Parsing — `/api/cv`

| Method | Path | Auth | Description |
|---|---|:---:|---|
| POST | `/api/cv/upload` | Yes | Upload CV file |
| POST | `/api/cv/parse/:file_id` | Yes | Run NLP extraction |
| PUT | `/api/cv/verify` | Yes | Save verified data |
| GET | `/api/cv/summary/:user_id` | Yes | Fetch CV summary |

**Auth** = requires `Authorization: Bearer <JWT>` header.

---

## Troubleshooting

**Module 2 returns 401 Unauthorized on upload**
Make sure you are opening Module 2 by clicking the **Upload CV** button on the Dashboard — not by navigating to `localhost:5173` directly. The Dashboard injects your session token into the URL so Module 2 can authenticate you.

**"Auth Service is unavailable" from the gateway**
Module 1 backend is not running. Start Terminal 1 first.

**"CV Service is unavailable" from the gateway**
Module 2 backend is not running or the virtual environment is not activated. Check Terminal 2.

**MongoDB connection error**
MongoDB is not running. Start it before launching any backend service.

**spaCy model not found**
Run `python -m spacy download en_core_web_sm` inside the activated virtual environment.

**Password reset emails not arriving**
Check `Module 1/.env` — `EMAIL_USER` and `EMAIL_PASSWORD` must be set. Use a Gmail App Password, not your account password.

**Port already in use**
Another process is using the port. On Windows: `netstat -ano | findstr :<port>` then `taskkill /PID <pid> /F`.
