# CivicPulse — Node.js + Express + MySQL

This project keeps the supplied CivicPulse HTML/CSS design and replaces browser-only `localStorage` data with a Node.js/Express API backed by MySQL. Passwords are bcrypt-hashed; login uses a signed JWT; SQL queries use prepared statements; admin-only endpoints verify the database role on the server.

## Requirements
- Node.js 18 or newer
- MySQL Server running locally
- MySQL Workbench (to run the SQL script and inspect tables)

## 1. Create the database
1. Open MySQL Workbench and connect to your local MySQL Server.
2. Open `database.sql` and execute the whole script (lightning bolt).
3. It creates the `civicpulse` database and `users`, `reports`, `redemptions`, and `support_messages` tables.

## 2. Configure the backend
1. Open this folder in VS Code / terminal.
2. Copy `.env.example` to `.env`.
3. Update `DB_USER`, `DB_PASSWORD`, and, if needed, `DB_HOST` / `DB_PORT` to match your MySQL Server login.
4. Set `JWT_SECRET` to a long random secret (at least 32 characters). Change the example admin password before creating the admin.
5. Install packages:
   ```bash
   npm install
   ```
6. Create your admin account (role is stored in MySQL; do not use a hard-coded frontend password):
   ```bash
   npm run create-admin
   ```
7. Start the app:
   ```bash
   npm start
   ```
8. Open **http://localhost:3000**. Do not open `public/index.html` directly from the file system; the API needs the Node server.

## 3. Admin login
Use the email and password you configured in `.env` before running `npm run create-admin`. The old demo credentials shown in the HTML are informational only and are not accepted unless you deliberately create that admin with those credentials. Use a strong unique password.

## 4. Check database connection
Open `http://localhost:3000/api/health`. It should return `{"ok":true,"database":"connected"}`. After registering or submitting a report, refresh the tables in Workbench and run:
```sql
USE civicpulse;
SELECT id,name,email,role,created_at FROM users;
SELECT public_id,vehicle,violation,status,reward,created_at FROM reports;
SELECT public_id,coins,amount_inr,status FROM redemptions;
SELECT id,email,message,status,created_at FROM support_messages;
```

## Included API routes
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `PUT /api/profile`
- `GET /api/reports`, `POST /api/reports` (optional JPG/PNG/WEBP photo up to 5 MB)
- `GET /api/rewards/summary`
- `GET /api/redemptions`, `POST /api/redemptions`
- `POST /api/support`
- Admin-only: `GET /api/admin/summary`, `GET /api/admin/reports`, `PATCH /api/admin/reports/:publicId/status`, `GET /api/admin/citizens/:id`, `GET /api/admin/support`, `PATCH /api/admin/support/:id/status`, `GET /api/admin/redemptions`, `PATCH /api/admin/redemptions/:publicId/status`

## Notes
- Only the backend can accept/reject reports. Accepting a report awards 10 coins once; the backend rejects repeat review attempts.
- Redemption requests reserve coins while their status is `Requested`, `Approved`, or `Paid` to prevent spending the same balance twice. There is no payment processor connected; an admin must handle any actual payout separately.
- Photos are stored locally in `uploads/`. For production, use private object storage, TLS, backups, stricter CORS, and an admin workflow for redemption/support requests.
- If you already had data in `localStorage`, it is not automatically imported. The new source of truth is MySQL.
