/**
 * Backend server for Gambleio: user auth, stats tracking, leaderboard.
 * Run: node server.js
 */
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// --- File-based persistence ---
// Use DATA_DIR env for persistent storage on deploy (e.g. /data or mounted volume)
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

const users = new Map();
const sessions = new Map();

function loadData() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(USERS_FILE)) {
      const obj = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
      for (const [k, v] of Object.entries(obj)) users.set(k, v);
      console.log(`Loaded ${users.size} users`);
    }
    if (fs.existsSync(SESSIONS_FILE)) {
      const obj = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
      for (const [k, v] of Object.entries(obj)) sessions.set(k, v);
      console.log(`Loaded ${sessions.size} sessions`);
    }
  } catch (e) {
    console.warn('Could not load data, starting fresh:', e.message);
  }
}

function saveUsers() {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(Object.fromEntries(users), null, 2));
  } catch (e) {
    console.error('Failed to save users:', e.message);
  }
}

function saveSessions() {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(sessions), null, 2));
  } catch (e) {
    console.error('Failed to save sessions:', e.message);
  }
}

loadData();

function generateToken() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

function getUserFromSession(token) {
  if (!token) return null;
  const userId = sessions.get(token);
  if (!userId) return null;
  return users.get(userId);
}

// Ensure user has all fields (for users created before new fields existed)
function ensureFields(user) {
  if (user.totalClicks === undefined) user.totalClicks = 0;
  if (user.totalWinsCount === undefined) user.totalWinsCount = 0;
  if (user.totalGamblingWins === undefined) user.totalGamblingWins = 0;
  if (user.biggestWinAmount === undefined) user.biggestWinAmount = 0;
  if (user.biggestWinMultiplier === undefined) user.biggestWinMultiplier = 1;
  if (user.totalBets === undefined) user.totalBets = 0;
  if (user.xp === undefined) user.xp = 0;
  if (user.level === undefined) user.level = 1;
  return user;
}

function publicUser(u) {
  return {
    username: u.username,
    displayName: u.displayName || u.username,
    balance: u.balance,
    totalGamblingWins: u.totalGamblingWins,
    totalClickEarnings: u.totalClickEarnings,
    totalBets: u.totalBets || 0,
    level: u.level,
    xp: u.xp || 0,
    totalClicks: u.totalClicks || 0,
    totalWinsCount: u.totalWinsCount || 0,
    biggestWinAmount: u.biggestWinAmount || 0,
    biggestWinMultiplier: u.biggestWinMultiplier || 1,
  };
}

// ===== AUTH =====

app.post('/api/auth/register', (req, res) => {
  const { username, password, displayName } = req.body;
  if (!username || !password || username.length < 3 || password.length < 3) {
    return res.status(400).json({ error: 'Username and password must be at least 3 characters' });
  }
  if (users.has(username)) {
    return res.status(400).json({ error: 'Username already exists' });
  }
  const user = {
    username,
    password: bcrypt.hashSync(password, 10),
    displayName: displayName || username,
    balance: 10000,
    totalGamblingWins: 0,
    totalClickEarnings: 0,
    totalBets: 0,
    level: 1,
    xp: 0,
    totalClicks: 0,
    totalWinsCount: 0,
    biggestWinAmount: 0,
    biggestWinMultiplier: 1,
    createdAt: Date.now(),
  };
  users.set(username, user);
  saveUsers();
  const token = generateToken();
  sessions.set(token, username);
  saveSessions();
  res.json({ token, user: publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = users.get(username);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }
  const isBcryptHash = typeof user.password === 'string' && user.password.startsWith('$2');
  const passwordMatch = isBcryptHash
    ? bcrypt.compareSync(password, user.password)
    : user.password === password;
  if (!passwordMatch) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  if (!isBcryptHash) {
    user.password = bcrypt.hashSync(password, 10);
    users.set(user.username, user);
    saveUsers();
  }
  ensureFields(user);
  const token = generateToken();
  sessions.set(token, username);
  saveSessions();
  res.json({ token, user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    sessions.delete(token);
    saveSessions();
  }
  res.json({ success: true });
});

// ===== STATS =====

app.get('/api/user/stats', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  ensureFields(user);
  res.json(publicUser(user));
});

// Only sync non-delta fields: xp, level, biggestWin
app.post('/api/user/update-stats', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  ensureFields(user);
  const { level, xp, biggestWinAmount, biggestWinMultiplier } = req.body;
  if (level !== undefined) user.level = level;
  if (xp !== undefined) user.xp = xp;
  if (biggestWinAmount !== undefined && biggestWinAmount > user.biggestWinAmount) {
    user.biggestWinAmount = biggestWinAmount;
    user.biggestWinMultiplier = biggestWinMultiplier || 1;
  }
  users.set(user.username, user);
  saveUsers();
  res.json({ success: true });
});

// ===== DELTA ENDPOINTS =====

app.post('/api/user/place-bet', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  ensureFields(user);
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount < 0.01 || amount > user.balance) {
    return res.status(400).json({ error: 'Invalid bet amount or insufficient balance' });
  }
  user.balance -= amount;
  user.totalBets += 1;
  users.set(user.username, user);
  saveUsers();
  res.json({ balance: user.balance, totalBets: user.totalBets });
});

app.post('/api/user/win', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  ensureFields(user);
  const amount = Number(req.body.amount);
  const multiplier = req.body.multiplier != null ? Number(req.body.multiplier) : null;
  const betAmount = req.body.betAmount != null ? Number(req.body.betAmount) : null;
  if (!Number.isFinite(amount) || amount < 0) {
    return res.status(400).json({ error: 'Invalid win amount' });
  }
  user.balance += amount;
  user.totalGamblingWins += amount;
  const isProfit = betAmount != null ? amount > betAmount : true;
  if (amount > 0 && isProfit) {
    user.totalWinsCount += 1;
    if (amount > user.biggestWinAmount) {
      user.biggestWinAmount = amount;
      user.biggestWinMultiplier = (multiplier != null && Number.isFinite(multiplier)) ? multiplier : 1;
    }
  }
  users.set(user.username, user);
  saveUsers();
  res.json({
    balance: user.balance,
    totalGamblingWins: user.totalGamblingWins,
    totalWinsCount: user.totalWinsCount,
    biggestWinAmount: user.biggestWinAmount,
    biggestWinMultiplier: user.biggestWinMultiplier,
  });
});

// Refund: adds to balance only (no win tracking)
app.post('/api/user/refund', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    return res.status(400).json({ error: 'Invalid refund amount' });
  }
  user.balance += amount;
  users.set(user.username, user);
  saveUsers();
  res.json({ balance: user.balance });
});

app.post('/api/user/click-earnings', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  ensureFields(user);
  const amount = Number(req.body.amount);
  const clickCount = Number(req.body.clickCount) || 0;
  if (!Number.isFinite(amount) || amount < 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }
  const capped = Math.min(amount, 10000);
  const cappedClicks = Math.min(clickCount, 10000);
  user.balance += capped;
  user.totalClickEarnings += capped;
  user.totalClicks += cappedClicks;
  users.set(user.username, user);
  saveUsers();
  res.json({ balance: user.balance, totalClickEarnings: user.totalClickEarnings, totalClicks: user.totalClicks });
});

// ===== LEADERBOARD =====

app.get('/api/leaderboard/:type', (req, res) => {
  const { type } = req.params;
  const validTypes = ['clicks', 'wins', 'biggest-win', 'xp', 'level'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: 'Invalid leaderboard type' });
  }
  const allUsers = Array.from(users.values()).map(u => {
    ensureFields(u);
    return {
      username: u.username,
      displayName: u.displayName || u.username,
      level: u.level,
      xp: u.xp || 0,
      totalClicks: u.totalClicks || 0,
      totalGamblingWins: u.totalGamblingWins || 0,
      totalWinsCount: u.totalWinsCount || 0,
      biggestWinAmount: u.biggestWinAmount || 0,
      biggestWinMultiplier: u.biggestWinMultiplier || 1,
    };
  });
  let sorted;
  if (type === 'clicks') sorted = allUsers.sort((a, b) => b.totalClicks - a.totalClicks);
  else if (type === 'wins') sorted = allUsers.sort((a, b) => (b.totalGamblingWins || 0) - (a.totalGamblingWins || 0));
  else if (type === 'biggest-win') sorted = allUsers.sort((a, b) => b.biggestWinAmount - a.biggestWinAmount);
  else if (type === 'xp') sorted = allUsers.sort((a, b) => b.xp - a.xp);
  else if (type === 'level') sorted = allUsers.sort((a, b) => b.level - a.level || b.xp - a.xp);
  res.json(sorted.slice(0, 100));
});

// Admin: reset all data (for beta end, etc). Requires ADMIN_RESET_KEY env.
app.post('/api/admin/reset', (req, res) => {
  const key = req.body?.key || req.headers['x-admin-key'];
  if (!process.env.ADMIN_RESET_KEY || key !== process.env.ADMIN_RESET_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  users.clear();
  sessions.clear();
  saveUsers();
  saveSessions();
  console.log('Admin reset: all data cleared');
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Gambleio server running on http://localhost:${PORT}`);
  if (DATA_DIR !== path.join(__dirname, 'data')) {
    console.log(`Data dir: ${DATA_DIR}`);
  }
});
