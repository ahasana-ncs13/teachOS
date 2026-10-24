PROJECT: TeachOS, a multi-tenant online teaching platform.
STACK: npm workspaces. client = React 19 + Vite + React Router 7 + Axios + Tailwind 4 + plain CSS files. server = Node ESM + Express 5 + official MongoDB driver (NO Mongoose) + dotenv + cors. Auth = Firebase Authentication (client) with Firebase ID tokens verified on the server.

TENANCY MODEL
- A "platform" is one customer organisation that uses TeachOS (collection `platforms`).
- Roles: superAdmin (the TeachOS owner, platformId = null, sees everything), admin (one or more per platform, controls only their platform), teacher, student.
- Every tenant-owned document MUST have `platformId` (ObjectId). Never trust a platformId, role, uid or email sent by the client. Take them from the verified token + the user's DB record.
- superAdmin can create, view, suspend, reactivate, extend and soft-delete platforms. A platform that is suspended or whose renewal date + grace period has passed must be blocked for all its users (admin, teacher, student) with 403 code PLATFORM_SUSPENDED. superAdmin is never blocked. Admin may still call GET /api/admin/billing so they can see why they are blocked.

SECURITY RULES (apply to every route you write)
1. Every route except GET /api/health uses the verifyToken middleware.
2. Role and tenant checks live in middleware (requireRole, requirePlatformActive). Never inside handlers only.
3. Every Mongo query on tenant data includes { platformId: req.platform._id }. Write one helper for this so it cannot be forgotten.
4. Validate every body, query and param (use zod). Reject unknown fields. Validate ObjectIds. Cap pagination (limit max 100, default 20). Never pass raw req.query/req.body into a Mongo filter (operator injection).
5. Destructive actions are soft deletes (status: "removed", removedAt, removedBy). Admin cannot modify admins or themselves. Only superAdmin can create or remove admins.
6. Every mutation writes a row to `auditLogs` { platformId, actorUid, actorRole, action, targetType, targetId, meta, createdAt }.
7. Responses never include secrets, other tenants' data, or fields not needed by the UI (use projections).
8. Consistent errors: { message, code } with correct HTTP status. Central error handler. No stack traces to the client.
9. Add helmet, express-rate-limit (stricter on write routes), express.json({ limit: "100kb" }).
10. Payments and payouts are RECORDS ONLY. Nothing here moves real money.

CODE STYLE: follow the existing style in server/src. Small files: server/src/middleware, server/src/routes, server/src/services, server/src/validators, server/src/utils. Reuse the existing db helper and auth code. Do not rename or delete existing teacher-workspace routes. Do not run destructive commands. Never print or commit real secrets from .env.

WORKFLOW RULES: work only on the current stage. Make the smallest change that satisfies it. After finishing, run `npm run lint` and `npm run build` if they exist, start the server once to confirm it boots, then give a short report: files changed, new endpoints, how I test each, anything you were unsure about. Ask before changing anything outside the stage. 