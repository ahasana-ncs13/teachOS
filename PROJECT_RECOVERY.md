# TeachOS Project Recovery

Audit snapshot: 19 October 2026 (Asia/Dhaka)

This report reflects files and Git history available in the workspace at the time of the audit. The source tree was not changed as part of the audit. This report itself is the requested new file.

## Overview

TeachOS is intended to be a teacher and course management portal where teachers publish courses/batches and students browse and enroll. The root README contains the original product requirements, including listings, enrollments, role-based pages, and reporting.

The implemented application is an early prototype with a polished, static marketing homepage, Firebase email/password and Google sign-in code, a registration form with three selectable role labels, a generic dashboard with sample metrics, and a small Express/MongoDB API for user profile records. The course marketplace and most other requirements are not wired up. Do not interpret sample home content or dashboard metrics as live database data.

## Technology and entry points

- JavaScript ES modules; npm workspaces at repository root.
- Frontend: React 19, Vite 8, React Router 7, React Hook Form, Axios, React Icons, Tailwind CSS 4 Vite plugin, Oxlint, Firebase JS SDK.
- Backend: Node.js, Express 5, MongoDB Node driver 7, dotenv, CORS.
- Frontend entry: `client/index.html` -> `client/src/main.jsx` -> `client/src/App.jsx`.
- Backend entry: `server/src/index.js`; Mongo connection helpers are in `server/src/db.js`.
- No tests, test scripts, ORM, migration system, Firebase Admin SDK, payment integration, file storage, or deployment configuration were found in the accessible project files.

## Actual directory structure

```text
teachOS/
├── package.json                 npm workspace scripts (client + server)
├── package-lock.json            root workspace dependency lock
├── README.md                    original product requirements (modified locally)
├── PROJECT_RECOVERY.md          this audit and restart guide
├── .gitignore                   root ignore rules
├── .vscode/settings.json        local VS Code terminal cwd (modified locally)
├── client/
│   ├── package.json             Vite scripts and frontend dependencies
│   ├── package-lock.json        client dependency lock
│   ├── .env.example             API URL and Firebase variable names
│   ├── vite.config.js           React/Tailwind plugins and API proxy
│   ├── index.html               browser document
│   ├── src/
│   │   ├── main.jsx             React, router and AuthProvider bootstrap
│   │   ├── App.jsx              routes, protected dashboard and sample dashboard
│   │   ├── App.css, index.css   application/global styles
│   │   ├── context/
│   │   │   ├── AuthContext.jsx  Firebase setup and sign-in/register state
│   │   │   ├── authContext.js   context object
│   │   │   └── useAuth.js       context hook
│   │   ├── lib/api.js           shared Axios API client
│   │   ├── pages/
│   │   │   ├── Home.jsx         static landing page and hard-coded listings
│   │   │   ├── Login.jsx        login form, Google button and demo behavior
│   │   │   ├── Register.jsx     registration form and role selector
│   │   │   └── admin/
│   │   │       └── AdminDashboard.jsx  empty, untracked file
│   │   ├── styles/              page styles for home, login and register
│   │   └── assets/              local hero and starter Vite/React assets
│   ├── public/                  static SVG assets
│   └── README.md                unmodified Vite template documentation
└── server/
    ├── package.json             API scripts and server dependencies
    ├── .env.example              port, CORS origins, Mongo URI and DB name
    └── src/
        ├── index.js              Express app, API handlers and lifecycle
        └── db.js                 Mongo client, connection, users index
```

Generated `node_modules` directories are excluded. Two additional zero-byte untracked items exist at the repository root: a file named `,` and `client/src/pages/admin/AdminDashboard.jsx` (the latter appears in the tree). Preserve and review these manually; the audit did not remove them.

### Where to work

- Landing page content/styles: `client/src/pages/Home.jsx`, `client/src/styles/home.css`.
- Authentication and user profile synchronization: `client/src/context/AuthContext.jsx`, `client/src/pages/Login.jsx`, `client/src/pages/Register.jsx`.
- Client route structure/dashboard: `client/src/App.jsx`.
- API calls: `client/src/lib/api.js`; API endpoints: `server/src/index.js`.
- MongoDB connection/database selection/indexes: `server/src/db.js`.
- Local configuration: `client/.env` and `server/.env` (create from their examples; neither actual file was inspected or reported).

## Frontend behavior and routes

`App.jsx` defines `/`, `/login`, `/register`, and `/dashboard`. Any unknown URL is redirected to `/`, so there is no 404 page. `/dashboard` is wrapped by a client-side `ProtectedRoute` that checks only whether an AuthContext `user` value exists. There are no role-specific dashboards or frontend route checks. The dashboard uses hard-coded course names, student activity, dates and metrics. Its “create course”, search, courses and students navigation do not implement marketplace actions.

`Home.jsx` contains three rotating hero slides, four category cards, six static listing records, static teacher profiles, search controls that only display a toast, and marketing copy with unsupported claims (for example verification, escrow, ratings and operational status). Several links are anchors or buttons without a real listing/detail flow. It imports `react-router-dom` only for the brand link. It does not request `/api/courses`.

Login and registration use React Hook Form. When Firebase config is absent, AuthContext deliberately enters demo mode: any email/password sets a local user, and registration does not persist to MongoDB. When configured, Firebase email/password login and Google popup login are implemented. Google sign-in attempts to write a default student profile. Email/password registration writes a profile including the selected role. Auth state restoration uses Firebase's observer. The UI advertises password length of 8, but does not check uppercase/lowercase; Firebase is the eventual password authority.

## Backend, database and data flow

The Express server listens on `PORT` (default 5000), parses JSON, and permits origins listed in comma-separated `CLIENT_URL`. Vite proxies `/api` to port 5000; Axios uses `VITE_API_URL` or `/api`.

Implemented endpoints:

| Method and path | Behavior | Access control |
|---|---|---|
| `GET /api/health` | Reports starting/connected status and timestamp based on an in-process database-ready flag | Public |
| `POST /api/users` | Upserts a user document by `uid`; accepts `email`, profile fields, and `role` | Public; no Firebase token verification |
| `GET /api/courses` | Returns `{ courses: [] }` | Public placeholder |

MongoDB database name defaults to `teachOSDB`. `server/src/db.js` connects with `MONGODB_URI`, pings MongoDB, and creates a unique index on `users.uid`. The only observed collection is `users`, with fields assembled in `/api/users`: `uid`, normalized `email`, display/full name, `role`, `photoURL`, provider, email verification flag, metadata, and timestamps. The intended `listings` and `orders` collections appear only in the README's example schema; no database operations implement them. No relationships, schema validation, migrations, or other indexes are defined.

Data flow for Firebase registration is browser -> Firebase account creation -> `saveUser()` -> unauthenticated `POST /api/users` -> MongoDB `users`. Google sign-in follows a similar profile write with student role. Email/password sign-in does not call `saveUser()` or retrieve a profile/role. The backend does not verify that `uid` or email belongs to the caller.

### Environment variable names

Client (`client/.env.example`): `VITE_API_URL`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`.

Server (`server/.env.example`): `PORT`, `CLIENT_URL`, `MONGODB_DB_NAME`, `MONGODB_URI`.

No real secret values are reproduced here. Firebase web config is supplied by the Firebase project; MongoDB URI must be private. Do not commit populated `.env` files. The Firebase client API key is browser configuration rather than a server credential, but Firebase security still depends on Firebase project settings and backend authorization.

## Roles and permissions

The registration UI offers `admin`, `teacher`, and `student`; its default is teacher. The backend accepts those same three strings on `/api/users`, but this is only stored profile data. No role is used to authorize an endpoint or select a dashboard. Google sign-in assigns student when persisting its profile. In demo mode the submitted registration role is only held in client memory.

| Role | Registration/login | UI access/actions | API permission currently enforced |
|---|---|---|---|
| Admin | Public signup role selection; Firebase or demo auth | Same generic `/dashboard` as any signed-in user | None specific to admin; no admin endpoint |
| Teacher | Public signup, default selection; Firebase or demo auth | Same generic dashboard; no listing management | None specific to teacher |
| Student | Public signup selection or Google default; Firebase or demo auth | Same generic dashboard; no enrollment flow | None specific to student |

The only route restriction is a client-side signed-in check for `/dashboard`, which can be bypassed by calling the API directly and does not distinguish roles. The API currently has no protected resource endpoints, but `/api/users` is an authorization flaw: anyone can submit a `uid` and set/change the stored role, including admin, without a verified Firebase ID token. This report does not confirm any Firebase database rules or console-side configuration.

## Setup and run on Windows (PowerShell or VS Code terminal)

Observed scripts are the source of these commands. There are no `engines` fields or documented Node version pin in the manifests. Use a Node.js/npm version compatible with Vite 8 and the installed dependencies; the project does not specify an exact version. No local MongoDB installation is required if a reachable MongoDB Atlas or other MongoDB URI is configured.

1. Open VS Code and choose **File > Open Folder...**, then select `D:\PROJECTS\teachOS`.
2. Open a PowerShell terminal in VS Code. From the project root install workspace dependencies:

   ```powershell
   cd D:\PROJECTS\teachOS
   npm install
   ```

   This installs declared dependencies; it does not create environment configuration.

3. Create local env files from the examples:

   ```powershell
   Copy-Item client/.env.example client/.env
   Copy-Item server/.env.example server/.env
   ```

4. Edit `server/.env` and replace the Mongo URI placeholders with a valid MongoDB connection URI. `MONGODB_DB_NAME=teachOSDB` is the default. Configure the database network access and database user in MongoDB according to your provider. Use `PORT=5000` and include `http://localhost:5173` in `CLIENT_URL`; the example already lists ports 5173 and 5174.
5. Edit `client/.env` with your Firebase web app values if you want real auth. In Firebase Console, enable Email/Password and Google sign-in providers and authorize `localhost` for local development. Leave Firebase values empty only if you intentionally want demo auth; demo accounts are not real or persisted. Keep `VITE_API_URL=http://localhost:5000/api` or use the Vite proxy by leaving it unset.
6. From the root, start both services:

   ```powershell
   npm run dev
   ```

   Or use two terminals: `npm run dev --workspace server` in the root for the API, and `npm run dev --workspace client` in the root for Vite. The server defaults to `http://localhost:5000`; Vite typically reports `http://localhost:5173`.

7. Visit `http://localhost:5173/`. Check `http://localhost:5000/api/health` for `status: "ok"` and `database: "connected"`. `GET /api/courses` currently returns an empty array. A successful page load does not demonstrate that marketplace functionality exists.

If the browser reports a CORS error, ensure the exact Vite origin (including port) is in `CLIENT_URL`, then restart the API. If health reports 503 or the server logs a Mongo connection error, check `MONGODB_URI`, database network allowlist and credentials. If Firebase setup errors occur, verify all six client config values and enabled sign-in providers. Restart Vite after editing its `.env` because Vite reads environment values at startup. Do not paste credentials into logs or this report.

Available project commands (not executed during this audit):

```powershell
npm run build       # client production build only
npm run lint        # client Oxlint only
npm run server      # server watch mode
npm run dev         # client and server concurrently
```

There is no test script in root/client/server package manifests. No production server build, database seed, or deployment script is defined. Audit did not install dependencies, start services, run lint/build, or connect to the configured database.

## Feature status

| Feature | Status | Evidence/File Location | Remaining Work | Priority |
|---|---|---|---|---|
| Marketing home and responsive styling | Partially complete | `client/src/pages/Home.jsx`, `client/src/styles/home.css` | Replace unsupported/sample claims; connect controls to real pages/data; inspect responsiveness in browser | Medium |
| Firebase email/password auth | Partially complete | `client/src/context/AuthContext.jsx`, `Login.jsx`, `Register.jsx` | Configure and verify live Firebase; align required password rules; sync role/profile on login | High |
| Google sign-in | Partially complete | Auth context, login UI | Verify configured provider and profile sync behavior | Medium |
| Demo authentication | Implemented as demo only | Auth context | Do not treat as secure auth; disable for real use | High |
| Role-based access control | Not implemented | Register selector; `ProtectedRoute` in `App.jsx` | Trusted role assignment and backend token/role enforcement | Critical |
| Admin dashboard | Not implemented | `App.jsx`; empty `client/src/pages/admin/AdminDashboard.jsx` | Define/administer admin workflows and route checks | Low until core requirements defined |
| Teacher dashboard | Partially complete (static mock) | `/dashboard` in `client/src/App.jsx` | Replace hard-coded metrics/courses with teacher-owned data | High |
| Student dashboard | Not implemented | No student-specific route/page | Build based on student use cases after core APIs | Medium |
| Listing CRUD | Not implemented | No listing UI/API; README requirements only | Listing schema, validated CRUD, ownership checks, UI | Critical |
| Browse/search/filter listings | Not implemented | Home's static cards/search controls; `/api/courses` placeholder | Database query, listing routes/pages and functional filters | High |
| Listing details and enrollment | Not implemented | No corresponding route/API | Add detail and enrollment flows with server validation | High |
| User profile persistence | Partially complete | `POST /api/users`, `db.js`, Auth context | Verify identity server-side; handle updates/errors and profile retrieval | Critical |
| MongoDB connection and health | Partially complete | `server/src/db.js`, `server/src/index.js` | Correct duplicate connection invocation and verify startup failure handling | High |
| Input validation | Partially complete | Basic required checks in `/api/users`; React Hook Form fields | Server-side field/type/length validation and request limits | High |
| Authorization/ownership | Not implemented | No auth middleware in `server/src` | Verify Firebase ID tokens; enforce roles and ownership on server | Critical |
| Error handling | Partially complete | API catch around user write; client form messages | Consistent API errors, logging policy and startup handling | High |
| Loading states | Partially complete | Auth route restoration and submit buttons | Shared API loading/error states for future data pages | Medium |
| Enrollment PDF report | Not implemented | No PDF dependencies or UI | Implement only after enrollments exist | Low |
| Tests | Not implemented/found | No test files or scripts | Add suitable tests after features and auth boundaries exist | High |
| Lint/build | Configured, unverified | `client/package.json` | Run when implementation verification is authorized | Medium |
| Deployment | Not implemented/found | No deployment config | Select hosting/database approach after core implementation | Low |

## Confirmed issues and technical debt

1. **Unauthenticated profile/role write:** `POST /api/users` trusts caller-provided `uid`, email and role. A caller can create/change an admin record. This is the first security blocker before using the API with real users.
2. **Database connection invoked twice:** `server/src/index.js` calls `connectDatabase()` once without handling its promise and then again with handlers. This can create an unhandled rejected promise if Mongo configuration/connection fails, and duplicates startup work.
3. **Role is not enforced:** UI signup choice is not a trusted authorization mechanism; all signed-in users get the same dashboard and server has no auth middleware.
4. **Demo mode grants arbitrary local sign-in:** With blank Firebase config, any credentials set an in-memory user and unlock `/dashboard`. This is useful only for a UI preview.
5. **Marketplace is absent:** Courses endpoint always returns empty; home cards and data are hard-coded; no listing/order collections are accessed.
6. **Profile sync is inconsistent:** Email/password login does not sync or load the Mongo profile. Google profile defaults to student. User profile persistence can fail after Firebase account creation, leaving a Firebase account while registration UI shows an error.
7. **Registration differs from stated requirements:** The README asks for uppercase, lowercase and at least six characters; UI enforces at least eight characters only, and Firebase may apply its own configured policy.
8. **Route behavior differs from requirements:** no real 404 route; unknown paths redirect home. Listing detail is not implemented.
9. **Misleading placeholder copy/data:** static dashboard has fictional course/activity/metrics, and home includes unverified faculty, ratings, enrollment counts, escrow and status claims. Search, category controls, detail buttons and listing CTAs do not implement those actions.
10. **README drift:** root README is a copied requirements document rather than operational project documentation. The client README remains the Vite starter template.
11. **Dependency/config maintenance:** no package engine declaration, automated tests, deployment config or environment validation is present. Installed dependency directories were not used to assert runtime compatibility.

## Git and recovered progress

- Current branch: `main`, tracking `origin/main`.
- Only commit in available history: `92d8d72` (`first commit`), dated 8 September 2026 20:22 +06:00. No earlier milestones or commit trail are available to recover.
- At audit time, existing local changes were present in `.vscode/settings.json`, `README.md`, and `client/src/context/AuthContext.jsx`; untracked items were `,` and `client/src/pages/admin/AdminDashboard.jsx`. These were not made by this audit and should be reviewed/preserved.
- The newest confirmed project progress visible in source is the static landing page, login/register flow, Firebase integration scaffold, generic dashboard and basic Mongo-backed user profile API. Git history cannot identify which was the last feature worked on because there is only one commit.

## Recommended restart plan

### Start here: secure identity and role handling

The most important next task is to establish a trustworthy user identity/role boundary before building listings or enrollments. Registration currently lets a public caller submit the `admin` role, and the API trusts all profile fields without Firebase token verification. Any future owner-filtered listing routes would be unsafe if built on this foundation.

Likely files for that task:

- `server/src/index.js` — remove public trust in client-supplied role/UID and mount verified routes.
- `server/src/db.js` — keep database startup single and reliable; add appropriate indexes as schema is settled.
- `client/src/context/AuthContext.jsx` — send Firebase ID token and retrieve canonical role/profile on login/registration.
- `client/src/pages/Register.jsx` — remove public admin self-assignment or establish a controlled admin provisioning path.

That security work should precede listing CRUD. Once the boundary is established, a sensible sequence is:

1. Critical: server-side Firebase token verification, role policy, input validation, startup/error handling.
2. Core: listing schema/API with ownership enforcement, then browse/detail and teacher-owned CRUD.
3. Core: student enrollment API and UI; user-specific enrollment listing.
4. Secondary: role-specific dashboards, meaningful empty/loading/error states, real search/filter, 404 and page titles.
5. Quality: tests for auth/authorization and CRUD, responsive browser checks, build/lint.
6. Later: PDF reporting and deployment configuration.

First-session checklist:

- Confirm whether Firebase is the intended production identity provider and how initial admin accounts should be provisioned.
- Review and preserve the current uncommitted changes before editing.
- Decide trusted role assignment policy; never accept `admin` from an unauthenticated registration request.
- Implement and verify the API identity boundary before exposing user/listing operations.
- Then define the listing and enrollment schemas and build the first vertical slice.

Commands available to verify later (not run in this read-only audit):

```powershell
npm run lint
npm run build
npm run dev
Invoke-RestMethod http://localhost:5000/api/health
Invoke-RestMethod http://localhost:5000/api/courses
```

The final two commands only verify the existing health and placeholder courses endpoints; they do not verify marketplace behavior. There are no test commands until tests are added.
