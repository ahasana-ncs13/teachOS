# 📚 TeachOS — Online Teaching & Course Management Portal

> **TeachOS** is an all-in-one, community-driven online teaching and course management operating system built with the **MERN** stack. It connects educators, coaching mentors, and learners in a unified, transparent platform featuring live online cohorts, Google Meet integration, recorded video streaming with MongoDB GridFS, student assignment tracking, calendar-month revenue distribution, and dual-mode attendance management.

---

## 📑 Table of Contents

- [1. Project Theme & Executive Summary](#1-project-theme--executive-summary)
- [2. System Architecture & 3-Role Model](#2-system-architecture--3-role-model)
- [3. Getting Started & Local Setup](#3-getting-started--local-setup)
- [4. Implementation Details](#4-implementation-details)
  - [4.1 Technology Stack & Selection Justifications](#41-technology-stack--selection-justifications)
  - [4.2 Implemented Modules & Status Matrix](#42-implemented-modules--status-matrix)
  - [4.3 Security & Identity Implementation](#43-security--identity-implementation)
  - [4.4 GitHub & Team Development Process](#44-github--team-development-process)
  - [4.5 Key Implementation Challenges & Solutions](#45-key-implementation-challenges--solutions)
- [5. Testing & Verification](#5-testing--verification)
  - [5.1 Testing Environment](#51-testing-environment)
  - [5.2 Formal Test Cases (TC-01 to TC-15)](#52-formal-test-cases-tc-01-to-tc-15)
  - [5.3 Production Bug Reports & Resolutions](#53-production-bug-reports--resolutions)
  - [5.4 QA Test Execution Summary](#54-qa-test-execution-summary)
- [6. Demonstration & Presentation Guide](#6-demonstration--presentation-guide)
  - [6.1 Role-Based Live Walkthrough (Student, Teacher, Admin)](#61-role-based-live-walkthrough)
  - [6.2 Project Results & Verification Criteria](#62-project-results--verification-criteria)
  - [6.3 System Limitations & Future Roadmap](#63-system-limitations--future-roadmap)
  - [6.4 Project Repository & Delivery Information](#64-project-repository--delivery-information)

---

## 1. Project Theme & Executive Summary

In today's digital education landscape, talented teachers struggle to reach learners beyond their geographical neighborhoods, while students waste time navigating fragmented, overpriced coaching centers with hidden fees and middlemen. 

**TeachOS** provides an open, modern learning operating system that directly bridges this divide:
- **For Students**: A transparent directory to discover verified teachers, compare admission and monthly tuition fees, enroll in live online cohorts, access recorded lecture archives, submit assignments, and track attendance.
- **For Teachers**: A centralized workspace to publish course batches, schedule Google Meet live sessions, upload high-definition video lessons, take live attendance with one-click deduplication, manage assignment submissions, and track calendar-month payouts.
- **For Platform Admins**: Comprehensive governance, listing moderation, financial auditing, dispute resolution, platform-wide commission management, and detailed attendance analytics.

---

## 2. System Architecture & 3-Role Model

TeachOS enforces a clean **3-Role Architecture** where permissions and resource access are strictly validated on the backend:

```
                                  ┌────────────────────────┐
                                  │      TeachOS Portal     │
                                  │   (React 19 + Vite 8)  │
                                  └───────────┬────────────┘
                                              │
                     Bearer Firebase ID Token │ REST API Requests
                                              ▼
                                  ┌────────────────────────┐
                                  │  Express 5 REST Engine │
                                  │  Node.js ESM + jose    │
                                  └───────────┬────────────┘
                                              │
                      ┌───────────────────────┼───────────────────────┐
                      ▼                       ▼                       ▼
            ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
            │   Student Role   │    │   Teacher Role   │    │    Admin Role    │
            ├──────────────────┤    ├──────────────────┤    ├──────────────────┤
            │ • Browse Courses │    │ • Course Studio  │    │ • Full OS Audit  │
            │ • Stripe / bKash │    │ • Live Sessions  │    │ • Moderate Posts │
            │ • Join G-Meet    │    │ • Attendance     │    │ • 5% Commission  │
            │ • Stream Lessons │    │ • Payout Wallet  │    │ • Settle Payouts │
            │ • Submit Tasks   │    │ • Grade Tasks    │    │ • Global Reports │
            └──────────────────┘    └──────────────────┘    └──────────────────┘
                                              │
                                              ▼
                             ┌─────────────────────────────────┐
                             │       MongoDB Atlas Cluster     │
                             │  (Native Driver + GridFS Bucket)│
                             └─────────────────────────────────┘
```

1. **`admin`**: System administrator and platform owner. Observes platform analytics, audits revenue transactions, finalizes monthly 5% commissions, approves teacher withdrawals, moderates listings, and exports platform-wide reports.
2. **`teacher`**: Educators and tutors. Owns course listings, creates curriculum modules, streams recorded video lectures via GridFS, conducts live classes with Google Meet, tracks student attendance, assigns coursework, and requests payouts.
3. **`student`**: Enrolled learners. Discovers courses, pays admission and monthly tuition through Stripe Checkout or bKash Checkout, attends live sessions, watches recordings with seekable Range streaming, and monitors attendance and grades.

---

## 3. Getting Started & Local Setup

### Prerequisites
- **Node.js**: v20.x or higher
- **npm**: v10.x or higher
- **MongoDB Atlas** account or local MongoDB instance
- **Firebase Project** with Email/Password & Google Auth enabled
- **Stripe Account** (Test Mode API Keys)
- *(Optional)* **bKash Sandbox** and **Google Cloud Console** OAuth 2.0 Client credentials

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/ahasana-ncs13/teachOS.git
   cd teachOS
   ```

2. **Install all dependencies (npm workspaces):**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**

   **Server Configuration (`server/.env`):**
   ```env
   PORT=5000
   NODE_ENV=development
   CLIENT_URL=http://localhost:5173,http://localhost:5174
   MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
   MONGODB_DB_NAME=teachOSDB
   FIREBASE_PROJECT_ID=your-firebase-project-id

   # Stripe Credentials
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...

   # bKash Sandbox (Optional)
   BKASH_APP_KEY=your_bkash_app_key
   BKASH_APP_SECRET=your_bkash_app_secret
   BKASH_USERNAME=your_bkash_username
   BKASH_PASSWORD=your_bkash_password
   BKASH_BASE_URL=https://tokenized.sandbox.bka.sh/v1.2.0-beta

   # Google Meet OAuth (Optional)
   GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your_client_secret
   GOOGLE_REDIRECT_URI=http://localhost:5000/api/course-management/google-meet/callback
   ```

   **Client Configuration (`client/.env`):**
   ```env
   VITE_API_URL=http://localhost:5000/api
   VITE_FIREBASE_API_KEY=your_api_key
   VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=your_firebase_project_id
   VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
   VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
   VITE_FIREBASE_APP_ID=your_app_id
   VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
   ```

4. **Run the Application:**
   ```bash
   # Run frontend and backend concurrently from root
   npm run dev
   ```
   - Frontend client: `http://localhost:5173`
   - Backend API: `http://localhost:5000`
   - Health check: `http://localhost:5000/api/health`

---

## 4. Implementation Details

### 4.1 Technology Stack & Selection Justifications

| Layer | Technologies Selected | Justification & Architectural Value |
|---|---|---|
| **Frontend Framework** | **React 19.2 + Vite 8.2** | React 19 provides superior rendering performance and stable form transitions. Vite 8 delivers sub-second HMR and rapid production bundling (built in <600ms). |
| **Routing & State** | **React Router 7.1 + Context API** | Declarative nested routing with strict role-based `<ProtectedRoute>` wrappers. Modular contexts (`AuthContext`) eliminate state bloat without needing heavyweight external state libraries. |
| **Styling & Icons** | **Tailwind CSS v4 + React Icons 5.7** | Utility-first responsive design combined with high-contrast, accessible UI cards, modal sheets, and standard Feather/FontAwesome vector icons. |
| **Backend Runtime** | **Node.js (ESM) + Express 5.1** | Native ES Modules (`import/export`) align with modern JavaScript standards. Express 5 natively handles asynchronous promise rejections without redundant try/catch wrappers. |
| **Database & ODM** | **MongoDB Atlas + Official MongoDB Driver 7.6** | Directly uses the official MongoDB native driver without Mongoose. This avoids Mongoose schema overhead, unlocks raw aggregation pipeline performance, and supports atomic GridFS video streaming. |
| **File / Video Storage** | **MongoDB GridFS (`courseVideos` bucket)** | Chunked internal binary streaming with HTTP 206 Partial Content support (allowing video scrubbing/seeking up to 200MB) without relying on expensive third-party CDNs like Cloudinary. Also supports external video embeds (YouTube, Vimeo, Google Drive). |
| **Authentication** | **Firebase Authentication + jose (RS256 JWKS)** | Client authenticates via Firebase SDK (Email/Password + Google Popup). The Express backend validates token signatures locally using Google's public JSON Web Key Set (JWKS) via `jose`, preventing token spoofing without server credential files. |
| **Payment Gateways** | **Stripe (Subscription & Elements) + bKash (v1.2.0-beta)** | Stripe handles international card payments with automatic recurring billing and cryptographic webhooks. bKash Tokenized Checkout handles mobile financial service payments native to Bangladesh. |
| **Live Sessions** | **Google Meet API + Calendar v3 Integration** | Direct OAuth 2.0 integration to generate official Google Meet links via Calendar API, paired with resilient manual link fallbacks. |
| **Version Control** | **Git + GitHub** | Feature branch workflows, semantic commit histories, and conflict resolution across workspaces. |

---

### 4.2 Implemented Modules & Status Matrix

| Module | Status | Implementation Details |
|---|:---:|---|
| **Authentication & Authorization** | **Completed** | Firebase client authentication, backend token verification via `jose`, automated DB profile creation, and RBAC middleware (`admin`, `teacher`, `student`). |
| **Admin Dashboard** | **Completed** | Full platform analytics, gross volume metrics, 5% commission monitoring, teacher withdrawal settlement, user directory, listing bans/moderation. |
| **Teacher Dashboard & Studio** | **Completed** | Course publishing, live session scheduling, enrolled student roster, assignment management, attendance tracking, earnings wallet. |
| **Student Portal** | **Completed** | Enrolled courses view, lecture video player with progress tracker, Google Meet live access, assignment submissions, course fee payments. |
| **Course & Batch Listings** | **Completed** | Course blueprint (`courses`) mapped to active cohort listings (`listings`). Supports admission fee, monthly tuition, seat capacity, days, and times. |
| **Recorded Video Classes** | **Completed** | MongoDB GridFS chunked streaming with HTTP Range (206) support. YouTube, Vimeo, and Google Drive embed parsing. Lesson progress tracking. |
| **Live Classes (Google Meet)** | **Completed** | Google OAuth2 token exchange with Calendar API v3 to auto-generate Meet rooms. Manual link fallback and meeting status tracking. |
| **Attendance Management** | **Completed** | Dual-mode teacher interface (Course Cohorts + Classroom Roster). Supports `present`, `absent`, `late`, `excused`. Prevents duplicates via `bulkWrite` upsert. Student rate calculation excludes excused sessions. Admin global view & CSV export. |
| **Assignments & Workload** | **Completed** | Teacher creates assignments with deadlines. Student uploads submissions. Teacher reviews and grades submissions. Real-time submission status tracking. |
| **Payment System (Stripe & bKash)** | **Completed** | Dual-gateway integration. Stripe Checkout session with signed webhooks (`invoice.paid`, `checkout.session.completed`). bKash checkout API tokenization. |
| **Teacher Commission & Payouts** | **Completed** | Strict 95% teacher / 5% platform split in minor units (paisa). Calendar-month holding rule (earnings pending until 1st of subsequent month). Admin commission finalization. |
| **Notification Center** | **Completed** | Bell icon dropdown in topbar with unread counters, auto-polling, one-click "Mark all as read", and system audit log events. |
| **Reports & Analytics** | **Completed** | Course performance reports, teacher leaderboards, CSV exports for attendance and transactions, student progress calculations. |

---

### 4.3 Security & Identity Implementation

1. **Cryptographic Token Verification**:
   - Private API routes enforce the `verifyToken` middleware.
   - Incoming `Bearer <token>` headers are verified using Google's remote JWKS (`https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`) via `jwtVerify` from `jose`.
   - Algorithm `RS256`, token issuer, and audience (`FIREBASE_PROJECT_ID`) are strictly checked. Client-supplied roles in request payloads are never trusted.

2. **Role-Based Access Control (RBAC)**:
   - `requireRole('admin' | 'teacher' | 'student')` protects sensitive mutations.
   - Teachers can only read and mutate their own courses, listings, and payout requests (`teacherUid === req.authUid`).
   - Students can only view their own enrollments, submissions, and payment records (`studentUid === req.authUid`).
   - The `admin` role has system-wide moderation and audit rights across all records.

3. **NoSQL Injection & Input Sanitization**:
   - `assertNoOperatorInjection()` recursively scans every request parameter, body, and query string, rejecting any key containing `$` or `.`.
   - `sanitizeInput(body, allowedWhitelist)` discards or rejects unexpected fields.
   - IDs are validated via `isValidObjectId()` before converting to MongoDB `ObjectId`.

4. **Security Headers & Rate Limiting**:
   - Security middleware injects `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection: 1; mode=block`, and strict CORS policies.
   - Sliding-window in-memory rate limiter caps excessive calls to sensitive endpoints.

5. **Financial & Data Integrity**:
   - Destructive deletions are implemented as soft deletes (`status: "removed"`, `removedAt`, `removedBy`).
   - All financial amounts are calculated and stored in integer minor units (paisa/cents) to eliminate JavaScript floating-point rounding errors.
   - Every state mutation writes a permanent record into the `auditLogs` collection (`actorUid`, `actorRole`, `action`, `targetType`, `targetId`, `meta`, `createdAt`).

---

### 4.4 GitHub & Team Development Process

- **Repository**: [https://github.com/ahasana-ncs13/teachOS.git](https://github.com/ahasana-ncs13/teachOS.git)
- **Primary Branch**: `main`
- **Team Collaboration Model**: 2 Core Full-Stack Developers

#### Team Responsibilities
| Developer | Key Responsibilities |
|---|---|
| **Ahasan (`ahasana-ncs13`)** | Backend architecture, MongoDB schema optimization, Stripe & bKash payment verification, calendar-month settlement scheduler, dual-mode Attendance System, listing moderation. |
| **Hridoy (`hridoyncs0464`)** | Frontend page layouts, Tailwind styling, Student Portal experience, modal dialogues, Legal/Error pages, payment method chooser modal, and git merge synchronization. |

#### Commit History & Workflow Examples
The team utilized feature-based commits with atomic pull requests and merge conflict resolutions:
- `270defa`: *implemented attendance tab for both student and teacher dashboard*
- `c2a6944`: *solved listing course name highlighting and batch display*
- `f91b6bd`: *solved listing problem (sanitization whitelist correction)*
- `0537862`: *feat: add payment method selection modal and integrate with enrollment process*
- `d34c85b`: *fix: resolve merge conflicts in 3 client JSX files*
- `e52e3aa`: *updated google meet and stripe payment integration*
- `7f0bf38`: *Add LegalPage and update authentication-related pages and styles*

---

### 4.5 Key Implementation Challenges & Solutions

#### Challenge 1: MongoDB Strict API Version 1 Scheduler Crash
- **Problem**: When starting the server with `serverApi: { version: ServerApiVersion.v1, strict: true }`, the background financial settlement scheduler crashed with:
  `Provided apiStrict:true, but the command distinct is not in API Version 1`
- **Root Cause**: The settlement service invoked `revenueTransactions.distinct('paymentMonth')`. MongoDB's strict Version 1 specification deprecated the standalone `distinct` command in favor of aggregation pipelines.
- **Solution**: Replaced the `distinct()` call with an aggregation pipeline (`$match` + `$group: { _id: '$paymentMonth' }`) and set `strict: false` in `server/src/db.js`.

#### Challenge 2: Cold-Start Race Condition on Database Connection
- **Problem**: During cold starts on local or cloud hosting, rapid client requests to `/api/notifications` or `/api/courses` immediately failed with `HTTP 500: MongoDB has not been connected`.
- **Root Cause**: Express called `app.listen(port)` before the asynchronous `connectDatabase()` connection to MongoDB Atlas had fully resolved.
- **Solution**: Added a global database readiness guard middleware in `server/src/index.js`. Any request arriving during connection warmup receives a `503 Service Unavailable (DATABASE_INITIALIZING)` response, allowing clients to cleanly retry without throwing uncaught server errors.

#### Challenge 3: Whitelist Sanitization Mismatch on Listing Creation
- **Problem**: When teachers submitted new course listings from the frontend modal, the request was rejected with `HTTP 400 Bad Request: Unknown field: 'fee' is not allowed`.
- **Root Cause**: The client modal passed `fee` alongside `admissionFee` and `monthlyTuitionFee` for backward compatibility with payment calculations. However, the server's strict `sanitizeInput` allowed-fields whitelist omitted `'fee'`.
- **Solution**: Added `'fee'` to the allowed whitelist in `server/src/routes/listing.routes.js` for both `POST /listings` and `PUT /listings/:id`, and registered it as an optional number rule in `validateSchema()`.

#### Challenge 4: Duplicate Attendance Records on Repeated Saves
- **Problem**: When teachers marked attendance, left, and reopened the session to update a student's status, the previous implementation appended new records using `insertMany()`, causing duplicate rows and corrupting attendance statistics.
- **Root Cause**: Lack of compound key uniqueness in database operations.
- **Solution**: Refactored `recordSessionAttendance()` in `server/src/services/courseManagement.service.js` to execute a MongoDB `bulkWrite` with `updateOne` + `upsert: true` matching `{ listingId, sessionId, studentUid }`. This ensures idempotent saves and seamless editing.

---

## 5. Testing & Verification

### 5.1 Testing Environment

| Component | Test Environment Specification |
|---|---|
| **Operating System** | Windows 11 Pro (x64) |
| **Browsers** | Google Chrome 131, Microsoft Edge 131 |
| **Node.js Environment** | Node.js v20.18.0 (ESM mode) |
| **Database Engine** | MongoDB Atlas v7.0.x (Replica Set cloud cluster) |
| **Payment Sandboxes** | Stripe Test Mode (Card 4242...), bKash Tokenized Sandbox |
| **Automated Test Runners**| Node.js Native Test Runner (`node --test`), Vite Production Compiler |

---

### 5.2 Formal Test Cases (TC-01 to TC-15)

| Test ID | Test Scenario | Execution Step | Expected Result | Actual Result | Status |
|:---:|---|---|---|---|:---:|
| **TC-01** | **User Registration & Profile Provisioning** | Submit name, email, password, and role (`teacher` or `student`) via `/register`. | Account is created in Firebase Auth; profile document is upserted in MongoDB `users` collection. | Account created; redirected to respective workspace with correct role claim. | **PASSED** |
| **TC-02** | **Role-Based Login Redirection** | Log in with registered teacher credentials. | System resolves role from verified token and navigates to `/dashboard`. | Teacher workspace loaded; token stored in AuthContext; sidebar displays teacher tools. | **PASSED** |
| **TC-03** | **Invalid Authentication Handling** | Submit incorrect password on `/login`. | Request is blocked by Firebase Auth; descriptive error message displayed. | "Invalid credential" toast alert displayed; no session established. | **PASSED** |
| **TC-04** | **Course Creation by Teacher** | Complete and submit "Create Listing" modal with batch name, course, days, and fee. | Listing saved in `listings` collection; listing count increases on dashboard. | Listing created with HTTP 201; course card immediately visible in My Listings. | **PASSED** |
| **TC-05** | **Public Course Discovery & Filter** | Visit `/` and filter listings by category (e.g. "Online"). | Course grid dynamically re-renders with matching listings. | Only matching courses displayed; cards show course name, batch title, and fee. | **PASSED** |
| **TC-06** | **Stripe Payment & Immediate Access** | Student pays tuition fee via Stripe Test Card (`4242...`). | Stripe webhook triggers; payment record inserted; active enrollment granted. | Payment verified; student instantly sees course under "My Courses" at `/student`. | **PASSED** |
| **TC-07** | **bKash Payment Verification** | Student initiates bKash payment via Sandbox API. | Gateway verifies transaction ID; database records verified payment; enrollment activated. | Transaction status set to `paid`; course unlocked for the billing period. | **PASSED** |
| **TC-08** | **5% Platform / 95% Teacher Split** | Process a ৳1,000 course payment. | Gross = ৳1,000; Admin Commission = ৳50 (5%); Teacher Pending = ৳950 (95%). | Recorded in `revenueTransactions` and `teacherWallets` in integer minor units (paisa). | **PASSED** |
| **TC-09** | **Calendar-Month Settlement Rule** | Evaluate holding period for November payments. | Earnings remain in `pendingBalance` until December 1, then transition to `availableBalance`. | Tested via `settlementScheduler.service.test.js`; scheduler releases balance on day 1. | **PASSED** |
| **TC-10** | **Live Session & Google Meet Link** | Teacher creates live session with scheduled time. | Session recorded in `liveSessions`; Google Meet link attached; students notified. | Session shows in student calendar; "Join Class" button redirects to valid Meet link. | **PASSED** |
| **TC-11** | **Attendance Marking & Idempotency** | Teacher marks students as Present, Absent, Late, Excused, then re-saves. | Records upserted in `sessionAttendance`; duplicates prevented; audit log generated. | Zero duplicate records; updated status reflected in student attendance summary. | **PASSED** |
| **TC-12** | **Attendance Percentage Calculation** | Student has 1 Present, 1 Absent, 1 Late, 1 Excused session. | Rate = $\frac{1 + 1}{4 - 1} \times 100 = 67\%$; excused session is not penalized. | Student dashboard correctly displays 67% attendance rate; excused listed separately. | **PASSED** |
| **TC-13** | **Recorded Video Streaming (GridFS)** | Student plays uploaded course video lesson. | Server streams binary video via HTTP 206 Partial Content with Range headers. | Video streams smoothly in player; forward/backward seeking works without buffering freeze. | **PASSED** |
| **TC-14** | **Assignment Submission & Review** | Student uploads assignment text; teacher reviews. | Record inserted in `assignmentSubmissions`; teacher sees submission in review list. | Submission status switches to "Submitted"; student dashboard updates progress. | **PASSED** |
| **TC-15** | **Unauthorized Access Prevention** | Student attempts `GET /api/admin/attendance` or attempts updating another teacher's course. | Server rejects request with HTTP 403 Forbidden (`INVALID_ACCOUNT_ROLE`). | Request blocked; central error handler returns structured JSON without stack trace. | **PASSED** |

---

### 5.3 Production Bug Reports & Resolutions

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ BUG-01 [CRITICAL]: MongoDB Strict API Version 1 Scheduler Crash                        │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ Discovery: Server crashed on startup during monthly settlement job execution.          │
│ Error: "Provided apiStrict:true, but the command distinct is not in API Version 1"    │
│ Root Cause: distinct() command is not allowed in strict mode of MongoDB API Version 1. │
│ Resolution: Replaced with aggregate([{$match}, {$group}]) and set strict: false.       │
│ Status: RESOLVED & VERIFIED IN PRODUCTION                                             │
└────────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────────────────┐
│ BUG-02 [HIGH]: Cold-Start Unhandled Error (HTTP 500)                                   │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ Discovery: Early requests to /api/notifications failed with HTTP 500 on server reboot. │
│ Error: "MongoDB has not been connected"                                                │
│ Root Cause: app.listen() started serving traffic before connectDatabase() resolved.   │
│ Resolution: Introduced database readiness middleware returning HTTP 503 during warmup. │
│ Status: RESOLVED & VERIFIED IN PRODUCTION                                             │
└────────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────────────────┐
│ BUG-03 [HIGH]: Listing Creation Whitelist Rejection (HTTP 400)                         │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ Discovery: Teacher unable to save listing from TeacherListingsPage.jsx:308.            │
│ Error: "UNKNOWN_FIELD: Unknown field: 'fee' is not allowed"                           │
│ Root Cause: sanitizeInput whitelist omitted 'fee' field sent by the client modal.      │
│ Resolution: Added 'fee' to sanitizeInput allowed fields and validateSchema rules.      │
│ Status: RESOLVED & VERIFIED IN PRODUCTION                                             │
└────────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────────────────┐
│ BUG-04 [MEDIUM]: Duplicate Session Attendance Records on Edit                          │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ Discovery: Re-marking attendance created duplicate records in sessionAttendance.       │
│ Error: Aggregation counted multiple rows for the same student in the same session.    │
│ Root Cause: Service called insertMany() instead of upserting on composite key.         │
│ Resolution: Refactored to bulkWrite with updateOne upsert on (listingId, sessionId,   │
│             studentUid). Added excused status handling and CSV export.                 │
│ Status: RESOLVED & VERIFIED IN PRODUCTION                                             │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

### 5.4 QA Test Execution Summary

```
========================================================================
                      TeachOS QA Test Execution Summary
========================================================================
  Test Category                  Total Tests   Passed   Failed   Blocked
------------------------------------------------------------------------
  Payment & Revenue Split             9           9        0        0
  Financial Settlement Scheduler      6           6        0        0
  Security & Access Control           3           3        0        0
  Dual-Mode Attendance System         5           5        0        0
------------------------------------------------------------------------
  TOTAL VERIFIED TEST SUITES         23          23        0        0
  Vite Production Build              1           1        0        0 (581ms)
========================================================================
  OVERALL QA STATUS: 100% PASSED (PRODUCTION READY)
========================================================================
```

---

## 6. Demonstration & Presentation Guide

### 6.1 Role-Based Live Walkthrough

#### 1. Student Workflow Walkthrough
1. **Discovery**: Open the Home Page (`/`), browse the public course catalog, search by keyword, and filter by "Online" or "Offline".
2. **Details & Fee Breakdown**: Click **See details** on any course card. Observe the transparent fee presentation (admission fee vs. monthly tuition fee).
3. **Enrollment & Payment**: Click **Enroll Now**. Select Stripe Checkout (Card) or bKash. Complete payment in sandbox mode.
4. **My Courses & Lessons**: Navigate to `/student`. View the newly unlocked course. Open `/student/course/:listingId/learn` to watch high-definition video lessons with Range seeking.
5. **Live Classroom & Attendance**: Check scheduled Google Meet live sessions. Navigate to `/student/attendance` to view personal attendance history, excused exemptions, and overall percentage.

#### 2. Teacher Workflow Walkthrough
1. **Teaching Studio**: Log in as a teacher and navigate to `/dashboard`. Observe metrics for active listings, total students, and current wallet balance.
2. **Course Creation**: Navigate to `/dashboard/listings` and open **+ Create Listing**. Fill in batch name, schedule, fees, and capacity. Save and publish.
3. **Live Class Scheduling**: Open `/dashboard/teaching-studio` -> **Live Classes**. Schedule a session with topic and date.
4. **Taking Attendance**: Open `/dashboard/attendance`. Under **Course Cohort Sessions**, select the batch and session. Click **Mark all present**, toggle specific students to **Late** or **Excused**, and click **Save Attendance**.
5. **Exporting Records**: Click **Export CSV** to download a spreadsheet of attendance data.
6. **Payout Requests**: Navigate to `/dashboard/payments`. View pending earnings (held until the 1st of the following month) and available balance.

#### 3. Admin Workflow Walkthrough
1. **System Governance**: Log in as administrator (`/admin`). Review platform gross volume, monthly commissions, and active user directory.
2. **Listing Moderation**: Open `/admin/classes`. Review published courses. Ban an inappropriate listing to immediately remove it from public discovery while preserving financial audit records.
3. **Financial Settlement**: Inspect `/admin/payments`. View the 5% platform commission accumulation. Trigger monthly commission finalization.
4. **Platform-Wide Attendance**: Navigate to `/admin/attendance`. View the overall attendance rate across all cohorts, review course performance tables, search for specific students, and export the platform attendance audit CSV.

---

### 6.2 Project Results & Verification Criteria

- **Are all 13 core modules functional?** Yes. All modules (Authentication, Listings, Payments, Attendance, Studio, GridFS Video, Submissions, Commissions, Notifications, etc.) are implemented and verified.
- **Can real students and teachers interact?** Yes. Teachers create courses and take attendance; students enroll, pay, attend live classes, and watch recordings.
- **Does payment verification prevent spoofing?** Yes. Access is granted only after server-side verification of Stripe webhooks or bKash verification endpoints.
- **Is the attendance system active and deduplicated?** Yes. Includes real-time calculation, excused absence handling, and duplicate prevention via MongoDB upserts.

---

### 6.3 System Limitations & Future Roadmap

#### Current Version Limitations
1. **Google Meet Attendance Synchronization**: Automatic participant duration retrieval requires Google Workspace Enterprise Education audit logs. In the current standard tier, attendance is marked through the teacher's interactive portal.
2. **Internal Video Storage Cap**: MongoDB GridFS chunked streaming is currently capped at 200MB per video file. Teachers are encouraged to link external YouTube/Vimeo unlisted links for multi-hour lectures.
3. **Local Disbursement**: Payout requests are recorded and settled on the platform ledger. Real bank disbursement requires manual bank/MFS wire transfer outside the system.

#### Future Engineering Roadmap
- [ ] **Mobile Application (React Native)**: Native iOS and Android apps for mobile attendance and offline lesson downloads.
- [ ] **AI-Powered Learning Assistant**: Gemini 2.0 Flash integration to answer student questions based on lesson transcripts and lecture notes.
- [ ] **Automated Google Meet Webhook Tracking**: Server-side Webhook listeners for automated join/leave duration capture via Google Workspace Events API.
- [ ] **Automated Bank Payout Integration**: Direct BEFTN / bKash B2C disbursement gateway integration for automated teacher payouts.

---

### 6.4 Project Repository & Delivery Information

- **GitHub Repository**: [https://github.com/ahasana-ncs13/teachOS.git](https://github.com/ahasana-ncs13/teachOS.git)
- **Live Production URL**: Hosted on Render / Vercel cloud environment
- **Development Team**: Ahasan (`ahasana-ncs13`) & Hridoy (`hridoyncs0464`)
- **Documentation & References**:
  - [MongoDB Node.js Driver Official Documentation](https://www.mongodb.com/docs/drivers/node/current/)
  - [Stripe API & Webhook Specifications](https://stripe.com/docs/api)
  - [bKash Tokenized Checkout API v1.2.0-beta Guide](https://developer.bka.sh/)
  - [Firebase Auth REST & Token Verification with jose](https://github.com/panva/jose)
  - [Google Calendar API v3 Conference Data Documentation](https://developers.google.com/calendar/api/v3/reference/events)

---

*TeachOS — Developed with modern software engineering practices, rigorous security standards, and comprehensive end-to-end verification.*
