/**
 * LabTrack — Backend Server with MongoDB Support + Local Fallback
 *
 * Multi-Tenancy: Every user registers with a collegeCode. All shared
 * data (equipment, checkouts, maintenance) is namespaced by collegeCode.
 *
 * Database:
 *   - If MONGODB_URI or MONGO_URI env var is set, uses MongoDB Atlas / Mongoose.
 *   - If no MONGODB_URI is set, falls back gracefully to data/db.json file storage.
 */
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'data', 'db.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

/* ---------- MongoDB Mongoose Schemas ---------- */
const UserSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  fullName: String,
  collegeName: String,
  department: String,
  collegeCode: String,
  username: String,
  passwordHash: String,
  role: { type: String, default: 'student' },
  createdAt: { type: Date, default: Date.now }
});

const StorageSchema = new mongoose.Schema({
  namespace: { type: String, required: true },
  key: { type: String, required: true },
  value: mongoose.Schema.Types.Mixed
}, { timestamps: true });
StorageSchema.index({ namespace: 1, key: 1 }, { unique: true });

const SessionSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true },
  userId: String,
  expiresAt: Number
});

const MongoUser = mongoose.model('User', UserSchema);
const MongoStorage = mongoose.model('Storage', StorageSchema);
const MongoSession = mongoose.model('Session', SessionSchema);

let isMongoConnected = false;
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI)
    .then(() => {
      isMongoConnected = true;
      console.log('[LabTrack] Connected to MongoDB Database successfully!');
      ensureOwnerMongo();
    })
    .catch(err => {
      console.error('[LabTrack] MongoDB connection error:', err.message);
      console.log('[LabTrack] Falling back to local data/db.json storage.');
    });
} else {
  console.log('[LabTrack] MONGODB_URI env variable not set. Running with local data/db.json storage.');
}

/* ---------- Local JSON file fallback ---------- */
function readDB(){
  try{
    if(!fs.existsSync(DB_FILE)) return { users:[], sessions:{}, storage:{} };
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = raw ? JSON.parse(raw) : {};
    return { users: parsed.users||[], sessions: parsed.sessions||{}, storage: parsed.storage||{} };
  }catch(e){
    return { users:[], sessions:{}, storage:{} };
  }
}
function writeDB(db){
  fs.mkdirSync(path.dirname(DB_FILE), { recursive:true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

/* ---------- Password Hashing ---------- */
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
  const { passwordHash, _id, __v, ...rest } = u.toObject ? u.toObject() : u;
  return rest;
}

/* ---------- Seed System Owner ---------- */
async function ensureOwnerMongo(){
  try {
    const existing = await MongoUser.findOne({ role: 'owner' });
    if (existing) return;
    const username = process.env.OWNER_USERNAME || 'owner';
    const password = process.env.OWNER_PASSWORD || 'changeme123';
    await MongoUser.create({
      id: crypto.randomUUID(),
      fullName: 'System Owner',
      collegeName: 'LabTrack Administration',
      department: 'Administration',
      collegeCode: 'OWNER',
      username,
      passwordHash: hashPassword(password),
      role: 'owner'
    });
    console.log('[LabTrack] System Owner account initialized in MongoDB.');
  } catch (e) {
    console.error('[LabTrack] Error seeding owner in MongoDB:', e.message);
  }
}

function ensureOwnerFile(){
  const db = readDB();
  if(db.users.some(u=>u.role==='owner')) return;
  const username = process.env.OWNER_USERNAME || 'owner';
  const password = process.env.OWNER_PASSWORD || 'changeme123';
  db.users.push({
    id: crypto.randomUUID(),
    fullName: 'System Owner',
    collegeName: 'LabTrack Administration',
    department: 'Administration',
    collegeCode: 'OWNER',
    username,
    passwordHash: hashPassword(password),
    role: 'owner',
    createdAt: Date.now()
  });
  writeDB(db);
}
ensureOwnerFile();

/* ---------- Auth Middleware ---------- */
async function requireAuth(req, res, next){
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if(!token) return res.status(401).json({ error: 'Unauthenticated' });

  if(isMongoConnected){
    try{
      const session = await MongoSession.findOne({ token });
      if(!session || session.expiresAt < Date.now()){
        if(session) await MongoSession.deleteOne({ token });
        return res.status(401).json({ error: 'Session expired' });
      }
      const user = await MongoUser.findOne({ id: session.userId });
      if(!user) return res.status(401).json({ error: 'User no longer exists' });
      req.user = user;
      req.token = token;
      return next();
    }catch(e){
      return res.status(500).json({ error: 'Database authentication error' });
    }
  } else {
    const db = readDB();
    const session = db.sessions[token];
    if(!session || session.expiresAt < Date.now()){
      if(session) delete db.sessions[token];
      writeDB(db);
      return res.status(401).json({ error: 'Session expired' });
    }
    const user = db.users.find(u => u.id === session.userId);
    if(!user) return res.status(401).json({ error: 'User no longer exists' });
    req.user = user;
    req.token = token;
    req.db = db;
    next();
  }
}

function requireOwner(req, res, next){
  requireAuth(req, res, () => {
    if(req.user.role !== 'owner') return res.status(403).json({ error: 'Owner role required' });
    next();
  });
}

/* ---------- Auth Routes ---------- */
app.post('/api/auth/register', async (req, res) => {
  const { fullName, collegeName, department, collegeCode, username, password } = req.body || {};
  if(!fullName || !collegeName || !department || !collegeCode || !username || !password){
    return res.status(400).json({ error: 'All fields are required' });
  }
  if(password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const codeClean = collegeCode.trim().toUpperCase();
  const userClean = username.trim().toLowerCase();

  if(isMongoConnected){
    try{
      const exists = await MongoUser.findOne({ collegeCode: codeClean, username: userClean });
      if(exists) return res.status(400).json({ error: 'Username already registered for this college code' });

      const newUser = await MongoUser.create({
        id: crypto.randomUUID(),
        fullName: fullName.trim(),
        collegeName: collegeName.trim(),
        department: department.trim(),
        collegeCode: codeClean,
        username: userClean,
        passwordHash: hashPassword(password),
        role: 'student'
      });

      const token = newToken();
      await MongoSession.create({ token, userId: newUser.id, expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000) });
      return res.json({ token, user: publicUser(newUser) });
    }catch(e){
      return res.status(500).json({ error: 'Failed to create user in MongoDB' });
    }
  } else {
    const db = readDB();
    const exists = db.users.some(u => u.collegeCode === codeClean && u.username.toLowerCase() === userClean);
    if(exists) return res.status(400).json({ error: 'Username already registered for this college code' });

    const newUser = {
      id: crypto.randomUUID(),
      fullName: fullName.trim(),
      collegeName: collegeName.trim(),
      department: department.trim(),
      collegeCode: codeClean,
      username: userClean,
      passwordHash: hashPassword(password),
      role: 'student',
      createdAt: Date.now()
    };

    db.users.push(newUser);
    const token = newToken();
    db.sessions[token] = { userId: newUser.id, expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000) };
    writeDB(db);

    res.json({ token, user: publicUser(newUser) });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { collegeCode, username, password } = req.body || {};
  if(!collegeCode || !username || !password){
    return res.status(400).json({ error: 'College code, username, and password required' });
  }
  const codeClean = collegeCode.trim().toUpperCase();
  const userClean = username.trim().toLowerCase();

  if(isMongoConnected){
    try{
      const user = await MongoUser.findOne({
        $or: [
          { collegeCode: codeClean, username: userClean },
          { role: 'owner', username: userClean }
        ]
      });

      if(!user || !verifyPassword(password, user.passwordHash)){
        return res.status(401).json({ error: 'Invalid college code, username, or password' });
      }

      const token = newToken();
      await MongoSession.create({ token, userId: user.id, expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000) });
      return res.json({ token, user: publicUser(user) });
    }catch(e){
      return res.status(500).json({ error: 'Login error' });
    }
  } else {
    const db = readDB();
    const user = db.users.find(u =>
      (u.collegeCode === codeClean || u.role === 'owner') &&
      (u.username.toLowerCase() === userClean)
    );

    if(!user || !verifyPassword(password, user.passwordHash)){
      return res.status(401).json({ error: 'Invalid college code, username, or password' });
    }

    const token = newToken();
    db.sessions[token] = { userId: user.id, expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000) };
    writeDB(db);

    res.json({ token, user: publicUser(user) });
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  if(isMongoConnected){
    await MongoSession.deleteOne({ token: req.token });
  } else {
    delete req.db.sessions[req.token];
    writeDB(req.db);
  }
  res.json({ ok: true });
});

/* ---------- Owner: Manage Users ---------- */
app.get('/api/owner/users', requireOwner, async (req, res) => {
  if(isMongoConnected){
    const users = await MongoUser.find({});
    res.json({ users: users.map(publicUser) });
  } else {
    res.json({ users: req.db.users.map(publicUser) });
  }
});

app.patch('/api/owner/users/:id', requireOwner, async (req, res) => {
  const { id } = req.params;
  const { role } = req.body || {};
  if(!['student', 'incharge'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

  if(isMongoConnected){
    const user = await MongoUser.findOne({ id });
    if(!user) return res.status(404).json({ error: 'User not found' });
    if(user.role === 'owner') return res.status(400).json({ error: 'Cannot demote system owner' });
    user.role = role;
    await user.save();
    res.json({ user: publicUser(user) });
  } else {
    const db = req.db;
    const user = db.users.find(u => u.id === id);
    if(!user) return res.status(404).json({ error: 'User not found' });
    if(user.role === 'owner') return res.status(400).json({ error: 'Cannot demote system owner' });
    user.role = role;
    writeDB(db);
    res.json({ user: publicUser(user) });
  }
});

app.delete('/api/owner/users/:id', requireOwner, async (req, res) => {
  const { id } = req.params;
  if(isMongoConnected){
    const user = await MongoUser.findOne({ id });
    if(!user) return res.status(404).json({ error: 'User not found' });
    if(user.role === 'owner') return res.status(400).json({ error: 'Cannot remove system owner' });
    await MongoUser.deleteOne({ id });
    await MongoSession.deleteMany({ userId: id });
    res.json({ ok: true });
  } else {
    const db = req.db;
    const user = db.users.find(u => u.id === id);
    if(!user) return res.status(404).json({ error: 'User not found' });
    if(user.role === 'owner') return res.status(400).json({ error: 'Cannot remove system owner' });
    db.users = db.users.filter(u => u.id !== id);
    Object.keys(db.sessions).forEach(t => {
      if(db.sessions[t].userId === id) delete db.sessions[t];
    });
    writeDB(db);
    res.json({ ok: true });
  }
});

/* ---------- Storage API (College Scoped) ---------- */
app.get('/api/storage/:key', requireAuth, async (req, res) => {
  const { key } = req.params;
  const shared = req.query.shared === 'true';
  const namespace = shared ? `college:${req.user.collegeCode}` : `user:${req.user.id}`;

  if(isMongoConnected){
    try{
      const doc = await MongoStorage.findOne({ namespace, key });
      res.json({ key, value: doc ? doc.value : null, shared });
    }catch(e){
      res.json({ key, value: null, shared });
    }
  } else {
    const value = (req.db.storage[namespace] && req.db.storage[namespace][key] !== undefined) ? req.db.storage[namespace][key] : null;
    res.json({ key, value, shared });
  }
});

app.post('/api/storage/:key', requireAuth, async (req, res) => {
  const { key } = req.params;
  const { value, shared } = req.body || {};
  const namespace = shared ? `college:${req.user.collegeCode}` : `user:${req.user.id}`;

  if(isMongoConnected){
    try{
      await MongoStorage.findOneAndUpdate(
        { namespace, key },
        { namespace, key, value },
        { upsert: true, new: true }
      );
      res.json({ key, ok: true, shared });
    }catch(e){
      res.status(500).json({ error: 'Failed to write storage to MongoDB' });
    }
  } else {
    const db = req.db;
    if(!db.storage[namespace]) db.storage[namespace] = {};
    db.storage[namespace][key] = value;
    writeDB(db);
    res.json({ key, ok: true, shared });
  }
});

app.delete('/api/storage/:key', requireAuth, async (req, res) => {
  const { key } = req.params;
  const shared = req.query.shared === 'true';
  const namespace = shared ? `college:${req.user.collegeCode}` : `user:${req.user.id}`;

  if(isMongoConnected){
    await MongoStorage.deleteOne({ namespace, key });
    res.json({ key, deleted: true, shared });
  } else {
    const db = req.db;
    if(db.storage[namespace]) delete db.storage[namespace][key];
    writeDB(db);
    res.json({ key, deleted: true, shared });
  }
});

app.get('/api/health', (req, res) => res.json({
  status: 'ok',
  time: Date.now(),
  database: isMongoConnected ? 'MongoDB Atlas' : 'Local JSON'
}));

app.listen(PORT, () => {
  console.log(`LabTrack server running at http://localhost:${PORT}`);
});
