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

In Firebase Console, enable **Authentication > Sign-in method > Email/Password** and add your local app domain under **Authentication > Settings > Authorized domains** if needed.