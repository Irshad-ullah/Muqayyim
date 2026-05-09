# MUQAYYIM — Module 1: Core Service

Backend microservice for authentication, user management, and professional profile management, built with **Node.js**, **Express**, **MongoDB**, and **JWT**.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [API Reference](#api-reference)
- [Data Schemas](#data-schemas)
- [Environment Variables](#environment-variables)
- [Prerequisites](#prerequisites)
- [Running the Service](#running-the-service)
- [How JWT Works with Module 2](#how-jwt-works-with-module-2)

---

## Overview

Module 1 is the **Core Service** of the MUQAYYIM system. It is the authentication and identity layer that every other service trusts, and it manages all professional profile data including GitHub integration.

**Responsibilities:**
- Register and authenticate users
- Issue signed JWT tokens containing `userId`, `id`, and `role`
- Manage user account info (name, email, role, CV status)
- Handle forgot-password / reset-password via email
- Expose CV status endpoints so the frontend can track parsing progress
- Store and manage full professional profiles (personal info, experience, education, skills, certifications, projects)
- Fetch GitHub repositories and auto-extract technology skills from public profiles

---

## Architecture

```
Frontend (port 5174)
       │
       ▼
 API Gateway (port 8080)          ← All traffic routes through here
       │
       ├──▶ /api/auth/*    ──▶ Module 1 (port 3000)  ← This service
       ├──▶ /api/profile/* ──▶ Module 1 (port 3000)  ← This service
       │
       └──▶ /api/cv/*      ──▶ Module 2 (port 8000)
                                 CV Parsing (FastAPI)
```

This service is **stateless** — no sessions, no in-memory state. Every protected request is authenticated via `Authorization: Bearer <JWT>`.

---

## Tech Stack

| Layer       | Technology              |
|-------------|-------------------------|
| Runtime     | Node.js 18+             |
| Framework   | Express 4.18            |
| Database    | MongoDB (via Mongoose)  |
| Auth        | JSON Web Tokens (JWT)   |
| Passwords   | bcryptjs                |
| Email       | Nodemailer (Gmail SMTP) |
| HTTP client | Axios (GitHub API)      |
| Environment | dotenv                  |

---

## Project Structure

```
Module 1/
├── server.js                        ← Express app entry point
├── package.json
├── .env                             ← Environment variables
└── backend/
    ├── config/
    │   └── db.js                    ← Mongoose connection
    ├── controllers/
    │   ├── authController.js        ← Auth & user account handlers
    │   └── profileController.js     ← Profile CRUD + GitHub fetch handlers
    ├── middleware/
    │   └── auth.js                  ← JWT verification middleware
    ├── models/
    │   ├── User.js                  ← Mongoose user schema
    │   └── Profile.js               ← Mongoose professional profile schema
    ├── routes/
    │   ├── authRoutes.js            ← /api/auth/* route definitions
    │   └── profileRoutes.js         ← /api/profile/* route definitions
    ├── services/
    │   └── githubService.js         ← GitHub API client + skill extractor
    └── utils/
        └── emailService.js          ← Nodemailer password reset emails
```

---

## API Reference

Base URL: `http://localhost:3000`

### Authentication — `/api/auth`

#### `POST /api/auth/register`
Register a new user account.

**Request body:**
```json
{
  "name": "Ahmed Ali",
  "email": "ahmed@example.com",
  "password": "secret123",
  "passwordConfirm": "secret123"
}
```

**Response `201`:**
```json
{
  "success": true,
  "token": "<JWT>",
  "user": {
    "id": "64f...",
    "name": "Ahmed Ali",
    "email": "ahmed@example.com",
    "role": "JobSeeker",
    "cvStatus": "Not Uploaded"
  }
}
```

---

#### `POST /api/auth/login`
Authenticate and receive a JWT.

**Request body:**
```json
{
  "email": "ahmed@example.com",
  "password": "secret123"
}
```

---

#### `POST /api/auth/forgot-password`
Send a password reset email.

**Request body:** `{ "email": "ahmed@example.com" }`

---

#### `POST /api/auth/reset-password/:token`
Reset password using the token from the email link.

**Request body:** `{ "password": "newpass123", "passwordConfirm": "newpass123" }`

---

### Protected Routes — require `Authorization: Bearer <JWT>`

#### `GET /api/auth/profile`
Get the authenticated user's account info.

#### `PUT /api/auth/profile`
Update name and/or email.

**Request body:** `{ "name": "Ahmed Khan" }` *(both fields optional)*

#### `GET /api/auth/cv-status`
Get the current CV processing status.

**Response:** `{ "success": true, "cvStatus": "Not Uploaded", "userId": "..." }`

#### `PATCH /api/auth/cv-status`
Update CV processing status.

**Request body:** `{ "cvStatus": "Uploaded" }`

Allowed values: `Not Uploaded` | `Uploaded` | `Processing` | `Verified`

---

### Profile Builder — `/api/profile`

All profile routes require `Authorization: Bearer <JWT>`.

#### `GET /api/profile`
Get the authenticated user's full professional profile.

**Response `200`:**
```json
{
  "success": true,
  "profile": {
    "personalInfo": { "phone": "", "location": "", "website": "", "linkedin": "", "github": "" },
    "summary": "",
    "experience": [],
    "education": [],
    "skills": { "manual": [], "extracted": [] },
    "certifications": [],
    "projects": { "manual": [], "github": [] },
    "githubData": { "username": "", "repos": [], "extractedSkills": [] }
  }
}
```

Returns `{ "success": true, "profile": null }` if no profile exists yet.

---

#### `PUT /api/profile`
Create or update the full professional profile (upsert).

**Request body:** Any subset of the profile fields. Only the fields you send are updated — missing fields are left as-is.

```json
{
  "personalInfo": { "phone": "+92 300 1234567", "location": "Lahore, Pakistan" },
  "summary": "Full-stack developer with 3 years experience...",
  "experience": [
    {
      "title": "Software Engineer",
      "company": "TechCorp",
      "startDate": "2022-01",
      "endDate": "",
      "current": true,
      "description": "Built RESTful APIs..."
    }
  ],
  "skills": { "manual": ["JavaScript", "Python"], "extracted": ["React", "FastAPI"] }
}
```

**Response `200`:** `{ "success": true, "profile": { ...updatedProfile } }`

---

#### `POST /api/profile/github`
Fetch public GitHub repositories for a username and extract technology skills.

**Request body:** `{ "username": "octocat" }`

**Response `200`:**
```json
{
  "success": true,
  "repos": [
    {
      "repoId": "123456",
      "name": "my-project",
      "description": "A sample project",
      "url": "https://github.com/octocat/my-project",
      "language": "JavaScript",
      "topics": ["react", "nodejs"],
      "stars": 42,
      "fork": false,
      "updatedAt": "2024-01-15T..."
    }
  ],
  "extractedSkills": ["JavaScript", "Python", "nodejs", "react"]
}
```

**Errors:**
- `404` — GitHub user not found
- `403` — GitHub API rate limit exceeded (add `GITHUB_TOKEN` to `.env` to fix)

---

### Health Check

#### `GET /health`
```json
{ "status": "ok", "message": "Auth Service is running" }
```

---

## Data Schemas

### User

| Field              | Type   | Notes                                                    |
|--------------------|--------|----------------------------------------------------------|
| `name`             | String | Required, max 100 chars                                  |
| `email`            | String | Unique, lowercase                                        |
| `password`         | String | bcrypt-hashed, never returned in responses               |
| `role`             | String | `JobSeeker` (default) or `Admin`                         |
| `cvStatus`         | String | `Not Uploaded` → `Uploaded` → `Processing` → `Verified` |
| `resetToken`       | String | SHA-256 hashed reset token                               |
| `resetTokenExpiry` | Date   | 1-hour expiry window                                     |

### Profile

| Field                        | Type     | Notes                                              |
|------------------------------|----------|----------------------------------------------------|
| `userId`                     | ObjectId | Ref to User, unique index                          |
| `personalInfo.phone`         | String   | Optional                                           |
| `personalInfo.location`      | String   | Optional                                           |
| `personalInfo.website`       | String   | Optional                                           |
| `personalInfo.linkedin`      | String   | Optional                                           |
| `personalInfo.github`        | String   | Optional                                           |
| `summary`                    | String   | Professional summary text                          |
| `experience[]`               | Array    | `{title, company, startDate, endDate, current, description}` |
| `education[]`                | Array    | `{degree, institution, field, startDate, endDate, grade}` |
| `skills.manual[]`            | Array    | Skills added manually by the user                  |
| `skills.extracted[]`         | Array    | Skills extracted from GitHub or CV                 |
| `certifications[]`           | Array    | `{name, issuer, date, url}`                        |
| `projects.manual[]`          | Array    | `{name, description, url, technologies[]}`         |
| `projects.github[]`          | Array    | Selected GitHub repos applied to profile           |
| `githubData.username`        | String   | Last fetched GitHub username                       |
| `githubData.repos[]`         | Array    | All fetched repos (raw)                            |
| `githubData.extractedSkills[]` | Array  | All skills extracted from repos                    |
| `githubData.lastSynced`      | Date     | Timestamp of last GitHub fetch                     |

---

## Environment Variables

Create a `.env` file in the `Module 1/` directory:

```env
# Database
MONGODB_URL=mongodb://localhost:27017
DB_NAME=muqayyim

# JWT — must be identical to Module 2 JWT_SECRET
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRE=7d

# Server
PORT=3000
NODE_ENV=development

# Email (Gmail SMTP — use an App Password, not your account password)
EMAIL_SERVICE=gmail
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-16-char-app-password

# URLs
FRONTEND_URL=http://localhost:5174
API_GATEWAY_URL=http://localhost:8080
CV_SERVICE_URL=http://localhost:8000

# GitHub API (optional) — raises rate limit from 60 to 5000 requests/hour
# GITHUB_TOKEN=ghp_yourPersonalAccessToken
```

> **Gmail App Password:** Go to Google Account → Security → 2-Step Verification → App Passwords. Generate a password for "Mail".

> **GitHub Token:** github.com → Settings → Developer settings → Personal access tokens → Generate new token (no scopes needed for public repo access). Only needed if you hit GitHub's 60 requests/hour rate limit.

---

## Prerequisites

| Requirement | Version  | Check              |
|-------------|----------|--------------------|
| Node.js     | 18+      | `node -v`          |
| npm         | 9+       | `npm -v`           |
| MongoDB     | 6+       | `mongod --version` |

MongoDB must be running before starting the service.

**Start MongoDB (Windows):**
```powershell
# If installed as a service
net start MongoDB

# Or run directly
mongod --dbpath "C:\data\db"
```

---

## Running the Service

### 1. Install dependencies

```powershell
cd "Module 1"
npm install
```

### 2. Configure environment

Edit `.env` — minimum required values:

```env
JWT_SECRET=pick-a-long-random-string   # must match Module 2
EMAIL_USER=your-gmail@gmail.com
EMAIL_PASSWORD=your-16-char-app-password
```

### 3. Start the server

**Development** (auto-restart on file changes):
```powershell
npm run dev
```

**Production:**
```powershell
npm start
```

Expected output:
```
✅ MongoDB connected successfully
🚀 Auth Service running on port 3000
```

---

## How JWT Works with Module 2

When a user logs in or registers, this service issues a JWT containing:

```json
{
  "userId": "<MongoDB ObjectId>",
  "id":     "<MongoDB ObjectId>",
  "role":   "JobSeeker",
  "iat":    1700000000,
  "exp":    1700604800
}
```

Module 2 (CV Parsing Service) receives this token in the `Authorization` header, decodes it using the **same `JWT_SECRET`**, and extracts `userId` as the shared identity. **`user_id` is never passed in the request body.**

Both modules must share the same `JWT_SECRET` value.
