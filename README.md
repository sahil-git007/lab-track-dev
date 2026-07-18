# LabTrack — Smart Lab Equipment Tracking

A full-stack lab equipment tracking system with real login, QR code
scanning, and multi-college data isolation by **college code**. Every
college's equipment, checkouts, and maintenance records are completely
separate from every other college's — same website, same login screen,
different data per college code.

## Important: this needs a live server, not just GitHub Pages

GitHub Pages only hosts static files — it can't run a login system or
store data. **Publishing to GitHub is still exactly what you should do**
(push this code as a repo, like any real project), but to make it actually
*run* with logins and a database, you deploy the backend to a free host
that keeps a Node process alive — see **Deploying** below. That's the
normal way real login-based sites work; nothing here is unusual.

## Roles

| Role | Can do |
|---|---|
| **Student** | Browse equipment, check out/return, report maintenance issues, scan QR codes |
| **Lab In-Charge** | Everything a Student can, plus: add/remove equipment, resolve maintenance reports |
| **Owner** | One global account (yours) — sees every user across every college, and can promote/demote or remove any account |

Everyone who registers starts as a **Student**. Only the **Owner** can
promote someone to Lab In-Charge, from the **Manage Users** tab (visible
only to the Owner). This is deliberate: it stops anyone from just
registering themselves as an admin.

## Your Owner account

On first run, the server creates one Owner account automatically using
environment variables:

```bash
OWNER_USERNAME=youradminname
OWNER_PASSWORD=a-real-password
```

**Set these before your first run.** If you don't, the server falls back
to `owner` / `changeme123` and prints a loud warning in the console —
fine for local testing, not for anything public.

To log in as Owner: College code `OWNER`, then your `OWNER_USERNAME` /
`OWNER_PASSWORD`.

## Project structure

```
lab-track-dev/
├── server.js          ← Express server: auth, sessions, college-scoped storage, owner routes
├── package.json
├── data/
│   └── db.json           ← all data lives here (users, sessions, equipment, etc.)
├── public/
│   ├── index.html          ← page shell + login/register overlay
│   ├── css/styles.css        ← all styling
│   └── js/app.js               ← all frontend logic
└── README.md
```

## Running it locally

```bash
npm install
OWNER_USERNAME=admin OWNER_PASSWORD=changeThisNow npm start
```
Open **http://localhost:3000** — you'll land on the login screen.
Register your first real account, or sign in as Owner to start promoting
people to Lab In-Charge.

## How the data model works

Everything is stored in `data/db.json` under three top-level keys:

- **`users`** — every registered account (password stored as a salted hash, never plaintext)
- **`sessions`** — active login tokens, each expiring after 7 days
- **`storage`** — the actual app data (equipment, checkouts, maintenance), namespaced two ways:
  - `college:<collegeCode>` — shared within a college, invisible to every other college
  - `user:<userId>` — private to one person (used sparingly; almost everything in this app is college-shared)

The frontend never touches `db.json` directly — it calls
`storageGet`/`storageSet` in `public/js/app.js`, which call
`/api/storage/:key` on the server, which does the college-scoping for you.
Every module (equipment, checkout, maintenance, usage log) is written
against those two functions, so this is the only place you'd touch to
swap in a real database (Postgres/MongoDB) later.

## Equipment: add and remove

- **Add** — Lab In-Charge (or Owner) only, from the Equipment tab. Auto-assigns
  a tag like `LAB-EQ-0001` and generates its QR code.
- **Remove** — same permission level, with a two-step inline confirm
  ("Remove equipment" → "Confirm remove?"). Removal is **blocked** if the
  item currently has an active checkout, so you can't delete equipment
  someone still physically has — return it first.

## Manage Users (Owner only)

Lists every account across every college: name, college, department,
college code, and a role dropdown (Student ⇄ Lab In-Charge). Includes a
Remove button with the same inline confirm pattern. The Owner account
itself can't be demoted or removed through this screen.

## Deploying

Since `data/db.json` needs to persist on disk, use a host that runs a real
long-lived Node process:

- **Render** — connect your GitHub repo, build command `npm install`, start
  command `npm start`. Set `OWNER_USERNAME`/`OWNER_PASSWORD` as environment
  variables in the dashboard (don't hardcode them). Add a persistent disk
  if you want data to survive redeploys.
- **Railway** — same idea, very similar setup flow.
- **Fly.io** — works well with a persistent volume, slightly more config.
- **A college server / VPS** — `npm install && npm start`, behind nginx + pm2.

**Publishing to GitHub itself:**
```bash
git init
git add .
git commit -m "LabTrack initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```
`.gitignore` already excludes `node_modules/` and your local `data/db.json`
so you don't accidentally commit real student data or dependencies.

Vercel/Netlify (serverless) will run the API but **won't persist
`db.json`** between requests — fine for a demo, not for real use.

## Security notes worth mentioning in your project report

- Passwords are hashed with Node's built-in `scrypt` (salted, never stored
  in plaintext) — see `hashPassword`/`verifyPassword` in `server.js`.
- Sessions are random 32-byte tokens, not guessable, expiring after 7 days.
- This is intentionally dependency-light (just Express) so it's easy to
  read end-to-end for a viva — a production version would add rate-limiting
  on login attempts and HTTPS termination (handled automatically by
  Render/Railway/Fly, not something you need to build yourself).
