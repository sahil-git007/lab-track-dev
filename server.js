const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cors());

// Environment configuration
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/labtrack';
const JWT_SECRET = process.env.JWT_SECRET || 'labtrack_secure_secret_key_2026';

// Connect to MongoDB
mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('MongoDB connected successfully.')).catch(err => console.error('MongoDB connection error:', err));

// Mongoose Models
const userSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  username: { type: String, required: true, unique: true },
  collegeEmail: { type: String, required: true },
  collegeName: { type: String, required: true },
  department: { type: String, required: true },
  collegeCode: { type: String, required: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['student', 'incharge', 'owner'], default: 'student' },
  status: { type: String, enum: ['pending', 'approved'], default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

const storageSchema = new mongoose.Schema({
  collegeCode: { type: String, required: true },
  key: { type: String, required: true },
  value: { type: String, default: '' },
  shared: { type: Boolean, default: false }
});
storageSchema.index({ collegeCode: 1, key: 1, shared: 1 }, { unique: true });
const Storage = mongoose.model('Storage', storageSchema);

// Middleware to authenticate JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token required.' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(401).json({ error: 'Invalid or expired token.' });
    req.user = user;
    next();
  });
};

/* ============ AUTH ROUTES ============ */
app.post('/api/auth/register', async (req, res) => {
  try {
    const { fullName, username, collegeEmail, collegeName, department, collegeCode, password } = req.body;
    if (!fullName || !username || !collegeEmail || !collegeName || !department || !collegeCode || !password) {
      return res.status(400).json({ error: 'All fields are required.' });
    }

    const existingUser = await User.findOne({ username });
    if (existingUser) return res.status(400).json({ error: 'Username is already taken.' });

    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Check if this is the very first user for this college code, make them owner and auto-approve
    const count = await User.countDocuments({ collegeCode });
    const role = count === 0 ? 'owner' : 'student';
    const status = count === 0 ? 'approved' : 'pending';

    const newUser = new User({
      fullName,
      username,
      collegeEmail,
      collegeName,
      department,
      collegeCode,
      password: hashedPassword,
      role,
      status
    });

    await newUser.save();
    res.json({ success: true, message: 'Registration submitted successfully.' });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error during registration.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { collegeCode, username, password } = req.body;
    if (!collegeCode || !username || !password) {
      return res.status(400).json({ error: 'All fields are required.' });
    }

    const user = await User.findOne({ collegeCode, $or: [{ username }, { collegeEmail: username }] });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({ error: 'Invalid credentials or college code.' });
    }

    const token = jwt.sign({ id: user._id, role: user.role, collegeCode: user.collegeCode, username: user.username }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: {
        id: user._id,
        fullName: user.fullName,
        username: user.username,
        collegeEmail: user.collegeEmail,
        collegeName: user.collegeName,
        department: user.department,
        collegeCode: user.collegeCode,
        role: user.role,
        status: user.status
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

/* ============ STORAGE ROUTES (College-Scoped Key-Value Store) ============ */
app.get('/api/storage/:key', authenticateToken, async (req, res) => {
  try {
    const { key } = req.params;
    const shared = req.query.shared === 'true';
    const scope = shared ? req.user.collegeCode : req.user.id;

    const record = await Storage.findOne({ collegeCode: scope, key, shared });
    res.json({ value: record ? record.value : null });
  } catch (err) {
    res.status(500).json({ error: 'Storage fetch error.' });
  }
});

app.post('/api/storage/:key', authenticateToken, async (req, res) => {
  try {
    const { key } = req.params;
    const { value, shared } = req.body;
    const isShared = shared === true;
    const scope = isShared ? req.user.collegeCode : req.user.id;

    await Storage.findOneAndUpdate(
      { collegeCode: scope, key, shared: isShared },
      { value: value || '' },
      { upsert: true, new: true }
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Storage save error:', err);
    res.status(500).json({ error: 'Storage save error.' });
  }
});

/* ============ MANAGEMENT & APPROVAL ROUTES ============ */
app.get('/api/owner/users', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'owner' && req.user.role !== 'incharge') {
      return res.status(403).json({ error: 'Unauthorized.' });
    }

    const users = await User.find({ collegeCode: req.user.collegeCode }).select('-password');
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users.' });
  }
});

app.patch('/api/owner/users/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'owner' && req.user.role !== 'incharge') {
      return res.status(403).json({ error: 'Unauthorized.' });
    }

    const { status, role } = req.body;
    const updateData = {};
    if (status) updateData.status = status;
    if (role) updateData.role = role;

    const updatedUser = await User.findByIdAndUpdate(req.params.id, updateData, { new: true }).select('-password');
    if (!updatedUser) return res.status(404).json({ error: 'User not found.' });

    res.json({ success: true, user: updatedUser });
  } catch (err) {
    console.error('User update error:', err);
    res.status(500).json({ error: 'Failed to update user.' });
  }
});

app.delete('/api/owner/users/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'owner' && req.user.role !== 'incharge') {
      return res.status(403).json({ error: 'Unauthorized.' });
    }

    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete user.' });
  }
});

// Serve frontend static files if applicable
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`LabTrack server running on port ${PORT}`);
});
