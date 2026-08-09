/**
 * LabTrack — backend server
 *
 * Real authentication (no third-party auth service needed) + a tiny
 * key-value storage API, both persisted to MongoDB Atlas or data/db.json.
 *
 * Multi-tenancy: every user registers with a collegeCode. All "shared"
 * data (equipment, checkouts, maintenance) is namespaced by the logged-in
 * user's collegeCode, so different colleges never see each other's records.
 */
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'data', 'db.json');
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

app.use(express.json());
app.use(express.static(path.join(__dirname, '.')));

/* ---------- storage layer ---------- */
let storageMode = 'file';
let mongoCollection = null;

async function initStorage(){
  const uri = process.env.MONGODB_URI;
  if(!uri){
    console.warn('\n[LabTrack] No MONGODB_URI set — using the local JSON file.');
    console.warn('[LabTrack] This means all data will be LOST on every restart/redeploy on Render.');
    console.warn('[LabTrack] Set MONGODB_URI (see README) before deploying for real.\n');
    storageMode = 'file';
    return;
  }
  try{
    const client = new MongoClient(uri);
    await client.connect();
    const dbName = process.env.MONGODB_DB || 'labtrack';
    mongoCollection = client.db(dbName).collection('state');
    storageMode = 'mongo';
    console.log('[LabTrack] Connected to MongoDB — data will persist across restarts.');
  }catch(e){
    console.error('[LabTrack] Failed to connect to MongoDB, falling back to the local file (data will NOT persist):', e.message);
    storageMode = 'file';
  }
}

function readDBFile(){
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
function writeDBFile(db){
  fs.mkdirSync(path.dirname(DB_FILE), { recursive:true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

async function readDB(){
  if(storageMode==='mongo'){
    const doc = await mongoCollection.findOne({ _id:'main' });
    if(!doc) return { users:[], sessions:{}, storage:{} };
    return { users: doc.users||[], sessions: doc.sessions||{}, storage: doc.storage||{} };
  }
  return readDBFile();
}
async function writeDB(db){
  if(storageMode==='mongo'){
    await mongoCollection.replaceOne(
      { _id:'main' },
      { _id:'main', users: db.users, sessions: db.sessions, storage: db.storage },
      { upsert:true }
    );
    return;
  }
  writeDBFile(db);
}

/* ---------- password hashing ---------- */
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
async function ensureOwner(){
  const db = await readDB();
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
  await writeDB(db);
}

/* ---------- auth middleware ---------- */
async function requireAuth(req, res, next){
  try{
    const header = req.header('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if(!token) return res.status(401).json({ error:'Not authenticated' });
    const db = await readDB();
    const session = db.sessions[token];
    if(!session || session.expiresAt < Date.now()) return res.status(401).json({ error:'Session expired' });
    const user = db.users.find(u=>u.id===session.userId);
    if(!user) return res.status(401).json({ error:'User no longer exists' });
    req.db = db;
    req.token = token;
    req.user = user;
    next();
  }catch(e){
    console.error('Auth check failed:', e);
    res.status(500).json({ error:'Server error during authentication.' });
  }
}
function requireOwner(req, res, next){
  if(req.user.role!=='owner') return res.status(403).json({ error:'Owner only' });
  next();
}

/* ---------- auth routes ---------- */
app.post('/api/auth/register', async (req, res) => {
  try{
    const { fullName, collegeName, department, collegeCode, username, password } = req.body || {};
    if(!fullName || !collegeName || !department || !collegeCode || !username || !password){
      return res.status(400).json({ error:'All fields are required.' });
    }
    if(password.length < 6) return res.status(400).json({ error:'Password must be at least 6 characters.' });

    const db = await readDB();
    const uname = username.trim().toLowerCase();
    const targetCode = collegeCode.trim().toUpperCase();

    // Check if the username is already taken within this specific college
    if(db.users.some(u => u.username.toLowerCase() === uname && u.collegeCode === targetCode)){
      return res.status(400).json({ error:'That username is already taken for this college.' });
    }

    const user = {
      id: crypto.randomUUID(),
      fullName: fullName.trim(),
      collegeName: collegeName.trim(),
      department: department.trim(),
      collegeCode: targetCode, 
      username: username.trim(),
      passwordHash: hashPassword(password),
      role: 'student',
      createdAt: Date.now()
    };
    db.users.push(user);
    const token = newToken();
    db.sessions[token] = { userId: user.id, expiresAt: Date.now()+SESSION_TTL_MS };
    await writeDB(db);
    res.json({ token, user: publicUser(user) });
  }catch(e){
    console.error('Register failed:', e);
    res.status(500).json({ error:'Server error — please try again.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try{
    const { collegeCode, username, password } = req.body || {};
    if(!collegeCode || !username || !password) return res.status(400).json({ error:'All fields are required.' });

    const db = await readDB();
    const uname = username.trim().toLowerCase();
    const targetCode = collegeCode.trim().toUpperCase();
    
    // Find user matching both username AND the typed collegeCode dynamically
    const user = db.users.find(u => u.username.toLowerCase() === uname && u.collegeCode === targetCode);

    if(!user || !verifyPassword(password, user.passwordHash)){
      return res.status(401).json({ error:'Invalid college code, username, or password.' });
    }
    const token = newToken();
    db.sessions[token] = { userId: user.id, expiresAt: Date.now()+SESSION_TTL_MS };
    await writeDB(db);
    res.json({ token, user: publicUser(user) });
  }catch(e){
    console.error('Login failed:', e);
    res.status(500).json({ error:'Server error — please try again.' });
  }
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  try{
    delete req.db.sessions[req.token];
    await writeDB(req.db);
    res.json({ ok:true });
  }catch(e){
    console.error('Logout failed:', e);
    res.status(500).json({ error:'Server error — please try again.' });
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

/* ---------- owner routes ---------- */
app.get('/api/owner/users', requireAuth, requireOwner, (req, res) => {
  res.json({ users: req.db.users.map(publicUser) });
});

app.patch('/api/owner/users/:id', requireAuth, requireOwner, async (req, res) => {
  try{
    const { role } = req.body || {};
    if(!['student','incharge'].includes(role)) return res.status(400).json({ error:'Invalid role.' });
    const db = req.db;
    const target = db.users.find(u=>u.id===req.params.id);
    if(!target) return res.status(404).json({ error:'User not found.' });
    if(target.role==='owner') return res.status(400).json({ error:"Can't change the Owner's role." });
    target.role = role;
    await writeDB(db);
    res.json({ user: publicUser(target) });
  }catch(e){
    console.error('Role update failed:', e);
    res.status(500).json({ error:'Server error — please try again.' });
  }
});

app.delete('/api/owner/users/:id', requireAuth, requireOwner, async (req, res) => {
  try{
    const db = req.db;
    const target = db.users.find(u=>u.id===req.params.id);
    if(!target) return res.status(404).json({ error:'User not found.' });
    if(target.role==='owner') return res.status(400).json({ error:"Can't remove the Owner account." });
    db.users = db.users.filter(u=>u.id!==req.params.id);
    Object.keys(db.sessions).forEach(t=>{ if(db.sessions[t].userId===req.params.id) delete db.sessions[t]; });
    await writeDB(db);
    res.json({ ok:true });
  }catch(e){
    console.error('User removal failed:', e);
    res.status(500).json({ error:'Server error — please try again.' });
  }
});

/* ---------- college-scoped key-value storage ---------- */
app.get('/api/storage/:key', requireAuth, (req, res) => {
  const { key } = req.params;
  const shared = req.query.shared === 'true';

  const cleanCollegeCode = (req.user.collegeCode || '').trim().toUpperCase();
  const namespace = shared ? `college:${cleanCollegeCode}` : `user:${req.user.id}`;

  const value = (req.db.storage[namespace] && req.db.storage[namespace][key] !== undefined) ? req.db.storage[namespace][key] : null;
  res.json({ key, value, shared });
});

app.post('/api/storage/:key', requireAuth, async (req, res) => {
  try{
    const { key } = req.params;
    const { value, shared } = req.body || {};

    const cleanCollegeCode = (req.user.collegeCode || '').trim().toUpperCase();
    const namespace = shared ? `college:${cleanCollegeCode}` : `user:${req.user.id}`;

    const db = req.db;
    if(!db.storage[namespace]) db.storage[namespace] = {};
    db.storage[namespace][key] = value;
    await writeDB(db);
    res.json({ key, ok:true, shared });
  }catch(e){
    console.error('Storage write failed:', e);
    res.status(500).json({ error:'Server error — please try again.' });
  }
});

app.delete('/api/storage/:key', requireAuth, async (req, res) => {
  try{
    const { key } = req.params;
    const shared = req.query.shared === 'true';

    const cleanCollegeCode = (req.user.collegeCode || '').trim().toUpperCase();
    const namespace = shared ? `college:${cleanCollegeCode}` : `user:${req.user.id}`;

    const db = req.db;
    if(db.storage[namespace]) delete db.storage[namespace][key];
    await writeDB(db);
    res.json({ key, deleted:true, shared });
  }catch(e){
    console.error('Storage delete failed:', e);
    res.status(500).json({ error:'Server error — please try again.' });
  }
});

app.get('/api/health', (req, res) => res.json({ status:'ok', storageMode, time: Date.now() }));

async function start(){
  await initStorage();
  await ensureOwner();
  app.listen(PORT, () => {
    console.log(`LabTrack server running at http://localhost:${PORT} (storage: ${storageMode})`);
  });
}
start();
