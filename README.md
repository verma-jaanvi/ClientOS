# ClientOS v0

Agencies publish deliverables; clients approve or request changes from an email link (no account); every decision is recorded. This is a build of the *ClientOS Build-Along Guide* (Parts 0 to 10).

```
clientos/
  web/   React + Vite + TypeScript + Tailwind + React Router  (agency screens + client pages)
  api/   Node + Express 5 + TypeScript + Zod + Prisma         (owns DB, storage, email)
```

Nothing but the API talks to Postgres, storage or the email service. Staff log in with Supabase Auth; clients use your own signed magic-link tokens.

## What is implemented

| Guide part | Where |
|---|---|
| 0 Setup, health route, CORS for your front end only | `api/src/app.ts` |
| 1 Data model, enums, seed, append-only decision | `api/prisma/schema.prisma`, `api/prisma/seed.ts` |
| 2 Sign-up (transactional), login check, admin role, invites, settings | `routes/auth.ts`, `routes/workspace.ts`, `middleware/staffAuth.ts` |
| 3 Clients, contacts, notes, search, projects, milestones, archive | `routes/clients.ts`, `routes/projects.ts` |
| 4 Deliverables, direct-to-storage upload, versions, share, trail, signed downloads, progress updates | `routes/deliverables.ts`, `routes/projects.ts` |
| 5 Magic links (hashed), client middleware, view/approve (idempotent), revoke, friendly expired page | `middleware/clientAuth.ts`, `routes/clientPortal.ts`, `web/.../ClientApp.tsx` |
| 6 Change/document/question requests, one reply, impact, close | `routes/requests.ts`, `routes/clientPortal.ts` |
| 7 Audit log written in the same transaction, rate limits, security checklist | `services/audit.ts`, `app.ts` |
| 8 Emails (HTML + text templates), retry queue with failure records, weekly digest, preview, per-client toggle | `services/email.ts`, `services/digest.ts`, `jobs/digest.ts` |

Small additions beyond the guide's table list: a `deliverable_versions` table (versions must be kept), an `invites` table (invite flow), and an `email_failures` table (record failed sends).

## 1. Supabase setup

1. Create a project (use a separate one for production).
2. **Auth**: enable Email provider (email + password). The API creates users with the admin API and marks them confirmed, so email confirmation is not needed.
3. **Storage**: create two buckets:
   - `deliverables` — **private**. Set a file size limit you are comfortable with (e.g. 50 MB).
   - `logos` — **public** (agency logos are branding and appear in emails).
4. Copy: project URL, `anon` key, `service_role` key, and the database connection strings (pooled + direct).

## 2. Configure

```bash
cp api/.env.example api/.env     # fill in every value
cp web/.env.example web/.env     # API url, Supabase URL, anon key
```

Generate the link secret: `openssl rand -base64 48` -> `MAGIC_LINK_SECRET`.
Never commit `.env` files (already in `.gitignore`). The service-role key belongs only in `api/.env`.

## 3. Install, migrate, seed, run

```bash
npm run install:all        # installs api and web (runs prisma generate)
cd api && npx prisma migrate dev --name init
```

Optional hardening, run once in the Supabase SQL editor after the first migration:
`api/prisma/sql/append_only.sql` (DB-level append-only for `approvals` and `audit_log`) and `api/prisma/sql/rls.sql` (row-level security as a second net).

```bash
npm run seed               # one workspace, staff user, 2 clients + contacts, 1 project, 2 deliverables
npm run dev:api            # http://localhost:4000/api/health -> {"status":"ok"}
npm run dev:web            # http://localhost:5173
```

Seed login: `demo@northwind.test` / `ChangeMe123!` (override with `SEED_EMAIL`, `SEED_PASSWORD`).

With no Resend key, set `DEV_LOG_EMAILS=true` (non-production only): emails, including magic links, are printed in the API console so you can click through the whole loop locally. This is the only place a raw token is ever printed, and it is disabled in production.

## 4. Try the full loop

1. Log in with the seed user, open **Acme Logistics** -> project -> **Homepage design v2**.
2. Upload a file, click **Share with client**. Copy the link from the console (or the email).
3. Open the link in a phone-sized window, type a name, **Approve**. Reload: approved state shows. The agency trail now shows the approval.
4. On another deliverable, use **Request changes** from the client page. The deliverable flips to *Changes requested*. In **Requests**, reply with impact and a decision. Upload a new version and share again: back to *Shared*.
5. Client page -> **Create project link** gives a client home page (updates, statuses, requests).
6. Client page -> **Send me a test** previews the weekly digest.

## 5. API summary

Staff (header `Authorization: Bearer <supabase token>`): `/api/me`, `/api/workspace[...]`, `/api/clients[...]`, `/api/contacts/:id`, `/api/projects/:id[...]`, `/api/milestones/:id`, `/api/deliverables/:id[...]` (`upload-url`, `versions`, `share`, `trail`), `/api/files/:versionId/download-url`, `/api/links/:id/revoke`, `/api/requests[...]`.
Public: `POST /api/auth/signup`, `GET /api/auth/invite/:token`, `POST /api/auth/accept-invite`, `GET /api/health`.
Client (header `x-magic-token: <token>`): `GET /api/c/view`, `GET /api/c/files/:versionId`, `POST /api/c/approve`, `GET|POST /api/c/requests`.

## 6. Security rules and where they live

- Every agency query uses **id + workspaceId together**; another workspace's id returns 404.
- `/api/c/*` reads only `x-magic-token`; staff routes read only `Authorization`. Neither works on the other.
- Magic links store only an HMAC hash, carry a scope (one deliverable or one project), expire (`LINK_TTL_DAYS`, default 14), can be revoked, and are rejected for archived clients.
- Client responses are built with explicit `select`s: no internal notes, no other clients, no drafts, only published updates.
- Zod validates every body; roles enforced in the API (`requireAdmin`).
- Approval is idempotent (unique `deliverable+version`, second tap returns the stored record).
- Audit entries are written inside the same transaction as the action. No update/delete routes exist for `approvals` or `audit_log`.
- Rate limits: sign-up and invite acceptance, the approve route, plus general client/staff limits. Log-in is handled and limited by Supabase Auth.
- Files only move through short-lived signed URLs; the deliverables bucket is private.
- Logs: only error messages are logged, never bodies, headers or tokens.

## 7. Deploy (Part 9)

1. **API** (Render/Railway): build `npm install && npm run build`, start `npm start`. Set every variable from `api/.env.example`; set `APP_URL` to the deployed front end.
2. Run `npx prisma migrate deploy` against the **production** Supabase project, then the optional SQL files.
3. **Front end** (Vercel/Netlify): root `web`, build `npm run build`, output `dist`. Set `VITE_*` variables. Add an SPA rewrite of all paths to `/index.html` (needed for `/c/:token`).
4. Verify a sending domain in Resend, set `RESEND_API_KEY` and `EMAIL_FROM`, remove `DEV_LOG_EMAILS`.
5. **Weekly digest**: create a scheduled job running `npm run digest:prod` (e.g. Mondays 09:00).
6. Turn on automatic DB backups; write down the restore steps. Add error tracking and an uptime check on `/api/health`.
7. Re-run the security checklist against the live site.

## 8. Troubleshooting

| Symptom | Check |
|---|---|
| Front end cannot reach API | `APP_URL` (CORS) in the API and `VITE_API_URL` in the web app |
| Staff routes 401 | Session present; `VITE_SUPABASE_*` correct; service-role key set in API |
| Link says expired at once | `LINK_TTL_DAYS`, server clock |
| Uploads fail | Bucket names match `FILES_BUCKET`/`LOGOS_BUCKET`, bucket size limit |
| Prisma migrate hangs on Supabase | Use `DIRECT_URL` (port 5432), not the pooler |
| No emails | `RESEND_API_KEY`/verified domain; see `email_failures` table |

## 9. Known limits (v0, by design or noted)

- Sign-up creates the Supabase login first, then the DB rows in one transaction; if the DB part fails the login is deleted (a login cannot join a Postgres transaction).
- Attaching a file to a client request (shown in the mockup) is not built; the guide's endpoints do not cover it. Treat it as a v1 item.
- The email queue is in-process (3 attempts with backoff, failures recorded). It is fine for v0; move to a durable queue before scale.
- Clients are not told when a deliverable is auto-reopened by an edit after approval; staff should use Share again.
- **Not verified in the build environment:** the web app type-checks and builds. The API could not be compiled or run against a live Supabase there (Prisma engine download was blocked), so run `npm run typecheck` in `api/` after `npm install` and expect to fix small things on first run. Follow the checkpoints in the guide.
