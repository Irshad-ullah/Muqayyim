# MUQAYYIM — Module 1: Auth Frontend

React + Tailwind CSS frontend for the MUQAYYIM User Management Service. Handles registration, login, password reset, and the user dashboard.

---

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Pages & Routes](#pages--routes)
- [Environment Variables](#environment-variables)
- [Prerequisites](#prerequisites)
- [Running the Frontend](#running-the-frontend)
- [How Authentication Works](#how-authentication-works)

---

## Overview

This is the user-facing React application for Module 1. It communicates exclusively with the **Module 1 backend** (port 3000) for authentication and profile management, and links out to the **Module 2 frontend** (port 5173) for CV parsing.

All API calls include the JWT from `localStorage` in the `Authorization: Bearer <token>` header — the frontend never stores or transmits passwords after the initial login call.

---

## Tech Stack

| Layer       | Technology                     |
|-------------|-------------------------------|
| Framework   | React 18                       |
| Build tool  | Vite 5                         |
| Styling     | Tailwind CSS 3.4               |
| Routing     | React Router DOM 6             |
| HTTP client | Axios 1.6                      |
| Icons       | Lucide React                   |
| Toasts      | React Hot Toast                |
| Fonts       | Inter (Google Fonts)           |

---

## Project Structure

```
frontend/
├── .env                          ← API base URLs
├── index.html                    ← HTML entry with Inter font
├── vite.config.js                ← Dev server on port 5174
├── tailwind.config.js            ← Custom animations
├── postcss.config.js
├── package.json
└── src/
    ├── index.css                 ← Tailwind directives + component utilities
    ├── main.jsx                  ← ReactDOM root, providers, Toaster
    ├── App.jsx                   ← Route tree with auth guards
    │
    ├── context/
    │   └── AuthContext.jsx       ← Global auth state (user, login, logout, refresh)
    │
    ├── services/
    │   └── authService.js        ← Axios instances, all API calls, localStorage helpers
    │
    ├── components/
    │   ├── ProtectedRoute.jsx    ← Redirects unauthenticated users to /login
    │   ├── Navbar.jsx            ← Top navigation, user dropdown, mobile menu
    │   └── CVStatusBadge.jsx     ← Badge and stepper components for CV status
    │
    └── pages/
        ├── LoginPage.jsx         ← Sign-in form (split-screen layout)
        ├── RegisterPage.jsx      ← Registration form with password strength hints
        ├── ForgotPasswordPage.jsx← Request password reset email
        ├── ResetPasswordPage.jsx ← Set new password via token URL
        ├── DashboardPage.jsx     ← Main app screen after login
        └── ProfilePage.jsx       ← View and edit profile, sign out
```

---

## Pages & Routes

| Route                      | Page                  | Auth required | Description                                    |
|----------------------------|-----------------------|:-------------:|------------------------------------------------|
| `/login`                   | LoginPage             | No            | Email + password login                         |
| `/register`                | RegisterPage          | No            | Create a new account                           |
| `/forgot-password`         | ForgotPasswordPage    | No            | Request password reset email                   |
| `/reset-password/:token`   | ResetPasswordPage     | No            | Set new password (token from email link)       |
| `/dashboard`               | DashboardPage         | **Yes**       | Welcome banner, CV status stepper, quick actions |
| `/profile`                 | ProfilePage           | **Yes**       | View/edit name & email, sign out               |
| `/`                        | Redirect              | —             | → `/dashboard` if logged in, else `/login`     |

Authenticated routes are wrapped in `<ProtectedRoute>` — unauthenticated access redirects to `/login`. Public auth routes (`/login`, `/register`) redirect to `/dashboard` if already logged in.

---

## Key Components

### `AuthContext`
Provides `user`, `isAuthenticated`, `login()`, `register()`, `logout()`, `refreshProfile()`, and `updateUser()` to the entire app. On mount it rehydrates state from `localStorage` so the user stays logged in across page refreshes.

### `Navbar`
Fixed top bar with:
- MUQAYYIM logo (links to `/dashboard`)
- Nav links: Dashboard, Profile
- User avatar (initials) + dropdown with email, profile link, and sign-out
- Fully responsive — collapses to a hamburger menu on mobile

### `CVStatusBadge` / `CVStatusStepper`
Two variants of the CV status display:
- **Badge** (`size="sm"` default): coloured pill with dot indicator
- **Badge** (`size="lg"`): larger pill with icon
- **Stepper** (`<CVStatusStepper>`): horizontal 4-step progress track used on the Dashboard

Status progression: `Not Uploaded` → `Uploaded` → `Processing` → `Verified`

---

## Environment Variables

Create (or edit) `.env` in the `frontend/` directory:

```env
VITE_API_URL=http://localhost:3000
VITE_CV_SERVICE_URL=http://localhost:8000
```

| Variable              | Default                  | Purpose                              |
|-----------------------|--------------------------|--------------------------------------|
| `VITE_API_URL`        | `http://localhost:3000`  | Module 1 backend base URL            |
| `VITE_CV_SERVICE_URL` | `http://localhost:8000`  | Module 2 CV parsing service base URL |

> Vite only exposes variables prefixed with `VITE_` to the browser. Never put secrets here.

---

## Prerequisites

| Requirement | Version | Check        |
|-------------|---------|--------------|
| Node.js     | 18+     | `node -v`    |
| npm         | 9+      | `npm -v`     |

The **Module 1 backend must be running** on port `3000` before you start the frontend, otherwise API calls will fail.

---

## Running the Frontend

### 1. Install dependencies

```bash
cd "Module 1/frontend"
npm install
```

This installs React, Tailwind CSS, Vite, Lucide React, Axios, and all other dependencies listed in `package.json`.

### 2. Configure environment

The `.env` file already exists with default values. Edit it if your backend runs on a different port:

```env
VITE_API_URL=http://localhost:3000
VITE_CV_SERVICE_URL=http://localhost:8000
```

### 3. Start the dev server

```bash
npm run dev
```

Open **http://localhost:5174** in your browser.

You should see the MUQAYYIM login page.

### Other scripts

| Script          | Command           | Purpose                             |
|-----------------|-------------------|-------------------------------------|
| Development     | `npm run dev`     | Start Vite dev server (hot reload)  |
| Production build| `npm run build`   | Output optimised bundle to `dist/`  |
| Preview build   | `npm run preview` | Serve the production build locally  |
| Lint            | `npm run lint`    | Run ESLint                          |

---

## Running Both Services Together

For the full Module 1 experience, run the backend and frontend simultaneously (two terminals):

**Terminal 1 — Backend:**
```bash
cd "Module 1"
npm run dev
# Auth Service running on port 3000
```

**Terminal 2 — Frontend:**
```bash
cd "Module 1/frontend"
npm run dev
# Vite dev server on http://localhost:5174
```

Then open **http://localhost:5174** and register a new account.

---

## How Authentication Works

1. **Register / Login** → Backend returns `{ token, user }`. The token and user are saved to `localStorage`.
2. **Every subsequent request** → `authService.js` attaches `Authorization: Bearer <token>` automatically via an Axios interceptor.
3. **Page refresh** → `AuthContext` reads from `localStorage` on mount and rehydrates the user state — no re-login required.
4. **Token expiry / invalid token** → Backend returns `401`. The user is redirected to `/login`.
5. **Logout** → `localStorage` is cleared and the user is sent to `/login`.

The JWT is never decoded on the frontend — only the backend validates it. The `user` object stored in `localStorage` is the plain JSON returned by the API (name, email, role, cvStatus), used only for display purposes.

---

## Connecting to Module 2

After login, the Dashboard shows a **"Upload CV"** button that opens the Module 2 frontend at `http://localhost:5173`. The JWT stored in `localStorage` is read by the Module 2 frontend's Axios interceptor and sent to the CV parsing API, which validates it to extract `user_id`.

No direct communication happens between the two frontends — the JWT is the only shared artefact.
