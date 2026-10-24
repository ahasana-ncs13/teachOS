PROJECT: TeachOS, an online teaching and course management portal.
STACK: npm workspaces. client = React 19 + Vite + React Router 7 + Axios + Tailwind 4 + plain CSS files. server = Node ESM + Express 5 + official MongoDB driver (NO Mongoose) + dotenv + cors. Auth = Firebase Authentication (client) with Firebase ID tokens verified on the server.

SIMPLIFIED 3-ROLE ARCHITECTURE
- Roles:
  1. `admin`: The TeachOS platform owner (us). Observes the whole OS, platform analytics, teacher payouts, directory, settings, and moderate listings.
  2. `teacher`: Educators / clients who publish courses & offline batches, manage classrooms, conduct live attendance, and request payouts.
  3. `student`: Learners who browse courses, view details, enroll in batches, and track their enrollments.
- Security & Identity:
  - Take user identity (role, uid, email) from verified Firebase tokens + the user's DB record. Never trust client-supplied roles.
  - Teachers own and manage their own listings (`teacherUid` / `email`).
  - Students own and view their own enrollments (`studentUid` / `email`).
  - Admins have system-wide visibility and moderation privileges.

SECURITY RULES
1. Every private route uses the `verifyToken` middleware. Public browsing routes (like GET /api/listings and GET /api/health) remain accessible.
2. Role checks live in middleware (`requireRole`). Admin passes all role checks.
3. Validate every body, query, and param. Reject unknown fields and MongoDB operator injection. Cap pagination (limit max 100, default 20).
4. Destructive actions are soft deletes (`status: "removed"`, `removedAt`, `removedBy`).
5. Every mutation writes an entry to `auditLogs` { actorUid, actorRole, action, targetType, targetId, meta, createdAt }.
6. Responses use projections to avoid leaking sensitive internal fields.
7. Central error handler returning `{ message, code }` with no client stack traces.
8. Security headers & rate limiter enabled.
9. Payments and payouts are RECORDS ONLY. Nothing moves real money.

CODE STYLE: Small modular files in `server/src/middleware`, `server/src/routes`, `server/src/services`, `server/src/utils`. Reuse existing db helper. Do not rename or break existing teacher-workspace routes.