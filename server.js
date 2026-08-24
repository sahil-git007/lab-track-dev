'use strict';
require('dotenv').config();

const express = require('express');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { MongoClient } = require('mongodb');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Server: SocketIOServer } = require('socket.io');

const app = express();
const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, { cors: { origin: '*', methods: ['GET','POST'] } });

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'data', 'db.json');
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const checkoutLocks = new Map();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '.')));

const loginLimiter = rateLimit({ windowMs: 15*60*1000, max: 10, message: { error: 'Too many login attempts. Try again in 15 minutes.' }, standardHeaders: true, legacyHeaders: false });
const registerLimiter = rateLimit({ windowMs: 60*60*1000, max: 5, message: { error: 'Too many registration attempts.' } });
const generalLimiter = rateLimit({ windowMs: 60*1000, max: 300, message: { error: 'Too many requests.' } });
app.use('/api', generalLimiter);

let mongoClient;
let dbCollection;
let useMongo = false;

async function initStorage() {
  if (process.env.MONGODB_URI) {
    try {
      mongoClient = new MongoClient(process.env.MONGODB_URI);
      await mongoClient.connect();
      const db = mongoClient.db(process.env.MONGODB_DB || 'labtrack');
      dbCollection = db.collection('kv_storage');
      useMongo = true;
      const mainDoc = await dbCollection.findOne({ _id: 'main' });
      if (!mainDoc) {
        await dbCollection.insertOne({ _id: 'main', users: [], sessions: {}, storage: {} });
      }
      console.log('[LabTrack] Connected to MongoDB');
    } catch (err) {
      console.error('[LabTrack] MongoDB connection failed, falling back to FS', err);
      useMongo = false;
    }
  }
  if (!useMongo) {
    const dataDir = path.dirname(DB_FILE);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], sessions: {}, storage: {} }, null, 2));
    console.log('[LabTrack] Using filesystem DB at', DB_FILE);
  }
}

async function readDB() {
  if (useMongo) {
    const doc = await dbCollection.findOne({ _id: 'main' });
    return doc || { users: [], sessions: {}, storage: {} };
  } else {
    const data = await fsPromises.readFile(DB_FILE, 'utf8');
    return JSON.parse(data);
  }
}

async function writeDB(data) {
  if (useMongo) {
    await dbCollection.updateOne(
      { _id: 'main' },
      { $set: { users: data.users, sessions: data.sessions, storage: data.storage } },
      { upsert: true }
    );
  } else {
    await fsPromises.writeFile(DB_FILE, JSON.stringify(data, null, 2));
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derivedKey}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, key] = stored.split(':');
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  return key === derivedKey;
}

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const token = authHeader.split(' ')[1];
    const db = await readDB();
    const session = db.sessions[token];
    if (!session) return res.status(401).json({ error: 'Invalid token' });
    if (Date.now() - session.createdAt > SESSION_TTL_MS) {
      delete db.sessions[token];
      await writeDB(db);
      return res.status(401).json({ error: 'Token expired' });
    }
    const user = db.users.find(u => u.id === session.userId);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    req.token = token;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Auth error' });
  }
}

app.post('/api/auth/register', registerLimiter, async (req, res) => {
  try {
    const { username, password, collegeCode, fullName, collegeEmail } = req.body;
    if (!username || !/^[a-zA-Z0-9_-]{3,30}$/.test(username))
      return res.status(400).json({ error: 'Invalid username. Use 3-30 letters, numbers, _ or -' });
    if (!collegeCode || !/^[a-zA-Z0-9]{3,20}$/.test(collegeCode))
      return res.status(400).json({ error: 'Invalid college code.' });
    if (!password || password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    const db = await readDB();
    if (db.users.find(u => u.username === username && u.collegeCode === collegeCode))
      return res.status(409).json({ error: 'Username already exists in this college.' });

    const collegeUsers = db.users.filter(u => u.collegeCode === collegeCode);
    const isFirstUser = collegeUsers.length === 0;

    const newUser = {
      id: crypto.randomUUID(),
      username,
      fullName: fullName || username,
      collegeEmail: collegeEmail || '',
      collegeCode,
      role: isFirstUser ? 'owner' : 'student',
      status: isFirstUser ? 'approved' : 'pending',
      password: hashPassword(password),
      createdAt: Date.now()
    };

    db.users.push(newUser);
    await writeDB(db);
    const { password: _p, ...safe } = newUser;
    res.status(201).json({ message: 'Account created successfully', user: safe });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  try {
    const { identifier, username: usernameField, password, collegeCode } = req.body;
    const loginIdentifier = identifier || usernameField;
    if (!loginIdentifier || !password || !collegeCode)
      return res.status(400).json({ error: 'Missing credentials' });

    const db = await readDB();
    const user = db.users.find(u =>
      u.collegeCode === collegeCode &&
      (u.username === loginIdentifier || u.collegeEmail === loginIdentifier)
    );
    if (!user || !verifyPassword(password, user.password))
      return res.status(401).json({ error: 'Invalid credentials' });

    const token = crypto.randomBytes(32).toString('hex');
    db.sessions[token] = { userId: user.id, collegeCode: user.collegeCode, createdAt: Date.now() };
    await writeDB(db);

    console.log(`[LOGIN] ${new Date().toISOString()} | ${collegeCode} | ${user.username}`);
    const { password: _p, ...safe } = user;
    res.json({ token, user: safe });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/auth/logout', authenticate, async (req, res) => {
  try {
    const db = await readDB();
    delete db.sessions[req.token];
    await writeDB(db);
    res.json({ message: 'Logged out' });
  } catch (err) {
    res.status(500).json({ error: 'Logout failed' });
  }
});

app.get('/api/auth/me', authenticate, (req, res) => {
  const { password: _p, ...safe } = req.user;
  res.json({ user: safe });
});

app.get('/api/auth/users', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'incharge' && req.user.role !== 'owner')
      return res.status(403).json({ error: 'Access denied' });
    const db = await readDB();
    const users = db.users
      .filter(u => u.collegeCode === req.user.collegeCode)
      .map(({ password: _p, ...u }) => u);
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list users' });
  }
});

app.get('/api/storage/:key', authenticate, async (req, res) => {
  try {
    const { key } = req.params;
    const shared = req.query.shared === 'true';
    const storageKey = shared ? `${req.user.collegeCode}:${key}` : `${req.user.id}:${key}`;
    const db = await readDB();
    const value = db.storage[storageKey] !== undefined ? db.storage[storageKey] : null;
    res.json({ value });
  } catch (err) {
    res.status(500).json({ error: 'Storage read failed' });
  }
});

app.post('/api/storage/:key', authenticate, async (req, res) => {
  try {
    const { key } = req.params;
    const { value, shared } = req.body;
    const isShared = shared === true || shared === 'true';
    const storageKey = isShared ? `${req.user.collegeCode}:${key}` : `${req.user.id}:${key}`;
    const db = await readDB();
    db.storage[storageKey] = typeof value === 'string' ? value : JSON.stringify(value);
    await writeDB(db);
    io.to(req.user.collegeCode).emit('storage:update', { key, collegeCode: req.user.collegeCode });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Storage write failed' });
  }
});

app.post('/api/equipment/:tag/checkout', authenticate, async (req, res) => {
  const { tag } = req.params;
  const lockKey = `${req.user.collegeCode}:${tag}`;
  if (checkoutLocks.has(lockKey))
    return res.status(409).json({ error: 'Checkout already in progress. Try again.' });

  checkoutLocks.set(lockKey, true);
  try {
    const db = await readDB();
    const storageKey = `${req.user.collegeCode}:lab:equipment`;
    let equipmentList = [];
    if (db.storage[storageKey]) {
      try { equipmentList = JSON.parse(db.storage[storageKey]); } catch (e) {}
    }
    const idx = equipmentList.findIndex(e =>
      (e.qrTag === tag || e.tag === tag) && e.collegeCode === req.user.collegeCode
    );
    if (idx === -1) return res.status(404).json({ error: 'Equipment not found.' });
    const equipment = equipmentList[idx];
    if (equipment.status !== 'available')
      return res.status(409).json({ error: 'Equipment is not available.' });

    equipment.status = 'checked-out';
    equipment.currentHolder = { id: req.user.id, name: req.user.fullName, username: req.user.username };
    db.storage[storageKey] = JSON.stringify(equipmentList);
    await writeDB(db);
    io.to(req.user.collegeCode).emit('equipment:update', { tag, status: 'checked-out', collegeCode: req.user.collegeCode });
    res.json({ ok: true, equipment });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Checkout failed' });
  } finally {
    checkoutLocks.delete(lockKey);
  }
});

app.post('/api/equipment/:tag/return', authenticate, async (req, res) => {
  try {
    const { tag } = req.params;
    const db = await readDB();
    const storageKey = `${req.user.collegeCode}:lab:equipment`;
    let equipmentList = [];
    if (db.storage[storageKey]) {
      try { equipmentList = JSON.parse(db.storage[storageKey]); } catch (e) {}
    }
    const idx = equipmentList.findIndex(e =>
      (e.qrTag === tag || e.tag === tag) && e.collegeCode === req.user.collegeCode
    );
    if (idx === -1) return res.status(404).json({ error: 'Equipment not found.' });
    const equipment = equipmentList[idx];
    if (equipment.status !== 'checked-out')
      return res.status(400).json({ error: 'Equipment is not checked out.' });

    const isHolder = equipment.currentHolder && equipment.currentHolder.id === req.user.id;
    const isPrivileged = req.user.role === 'incharge' || req.user.role === 'owner';
    if (!isHolder && !isPrivileged)
      return res.status(403).json({ error: 'Not authorized to return this equipment.' });

    equipment.status = 'available';
    equipment.currentHolder = null;
    db.storage[storageKey] = JSON.stringify(equipmentList);
    await writeDB(db);
    io.to(req.user.collegeCode).emit('equipment:update', { tag, status: 'available', collegeCode: req.user.collegeCode });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Return failed' });
  }
});

io.on('connection', (socket) => {
  const token = socket.handshake.query.token;
  if (token) {
    readDB().then(db => {
      const session = db.sessions[token];
      if (session && Date.now() - session.createdAt < SESSION_TTL_MS) {
        socket.join(session.collegeCode);
        socket.emit('connected', { room: session.collegeCode });
      }
    }).catch(() => {});
  }
});

async function start() {
  await initStorage();
  httpServer.listen(PORT, () => {
    console.log(`[LabTrack] Server running on http://localhost:${PORT}`);
  });
}
start();
