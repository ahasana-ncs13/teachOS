# TeachOS

TeachOS is a MERN monorepo for managing teaching workspaces, courses, and learners.

## Stack

- `client`: React + Vite, React Hook Form, Axios, React Icons, Firebase Auth context
- `server`: Express API with MongoDB-ready route structure
- npm workspaces for one-command development

## Start

```bash
npm install
copy client/.env.example client/.env
npm run dev
```

The client runs at `http://localhost:5173` and the API at `http://localhost:5000`.
Firebase email/password authentication is configured through `client/.env`. New accounts receive a verification email and cannot enter `/dashboard` until the email is verified. Restart Vite after changing environment values because they are loaded at startup.

In Firebase Console, enable **Authentication > Sign-in method > Email/Password** and add your local app domain under **Authentication > Settings > Authorized domains** if needed. Set `FIREBASE_PROJECT_ID` in `server/.env` to the same project ID configured in `client/.env`; the server verifies Firebase ID tokens and only allows access to records owned by the signed-in account. In local demo mode, demo records are only enabled when `NODE_ENV` is not `production`. If `server/.env` does not exist, create it from `server/.env.example`; if it already exists, keep its `MONGODB_URI` and add `FIREBASE_PROJECT_ID` without replacing the file.

Teacher workspace data is saved through the Express API to MongoDB. The server automatically creates the `users`, `teacherDashboards`, `classes`, `students`, `attendanceRecords`, `lessonSessions`, `payments`, `payoutRequests`, `messages`, `officeHours`, and `resources` collections and their indexes on startup; GridFS creates its `resources.files` and `resources.chunks` collections when a file is uploaded. No manual collection creation is required.

On first use, a teacher account receives clearly marked starter classes, students, and finance records. New classes, student profiles and enrollments, attendance sessions, lesson starts, payment records, payout requests, messages, office hours, and teaching resources are saved under that account. Uploaded resource files (up to 10 MB) are stored in MongoDB GridFS. Payout requests are stored for review only and do not initiate money transfers.

Use **Attendance** in the teacher workspace to take attendance by class and date, record students as present, absent, or late, review class attendance averages, and identify students below the 85% attendance threshold.