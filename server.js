const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// -------------------------------------------------------------
// DATABASE CONNECTION
// -------------------------------------------------------------
// We prioritize the Render Environment Variable, but fallback directly to your Atlas URI 
// to prevent the application from breaking due to config mismatches.
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://sahilcseproject_db_user:Sahil@Mongodb8934@project.xv0bdya.mongodb.net/labtrack?retryWrites=true&w=majority";

mongoose.connect(MONGODB_URI)
  .then(() => console.log('[LabTrack] Successfully connected to MongoDB Atlas.'))
  .catch((err) => {
    console.error('[LabTrack] MongoDB connection error:', err.message);
    console.log('[LabTrack] CRITICAL: Running without persistent storage. Data will lose on restart.');
  });

// -------------------------------------------------------------
// SCHEMAS & MODELS
// -------------------------------------------------------------
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  rollNo: { type: String, required: true },
  section: { type: String, required: true },
  collegeCode: { type: String, required: true },
  role: { type: String, default: 'student' },
  createdAt: { type: Date, default: Date.now }
});

const logSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userName: String,
  rollNo: String,
  section: String,
  collegeCode: String,
  pcNumber: { type: String, required: true },
  labName: { type: String, required: true },
  loginTime: { type: Date, default: Date.now },
  logoutTime: { type: Date, default: null },
  status: { type: String, enum: ['Active', 'Completed'], default: 'Active' }
});

const User = mongoose.model('User', userSchema);
const Log = mongoose.model('Log', logSchema);

// -------------------------------------------------------------
// AUTHENTICATION API ENDPOINTS
// -------------------------------------------------------------

// Registration Endpoint
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, rollNo, section, collegeCode, role } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email is already registered.' });
    }

    // Create and save new user
    const newUser = new User({
      name,
      email,
      password, // Note: For production environments, consider hashing passwords using bcrypt
      rollNo,
      section,
      collegeCode,
      role: role || 'student'
    });

    await newUser.save();
    res.status(201).json({ message: 'Registration successful!', user: { id: newUser._id, name, email, role } });
  } catch (error) {
    res.status(500).json({ message: 'Server error during registration.', error: error.message });
  }
});

// Login Endpoint (Dynamic authentication allowing any verified database user)
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user || user.password !== password) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    res.status(200).json({
      message: 'Login successful!',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        rollNo: user.rollNo,
        section: user.section,
        collegeCode: user.collegeCode,
        role: user.role
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error during login.', error: error.message });
  }
});

// -------------------------------------------------------------
// LAB TRACKING & LOGGING ENDPOINTS
// -------------------------------------------------------------

// Active Check-in Endpoint
app.post('/api/logs/checkin', async (req, res) => {
  try {
    const { userId, pcNumber, labName } = req.body;

    // Ensure the student isn't already checked into an active session
    const activeLog = await Log.findOne({ userId, status: 'Active' });
    if (activeLog) {
      return res.status(400).json({ message: 'You already have an active session running.' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User profile not found.' });

    const newLog = new Log({
      userId: user._id,
      userName: user.name,
      rollNo: user.rollNo,
      section: user.section,
      collegeCode: user.collegeCode,
      pcNumber,
      labName
    });

    await newLog.save();
    res.status(201).json({ message: 'Successfully checked in!', log: newLog });
  } catch (error) {
    res.status(500).json({ message: 'Server error during check-in.', error: error.message });
  }
});

// Check-out Endpoint
app.post('/api/logs/checkout', async (req, res) => {
  try {
    const { userId } = req.body;

    const activeLog = await Log.findOne({ userId, status: 'Active' });
    if (!activeLog) {
      return res.status(404).json({ message: 'No active session found for this user.' });
    }

    activeLog.logoutTime = new Date();
    activeLog.status = 'Completed';
    await activeLog.save();

    res.status(200).json({ message: 'Successfully checked out!', log: activeLog });
  } catch (error) {
    res.status(500).json({ message: 'Server error during check-out.', error: error.message });
  }
});

// Fetch Logs (For Dashboard View)
app.get('/api/logs', async (req, res) => {
  try {
    const logs = await Log.find().sort({ loginTime: -1 });
    res.status(200).json(logs);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching activity logs.', error: error.message });
  }
});

// -------------------------------------------------------------
// DEPLOYMENT SERVING (FRONTEND BUILD)
// -------------------------------------------------------------
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../frontend/build')));
  
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/build', 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`[LabTrack Server] Listening smoothly on port ${PORT}`);
});
