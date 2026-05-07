# MUQAYYIM — Module 1: User Management Service

Backend microservice for authentication and user management, built with **Node.js**, **Express**, **MongoDB**, and **JWT**.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [API Reference](#api-reference)
- [Environment Variables](#environment-variables)
- [Prerequisites](#prerequisites)
- [Running the Service](#running-the-service)
- [How JWT Works with Module 2](#how-jwt-works-with-module-2)

---

## Overview

Module 1 is the **authentication and identity layer** of the MUQAYYIM system. Every other service trusts the JWT this module issues. It never depends on any other module — all inter-service identity is carried via the signed JWT token.

**Responsibilities:**
- Register and authenticate users
- Issue signed JWT tokens containing `userId`, `id`, and `role`
- Manage user profiles (name, email, role, CV status)
- Handle forgot-password / reset-password via email
- Expose CV status endpoints so the frontend can track parsing progress

---

## Architecture

```
Frontend (port 5174)
       │
       ▼
 API Gateway (port 8080)          ← All traffic routes through here
       │
       ├──▶ Module 1 (port 3000)  ← This service
       │        Auth, Users, JWT
       │
       └──▶ Module 2 (port 8000)
                CV Parsing (FastAPI)
```

This service is **stateless** — no sessions, no in-memory state. Every request is authenticated via `Authorization: Bearer <JWT>`.

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
| Environment | dotenv                  |

---

## Project Structure

```
Module 1/
├── server.js                  ← Express app entry point
├── package.json
├── .env                       ← Environment variables
└── backend/
    ├── config/
    │   └── db.js              ← Mongoose connection
    ├── controllers/
    │   └── authController.js  ← All route handlers
    ├── middleware/
    │   └── auth.js            ← JWT verification middleware
    ├── models/
    │   └── User.js            ← Mongoose user schema
    ├── routes/
    │   └── authRoutes.js      ← Route definitions
    └── utils/
        └── emailService.js    ← Nodemailer password reset emails
```

---

## API Reference

Base URL: `http://localhost:3000`

### Public Routes

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

**Response `200`:**
```json
{
  "success": true,
  "token": "<JWT>",
  "user": { "id": "...", "name": "...", "email": "...", "role": "JobSeeker", "cvStatus": "Not Uploaded" }
}
```

---

#### `POST /api/auth/forgot-password`
Send a password reset email.

**Request body:** `{ "email": "ahmed@example.com" }`

**Response `200`:** Always returns success (does not reveal whether the email exists).

---

#### `POST /api/auth/reset-password/:token`
Reset password using the token from the email link.

**Request body:** `{ "password": "newpass123", "passwordConfirm": "newpass123" }`

---

### Protected Routes

All protected routes require the header:
```
Authorization: Bearer <JWT>
```

#### `GET /api/auth/profile`
Get the authenticated user's profile.

**Response `200`:**
```json
{
  "success": true,
  "user": {
    "id": "...",
    "name": "Ahmed Ali",
    "email": "ahmed@example.com",
    "role": "JobSeeker",
    "cvStatus": "Not Uploaded",
    "createdAt": "2024-01-01T..."
  }
}
```

---

#### `PUT /api/auth/profile`
Update name and/or email.

**Request body:** `{ "name": "Ahmed Khan" }` *(both fields optional)*

---

#### `GET /api/auth/cv-status`
Get the current CV processing status.

**Response `200`:** `{ "success": true, "cvStatus": "Not Uploaded", "userId": "..." }`

---

#### `PATCH /api/auth/cv-status`
Update CV processing status (called internally via API Gateway after Module 2 events).

**Request body:**
```json
{ "cvStatus": "Uploaded" }
```

Allowed values: `Not Uploaded` | `Uploaded` | `Processing` | `Verified`

---

### Health Check

#### `GET /health`
```json
{ "status": "ok", "message": "Auth Service is running" }
```

---

## User Schema

| Field            | Type     | Notes                                              |
|------------------|----------|----------------------------------------------------|
| `name`           | String   | Required, max 100 chars                            |
| `email`          | String   | Unique, lowercase                                  |
| `password`       | String   | bcrypt-hashed, never returned in responses         |
| `role`           | String   | `JobSeeker` (default) or `Admin`                   |
| `cvStatus`       | String   | `Not Uploaded` → `Uploaded` → `Processing` → `Verified` |
| `resetToken`     | String   | SHA-256 hashed reset token                         |
| `resetTokenExpiry` | Date   | 1-hour expiry window                               |

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
```

> **Gmail App Password:** Go to Google Account → Security → 2-Step Verification → App Passwords. Generate a password for "Mail".

---

## Prerequisites

| Requirement | Version  | Check                     |
|-------------|----------|---------------------------|
| Node.js     | 18+      | `node -v`                 |
| npm         | 9+       | `npm -v`                  |
| MongoDB     | 6+       | `mongod --version`        |

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

```bash
cd "Module 1"
npm install
```

### 2. Configure environment

Copy the example and fill in your values:

```bash
# The .env file already exists — edit it directly
# Minimum required: MONGODB_URL, JWT_SECRET, EMAIL_USER, EMAIL_PASSWORD
```

### 3. Start the server

**Development** (auto-restart on file changes):
```bash
npm run dev
```

**Production:**
```bash
npm start
```

The service will be available at **http://localhost:3000**

You should see:
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
