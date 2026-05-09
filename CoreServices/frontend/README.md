# MUQAYYIM — Unified Frontend

The single-page React application for the entire MUQAYYIM platform. Handles authentication, CV parsing, profile building, and GitHub integration — all in one browser tab with no full-page reloads.

---

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Pages & Routes](#pages--routes)
- [Key Components](#key-components)
- [Services](#services)
- [Environment Variables](#environment-variables)
- [Prerequisites](#prerequisites)
- [Running the Frontend](#running-the-frontend)
- [How Authentication Works](#how-authentication-works)

---

## Overview

This is the unified React frontend for MUQAYYIM. All features — authentication, CV upload and parsing, profile builder, and GitHub integration — live in this single application. It communicates with all backend services exclusively through the **API Gateway** (port 8080); it never calls Module 1 (port 3000) or Module 2 (port 8000) directly.

The Module 2 frontend (port 5173) is **no longer used**. CV parsing is fully integrated at the `/cv-parsing` route within this app.

---

## Tech Stack

| Layer       | Technology             |
|-------------|------------------------|
| Framework   | React 18               |
| Build tool  | Vite 5                 |
| Styling     | Tailwind CSS 3.4       |
| Routing     | React Router DOM 6     |
| HTTP client | Axios 1.6              |
| Icons       | Lucide React           |
| Toasts      | React Hot Toast        |
| Fonts       | Inter (Google Fonts)   |

---

## Project Structure

```
frontend/
├── .env                              ← API base URL (gateway)
├── index.html
├── vite.config.js                    ← Dev server on port 5174
├── tailwind.config.js
├── package.json
└── src/
    ├── index.css                     ← Tailwind directives + .btn-primary, .card, etc.
    ├── main.jsx                      ← ReactDOM root, providers, Toaster
    ├── App.jsx                       ← Route tree with auth guards
    │
    ├── context/
    │   └── AuthContext.jsx           ← Global auth state (user, login, logout, refresh)
    │
    ├── services/
    │   ├── authService.js            ← Auth API calls, localStorage helpers
    │   ├── cvService.js              ← CV upload, parse, verify API calls
    │   └── profileService.js         ← Profile CRUD + GitHub fetch API calls
    │
    ├── components/
    │   ├── ProtectedRoute.jsx        ← Redirects unauthenticated users to /login
    │   ├── Navbar.jsx                ← Top nav with all 4 main links + user dropdown
    │   ├── CVStatusBadge.jsx         ← Badge and stepper for CV status display
    │   ├── cv/
    │   │   ├── SkillsSection.jsx     ← Renders extracted skills from parsed CV
    │   │   ├── EducationSection.jsx  ← Renders extracted education entries
    │   │   ├── ExperienceSection.jsx ← Renders extracted experience entries
    │   │   └── ParsedSummary.jsx     ← Full parsed CV review panel
    │   └── profile/
    │       ├── PersonalInfoForm.jsx  ← Phone, location, website, LinkedIn, GitHub fields
    │       ├── SummaryForm.jsx       ← Textarea with character counter
    │       ├── ExperienceForm.jsx    ← Inline add/edit list of work experience entries
    │       ├── EducationForm.jsx     ← Inline add/edit list of education entries
    │       ├── SkillsForm.jsx        ← Tag input + GitHub extracted skill promotion
    │       ├── CertificationsForm.jsx← Inline add/edit certifications with URL field
    │       ├── ProjectsForm.jsx      ← Inline add/edit projects with technology tags
    │       └── GitHubForm.jsx        ← GitHub username fetch + repo selector + apply
    │
    └── pages/
        ├── LoginPage.jsx             ← Sign-in form
        ├── RegisterPage.jsx          ← Registration form
        ├── ForgotPasswordPage.jsx    ← Request password reset email
        ├── ResetPasswordPage.jsx     ← Set new password via token URL
        ├── DashboardPage.jsx         ← Welcome banner, CV status, quick actions
        ├── ProfilePage.jsx           ← Account info (name, email, sign out)
        ├── CVParsingPage.jsx         ← Upload → Parse → Review → Verify pipeline
        └── ProfileBuilderPage.jsx    ← Full professional profile editor
```

---

## Pages & Routes

| Route                    | Page                  | Auth | Description                                           |
|--------------------------|-----------------------|:----:|-------------------------------------------------------|
| `/login`                 | LoginPage             | No   | Email + password login                                |
| `/register`              | RegisterPage          | No   | Create a new account                                  |
| `/forgot-password`       | ForgotPasswordPage    | No   | Request password reset email                          |
| `/reset-password/:token` | ResetPasswordPage     | No   | Set new password (token from email link)              |
| `/dashboard`             | DashboardPage         | Yes  | Welcome banner, CV status stepper, quick actions      |
| `/cv-parsing`            | CVParsingPage         | Yes  | Upload CV → AI parse → review extracted data → verify |
| `/profile-builder`       | ProfileBuilderPage    | Yes  | Build full professional profile with GitHub sync      |
| `/profile`               | ProfilePage           | Yes  | View/edit name & email, sign out                      |
| `/`                      | Redirect              | —    | → `/dashboard` if logged in, else `/login`            |

Authenticated routes are wrapped in `<ProtectedRoute>`. Public routes (`/login`, `/register`) redirect to `/dashboard` if already logged in.

---

## Key Components

### `AuthContext`
Provides `user`, `isAuthenticated`, `login()`, `register()`, `logout()`, `refreshProfile()`, and `updateUser()` to the entire app. On mount it rehydrates state from `localStorage` so the user stays logged in across page refreshes. Token is stored under the key `token`.

### `Navbar`
Fixed top bar with:
- MUQAYYIM logo (links to `/dashboard`)
- Nav links: Dashboard, CV Parsing, Profile Builder, Account
- User avatar (initials) + dropdown with email, profile link, and sign-out
- Fully responsive — collapses to a hamburger menu on mobile

### `CVStatusBadge` / `CVStatusStepper`
- **Badge** (`size="sm"`/`size="lg"`): coloured pill showing current status
- **Stepper** (`<CVStatusStepper>`): 4-step horizontal progress track on the Dashboard

Status progression: `Not Uploaded` → `Uploaded` → `Processing` → `Verified`

### `GitHubForm`
Fetches all public repos for a username via the backend (which calls the GitHub API). Displays repos in a grid with checkboxes. "Apply to Profile" merges selected repos into `profile.projects.github` and extracts languages/topics as skills into `profile.skills.extracted`.

---

## Services

### `authService.js`
All auth-related API calls: `login`, `register`, `forgotPassword`, `resetPassword`, `getProfile`, `updateProfile`, `getCVStatus`, `updateCVStatus`. Reads `localStorage.getItem('token')` for the auth header.

### `cvService.js`
CV pipeline API calls: `uploadCV`, `parseCV`, `verifyCVData`. All go through the gateway at `/api/cv/*`. Reads `localStorage.getItem('token')`.

### `profileService.js`
Profile management API calls: `getProfile`, `saveProfile`, `fetchGitHub`. All go through the gateway at `/api/profile/*`. Reads `localStorage.getItem('token')`.

---

## Environment Variables

Edit `.env` in the `frontend/` directory:

```env
VITE_API_URL=http://localhost:8080
```

| Variable       | Value                    | Purpose                              |
|----------------|--------------------------|--------------------------------------|
| `VITE_API_URL` | `http://localhost:8080`  | API Gateway — single entry point for all backend calls |

> All API calls route through the gateway. Do not set `VITE_API_URL` to port 3000 or 8000 directly.

> Vite only exposes variables prefixed with `VITE_` to the browser. Never put secrets here.

---

## Prerequisites

| Requirement | Version | Check     |
|-------------|---------|-----------|
| Node.js     | 18+     | `node -v` |
| npm         | 9+      | `npm -v`  |

All three backend services (Core Service, AI Service, API Gateway) must be running before using the frontend.

---

## Running the Frontend

### 1. Install dependencies

```powershell
cd "Module 1\frontend"
npm install
```

### 2. Configure environment

The `.env` file should already have:
```env
VITE_API_URL=http://localhost:8080
```

### 3. Start the dev server

```powershell
npm run dev
```

Open **http://localhost:5174** in your browser.

### Other scripts

| Script           | Command           | Purpose                            |
|------------------|-------------------|------------------------------------|
| Development      | `npm run dev`     | Start Vite dev server (hot reload) |
| Production build | `npm run build`   | Output optimised bundle to `dist/` |
| Preview build    | `npm run preview` | Serve the production build locally |
| Lint             | `npm run lint`    | Run ESLint                         |

---

## How Authentication Works

1. **Register / Login** → Backend returns `{ token, user }`. Both are saved to `localStorage` under keys `token` and `user`.
2. **Every subsequent request** → Services read `localStorage.getItem('token')` and attach `Authorization: Bearer <token>`.
3. **Page refresh** → `AuthContext` reads from `localStorage` on mount and rehydrates user state — no re-login required.
4. **Token expiry / invalid token** → Backend returns `401`. The user is redirected to `/login`.
5. **Logout** → `localStorage` is cleared and the user is sent to `/login`.

The JWT is never decoded on the frontend — only the backend validates it. The `user` object in `localStorage` is the plain JSON from the API (name, email, role, cvStatus) used only for display purposes.
