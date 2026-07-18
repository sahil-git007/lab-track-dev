/**
 * LabTrack — backend server
 *
 * Real authentication (no third-party auth service needed) + a tiny
 * key-value storage API, both persisted to data/db.json.
 *
 * Multi-tenancy: every user registers with a collegeCode. All "shared"
 * data (equipment, checkouts, maintenance) is namespaced by the logged-in
 * user's collegeCode, so different colleges never see each other's records.
 *
 * Roles:
 *   student  — checkout/return, report issues, browse everything in their college
 *   incharge — additionally: add/remove equipment, resolve maintenance
 *   owner    — one global account (that's you, the person deploying this) that
 *              can view every user across every college and promote/demote/remove them
 *
 * Run:
 *   npm install
 *   npm start
 * Then open http://localhost:3000
 *
 * IMPORTANT: set OWNER_USERNAME and OWNER_PASSWORD as environment variables
 * before first run (see README) — otherwise an insecure default owner
 * account is created and a warning is printed to the console.
 */
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'data', 'db.json');
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

app.use(express.json());
app.use(express.static(path.join(__dirname, '.')));

/* ---------- tiny JSON-file "database" ---------- */
function readDB(){
  try{
    if(!fs.existsSync(DB_FILE)) return { users:[], sessions:{}, storage:{} };
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = raw ? JSON.parse(raw) : {};
    return { users: parsed.users||[], sessions: parsed.sessions||{}, storage: parsed.storage||{} };
  }catch(e){
    console.error('Failed to read db.json, starting fresh:', e.message);
    return { users:[], sessions:{}, storage:{} };
  }
}
function writeDB(db){
  fs.mkdirSync(path.dirname(DB_FILE), { recursive:true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

/* ---------- password hashing (Node's built-in crypto, no extra deps) ---------- */
function hashPassword(password){
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored){
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash,'hex'), Buffer.from(check,'hex'));
}
function newToken(){ return crypto.randomBytes(32).toString('hex'); }
function publicUser(u){
  const { passwordHash, ...rest } = u;
  return rest;
}

/* ---------- seed the Owner account on first run ---------- */
function ensureOwner(){
  const db = readDB();
  if(db.users.some(u=>u.role==='owner')) return;
  const username = process.env.OWNER_USERNAME || 'owner';
  const password = process.env.OWNER_PASSWORD || 'changeme123';
  if(!process.env.OWNER_PASSWORD){
    console.warn('\n[LabTrack] No OWNER_PASSWORD set — using an insecure default owner login.');
    console.warn(`[LabTrack] Username: ${username}  Password: ${password}`);
    console.warn('[LabTrack] Set OWNER_USERNAME and OWNER_PASSWORD env vars and restart before deploying for real.\n');
  }
  db.users.push({
    id: crypto.randomUUID(),
    fullName: 'System Owner',
    collegeName: 'LabTrack Administration',
    department: 'Administration',
    collegeCode: 'GHRCEN',
    username,
    passwordHash: hashPassword(password),
    role: 'owner',
    createdAt: Date.now()
  });
  writeDB(db);
}
ensureOwner();

/* ---------- auth middleware ---------- */
function requireAuth(req, res, next){
  const header = req.header('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if(!token) return res.status(401).json({ error:'Not authenticated' });
  const db = readDB();
  const session = db.sessions[token];
  if(!session || session.expiresAt < Date.now()) return res.status(401).json({ error:'Session expired' });
  const user = db.users.find(u=>u.id===session.userId);
  if(!user) return res.status(401).json({ error:'User no longer exists' });
  req.db = db;
  req.token = token;
  req.user = user;
  next();
}
function requireOwner(req, res, next){
  if(req.user.role!=='owner') return res.status(403).json({ error:'Owner only' });
  next();
}

/* ---------- auth routes ---------- */
app.post('/api/auth/register', (req, res) => {
  const { fullName, collegeName, department, collegeCode, username, password } = req.body || {};
  if(!fullName || !collegeName || !department || !collegeCode || !username || !password){
    return res.status(400).json({ error:'All fields are required.' });
  }
  if(password.length < 6) return res.status(400).json({ error:'Password must be at least 6 characters.' });

  const db = readDB();
  const uname = username.trim().toLowerCase();
  if(db.users.some(u=>u.username.toLowerCase()===uname)){
    return res.status(400).json({ error:'That username is already taken.' });
  }
  const user = {
    id: crypto.randomUUID(),
    fullName: fullName.trim(),
    collegeName: collegeName.trim(),
    department: department.trim(),
    collegeCode.trim().toUpperCase(),
    username: username.trim(),
    passwordHash: hashPassword(password),
    role: 'student', // everyone starts as Student; Owner/In-Charge can promote later
    createdAt: Date.now()
  };
  db.users.push(user);
  const token = newToken();
  db.sessions[token] = { userId: user.id, expiresAt: Date.now()+SESSION_TTL_MS };
  writeDB(db);
  res.json({ token, user: publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { collegeCode, username, password } = req.body || {};
  if(!collegeCode || !username || !password) return res.status(400).json({ error:'All fields are required.' });

  const db = readDB();
  const uname = username.trim().toLowerCase();
  const user = db.users.find(u => u.username.toLowerCase() === uname);
if (collegeCode.toLowerCase() !== 'ghrcen') {
    if (collegeCode !== 'GHRCEN') { 
        return res.status(400).json({ error: "Invalid college code..." });
    }
}
if(!user || !verifyPassword(password, user.passwordHash)){
    return res.status(401).json({ error:'Invalid college code, username, or password.' });
  }
  const token = newToken();
  db.sessions[token] = { userId: user.id, expiresAt: Date.now()+SESSION_TTL_MS };
  writeDB(db);
  res.json({ token, user: publicUser(user) });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  delete req.db.sessions[req.token];
  writeDB(req.db);
  res.json({ ok:true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

/* ---------- owner: manage all users across all colleges ---------- */
app.get('/api/owner/users', requireAuth, requireOwner, (req, res) => {
  res.json({ users: req.db.users.map(publicUser) });
});

app.patch('/api/owner/users/:id', requireAuth, requireOwner, (req, res) => {
  const { role } = req.body || {};
  if(!['student','incharge'].includes(role)) return res.status(400).json({ error:'Invalid role.' });
  const db = req.db;
  const target = db.users.find(u=>u.id===req.params.id);
  if(!target) return res.status(404).json({ error:'User not found.' });
  if(target.role==='owner') return res.status(400).json({ error:"Can't change the Owner's role." });
  target.role = role;
  writeDB(db);
  res.json({ user: publicUser(target) });
});

app.delete('/api/owner/users/:id', requireAuth, requireOwner, (req, res) => {
  const db = req.db;
  const target = db.users.find(u=>u.id===req.params.id);
  if(!target) return res.status(404).json({ error:'User not found.' });
  if(target.role==='owner') return res.status(400).json({ error:"Can't remove the Owner account." });
  db.users = db.users.filter(u=>u.id!==req.params.id);
  Object.keys(db.sessions).forEach(t=>{ if(db.sessions[t].userId===req.params.id) delete db.sessions[t]; });
  writeDB(db);
  res.json({ ok:true });
});

/* ---------- college-scoped key-value storage ----------
   shared=true  -> namespaced by the logged-in user's collegeCode (everyone
                   in the same college sees the same equipment/checkouts/etc.)
   shared=false -> namespaced by the individual user id (personal data) */
app.get('/api/storage/:key', requireAuth, (req, res) => {
  const { key } = req.params;
  const shared = req.query.shared === 'true';
  const namespace = shared ? `college:${req.user.collegeCode}` : `user:${req.user.id}`;
  const value = (req.db.storage[namespace] && req.db.storage[namespace][key] !== undefined) ? req.db.storage[namespace][key] : null;
  res.json({ key, value, shared });
});

app.post('/api/storage/:key', requireAuth, (req, res) => {
  const { key } = req.params;
  const { value, shared } = req.body || {};
  const namespace = shared ? `college:${req.user.collegeCode}` : `user:${req.user.id}`;
  const db = req.db;
  if(!db.storage[namespace]) db.storage[namespace] = {};
  db.storage[namespace][key] = value;
  writeDB(db);
  res.json({ key, ok:true, shared });
});

app.delete('/api/storage/:key', requireAuth, (req, res) => {
  const { key } = req.params;
  const shared = req.query.shared === 'true';
  const namespace = shared ? `college:${req.user.collegeCode}` : `user:${req.user.id}`;
  const db = req.db;
  if(db.storage[namespace]) delete db.storage[namespace][key];
  writeDB(db);
  res.json({ key, deleted:true, shared });
});

app.get('/api/health', (req, res) => res.json({ status:'ok', time: Date.now() }));

app.listen(PORT, () => {
  console.log(`LabTrack server running at http://localhost:${PORT}`);
});
