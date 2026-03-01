/**
 * Backend server for Gambleio: user auth, stats tracking, leaderboard.
 * Run: node server.js
 */
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Redirect www to root domain so gambleio.com is the canonical URL (production only)
const ROOT_DOMAIN = process.env.ROOT_DOMAIN || 'gambleio.com';
app.use((req, res, next) => {
  if (process.env.NODE_ENV !== 'production') return next();
  const host = (req.get('host') || '').toLowerCase();
  if (host.startsWith('www.')) {
    const root = host.replace(/^www\./, '');
    if (root === ROOT_DOMAIN.toLowerCase()) {
      const url = 'https://' + ROOT_DOMAIN + (req.originalUrl || '/');
      return res.redirect(301, url);
    }
  }
  next();
});

app.use(express.static(__dirname));

// --- Storage: database (when DATABASE_URL) or file-based (local dev) ---
const useDb = !!process.env.DATABASE_URL;
const db = useDb ? require('./db') : null;

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const PLINKO_STATS_FILE = path.join(DATA_DIR, 'plinko-stats.json');
const ADMIN_LOGS_FILE = path.join(DATA_DIR, 'admin-logs.json');

const users = new Map();
const sessions = new Map();
const plinkoStats = { totalBalls: 0, landings: Array(19).fill(0) };
let adminLogs = [];
const chatMessages = [];
const CHAT_MAX = 200;
const levelUpLogDedupe = new Map();
const LEVEL_UP_DEDUPE_MS = 30000;
const CHAT_DELAY_MS = 2000;
const CHAT_BURST_COUNT = 5;
const CHAT_BURST_WINDOW_MS = 15000;
const CHAT_RATE_MUTE_MS = 15000;
const chatLastSend = {};
const chatRecentSends = {};
const chatRateLimitMutedUntil = {};

function loadData() {
  if (useDb) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(USERS_FILE)) {
      const obj = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
      for (const [k, v] of Object.entries(obj)) {
        const key = (k || '').toLowerCase().trim();
        if (key && v) {
          v.username = v.username || key;
          ensureProfileSlug(v);
          users.set(key, v);
        }
      }
      console.log(`Loaded ${users.size} users`);
    }
    if (fs.existsSync(SESSIONS_FILE)) {
      const obj = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
      for (const [k, v] of Object.entries(obj)) sessions.set(k, v);
      console.log(`Loaded ${sessions.size} sessions`);
    }
    if (fs.existsSync(PLINKO_STATS_FILE)) {
      const obj = JSON.parse(fs.readFileSync(PLINKO_STATS_FILE, 'utf8'));
      plinkoStats.totalBalls = obj.totalBalls || 0;
      plinkoStats.landings = Array.isArray(obj.landings) ? obj.landings : Array(19).fill(0);
      while (plinkoStats.landings.length < 19) plinkoStats.landings.push(0);
      console.log(`Loaded plinko stats: ${plinkoStats.totalBalls} balls`);
    }
    if (fs.existsSync(ADMIN_LOGS_FILE)) {
      const arr = JSON.parse(fs.readFileSync(ADMIN_LOGS_FILE, 'utf8'));
      adminLogs = Array.isArray(arr) ? arr : [];
      console.log(`Loaded ${adminLogs.length} admin logs`);
    }
  } catch (e) {
    console.warn('Could not load data, starting fresh:', e.message);
  }
}

async function savePlinkoStats() {
  if (useDb) {
    try {
      await db.savePlinkoStats(plinkoStats);
    } catch (e) {
      console.error('Failed to save plinko stats:', e.message);
    }
    return;
  }
  try {
    fs.writeFileSync(PLINKO_STATS_FILE, JSON.stringify(plinkoStats, null, 2));
  } catch (e) {
    console.error('Failed to save plinko stats:', e.message);
  }
}

function saveUsersSync() {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(Object.fromEntries(users), null, 2));
  } catch (e) {
    console.error('Failed to save users:', e.message);
  }
}

async function saveUser(user) {
  if (useDb) {
    try {
      await db.saveUser(user);
    } catch (e) {
      console.error('Failed to save user:', e.message);
    }
    return;
  }
  users.set(user.username, user);
  saveUsersSync();
}

function saveSessionsSync() {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(sessions), null, 2));
  } catch (e) {
    console.error('Failed to save sessions:', e.message);
  }
}

async function addAdminLog(entry) {
  const e = { ...entry, timestamp: entry.timestamp || Date.now() };
  if (useDb) {
    try {
      await db.addAdminLog(e);
    } catch (err) {
      console.error('Failed to add admin log:', err.message);
    }
    return;
  }
  adminLogs.push(e);
  if (adminLogs.length > 2000) adminLogs = adminLogs.slice(-2000);
  try {
    fs.writeFileSync(ADMIN_LOGS_FILE, JSON.stringify(adminLogs.slice(-2000), null, 2));
  } catch (err) {
    console.error('Failed to save admin logs:', err.message);
  }
}

const PLINKO_RISK_COSTS = { medium: 50000, high: 500000, extreme: 5000000 };
const TRACKED_GAME_SOURCES = ['click', 'plinko', 'roulette', 'slots'];

function emptyGameNet() {
  return { click: 0, plinko: 0, roulette: 0, slots: 0 };
}

function emptyGamePlayCounts() {
  return { click: 0, plinko: 0, roulette: 0, slots: 0 };
}

function emptyXpBySource() {
  return { click: 0, plinko: 0, roulette: 0, slots: 0 };
}

function normalizeGameSource(source) {
  const s = String(source || '').toLowerCase().trim();
  return TRACKED_GAME_SOURCES.includes(s) ? s : null;
}

function generateToken() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

async function getUserFromSession(token) {
  if (!token) return null;
  if (useDb) {
    const userKey = await db.getSession(token);
    if (!userKey) return null;
    return await db.getUserByUsername(userKey);
  }
  const userId = sessions.get(token);
  if (!userId) return null;
  return users.get(userId);
}

async function getUserId(key) {
  const k = (key || '').toLowerCase().trim();
  if (!k) return null;
  if (useDb) return await db.getUserByUsername(k);
  return users.get(k) || null;
}

async function getUserByKeyOrSlug(key) {
  if (useDb) {
    const u = await db.getUserByUsername(key);
    if (u) return u;
    return await db.getUserByProfileSlug(key);
  }
  const u = users.get((key || '').toLowerCase().trim());
  if (u) return u;
  return Array.from(users.values()).find((u) => (u.profileSlug || '').toLowerCase() === (key || '').toLowerCase()) || null;
}

async function userExists(key) {
  if (useDb) return await db.userExists(key);
  return users.has((key || '').toLowerCase().trim());
}

async function getAllUsersList() {
  if (useDb) return await db.getAllUsers();
  return Array.from(users.values());
}

function getLevelFromXp(xp) {
  const x = Math.max(0, xp || 0);
  return Math.max(1, Math.floor((1 + Math.sqrt(1 + 4 * x / 500)) / 2));
}

// Ensure user has all fields (for users created before new fields existed)
function ensureFields(user) {
  if (user.totalClicks === undefined) user.totalClicks = 0;
  if (user.totalWinsCount === undefined) user.totalWinsCount = 0;
  if (user.totalGamblingWins === undefined) user.totalGamblingWins = 0;
  if (user.totalClickEarnings === undefined) user.totalClickEarnings = 0;
  if (user.biggestWinAmount === undefined) user.biggestWinAmount = 0;
  if (user.biggestWinMultiplier === undefined) user.biggestWinMultiplier = 1;
  if (user.totalBets === undefined) user.totalBets = 0;
  if (user.xp === undefined) user.xp = 0;
  if (user.level === undefined) user.level = 1;
  if (user.balance === undefined) user.balance = 0;
  if (user.createdAt === undefined) user.createdAt = Date.now();
  if (user.analyticsStartedAt === undefined) user.analyticsStartedAt = Date.now();
  if (user.isAdmin === undefined) user.isAdmin = !!user.isOwner;
  if (user.role === undefined) user.role = user.isOwner ? 'owner' : (user.isAdmin ? 'admin' : null);
  if (user.role !== null && !['member', 'mod', 'admin', 'owner'].includes(user.role)) user.role = null;
  if (user.totalProfitWins === undefined) user.totalProfitWins = 0;
  if (!user.gameNet || typeof user.gameNet !== 'object') {
    user.gameNet = emptyGameNet();
  } else {
    user.gameNet = {
      click: Number(user.gameNet.click) || 0,
      plinko: Number(user.gameNet.plinko) || 0,
      roulette: Number(user.gameNet.roulette) || 0,
      slots: Number(user.gameNet.slots) || 0,
    };
  }
  if (!user.gamePlayCounts || typeof user.gamePlayCounts !== 'object') {
    user.gamePlayCounts = emptyGamePlayCounts();
  } else {
    user.gamePlayCounts = {
      click: Number(user.gamePlayCounts.click) || 0,
      plinko: Number(user.gamePlayCounts.plinko) || 0,
      roulette: Number(user.gamePlayCounts.roulette) || 0,
      slots: Number(user.gamePlayCounts.slots) || 0,
    };
  }
  if (!user.xpBySource || typeof user.xpBySource !== 'object') {
    user.xpBySource = emptyXpBySource();
  } else {
    user.xpBySource = {
      click: Number(user.xpBySource.click) || 0,
      plinko: Number(user.xpBySource.plinko) || 0,
      roulette: Number(user.xpBySource.roulette) || 0,
      slots: Number(user.xpBySource.slots) || 0,
    };
  }
  if (!user.biggestWinMeta || typeof user.biggestWinMeta !== 'object') {
    user.biggestWinMeta = {
      game: null,
      betAmount: 0,
      multiplier: user.biggestWinMultiplier || 1,
      timestamp: 0,
    };
  } else {
    user.biggestWinMeta = {
      game: user.biggestWinMeta.game || null,
      betAmount: Number(user.biggestWinMeta.betAmount) || 0,
      multiplier: Number(user.biggestWinMeta.multiplier) || (user.biggestWinMultiplier || 1),
      timestamp: Number(user.biggestWinMeta.timestamp) || 0,
    };
  }
  if (!user.plinkoRiskLevel) user.plinkoRiskLevel = 'low';
  if (user.chatMutedUntil === undefined) user.chatMutedUntil = null;
  if (user.chatRulesAccepted === undefined) user.chatRulesAccepted = false;
  if (!user.plinkoRiskUnlocked || typeof user.plinkoRiskUnlocked !== 'object') {
    user.plinkoRiskUnlocked = { medium: false, high: false, extreme: false };
  } else {
    user.plinkoRiskUnlocked = {
      medium: !!user.plinkoRiskUnlocked.medium,
      high: !!user.plinkoRiskUnlocked.high,
      extreme: !!user.plinkoRiskUnlocked.extreme,
    };
  }
  return user;
}

function publicUser(u) {
  ensureProfileSlug(u);
  const role = (u.role != null && ['member', 'mod', 'admin', 'owner'].includes(u.role)) ? u.role : null;
  return {
    username: u.username,
    profileSlug: u.profileSlug,
    displayName: u.displayName || u.username,
    isOwner: !!(u.isOwner || u.role === 'owner'),
    isAdmin: !!(u.isOwner || u.isAdmin || u.role === 'owner' || u.role === 'admin'),
    role,
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
    biggestWinMeta: u.biggestWinMeta || { game: null, betAmount: 0, multiplier: 1, timestamp: 0 },
    totalProfitWins: u.totalProfitWins || 0,
    analyticsStartedAt: u.analyticsStartedAt || u.createdAt || Date.now(),
    gameNet: u.gameNet || emptyGameNet(),
    gamePlayCounts: u.gamePlayCounts || emptyGamePlayCounts(),
    xpBySource: u.xpBySource || emptyXpBySource(),
    plinkoRiskLevel: u.plinkoRiskLevel || 'low',
    plinkoRiskUnlocked: u.plinkoRiskUnlocked || { medium: false, high: false, extreme: false },
    chatMutedUntil: u.chatMutedUntil != null ? u.chatMutedUntil : null,
    chatRulesAccepted: !!u.chatRulesAccepted,
    createdAt: u.createdAt != null ? u.createdAt : null,
  };
}

/** Generate a unique profile id for URLs (never use email). Always use this for new users. */
async function generateUniqueProfileSlug() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const slug = 'u' + crypto.randomBytes(6).toString('hex');
    if (useDb) {
      const existing = await db.getUserByProfileSlug(slug);
      if (!existing) return slug;
    } else {
      const exists = Array.from(users.values()).some((u) => (u.profileSlug || '').toLowerCase() === slug.toLowerCase());
      if (!exists) return slug;
    }
  }
  return 'u' + crypto.randomBytes(6).toString('hex');
}

/** Ensure user has a safe profile slug (no email in URL). Fixes legacy users. Returns true if slug was changed. */
function ensureProfileSlug(user) {
  const unsafe = !user.profileSlug ||
    (typeof user.profileSlug === 'string' && user.profileSlug.includes('@')) ||
    (typeof user.username === 'string' && user.username.includes('@') && (user.profileSlug || '').toLowerCase() === (user.username || '').toLowerCase());
  if (unsafe) {
    user.profileSlug = 'u' + crypto.randomBytes(6).toString('hex');
    return true;
  }
  return false;
}

function publicProfile(u) {
  ensureProfileSlug(u);
  return {
    username: u.username,
    profileSlug: u.profileSlug,
    displayName: u.displayName || u.username,
    isOwner: !!u.isOwner,
    role: (u.role != null && ['member', 'mod', 'admin', 'owner'].includes(u.role)) ? u.role : null,
    totalGamblingWins: u.totalGamblingWins,
    totalClickEarnings: u.totalClickEarnings,
    totalBets: u.totalBets || 0,
    level: u.level,
    xp: u.xp || 0,
    totalClicks: u.totalClicks || 0,
    totalWinsCount: u.totalWinsCount || 0,
    biggestWinAmount: u.biggestWinAmount || 0,
    biggestWinMultiplier: u.biggestWinMultiplier || 1,
    biggestWinMeta: u.biggestWinMeta || { game: null, betAmount: 0, multiplier: 1, timestamp: 0 },
    totalProfitWins: u.totalProfitWins || 0,
    analyticsStartedAt: u.analyticsStartedAt || u.createdAt || Date.now(),
    gameNet: u.gameNet || emptyGameNet(),
    gamePlayCounts: u.gamePlayCounts || emptyGamePlayCounts(),
    xpBySource: u.xpBySource || emptyXpBySource(),
    createdAt: u.createdAt != null ? u.createdAt : null,
  };
}

// ===== AUTH =====

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, displayName } = req.body;
    const userKey = (username || '').toLowerCase().trim();
    if (!userKey || !password || userKey.length < 3 || password.length < 3) {
      return res.status(400).json({ error: 'Username and password must be at least 3 characters' });
    }
    if (await userExists(userKey)) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    const profileSlug = await generateUniqueProfileSlug();
    const user = {
      username: userKey,
      profileSlug,
      password: bcrypt.hashSync(password, 10),
      displayName: (displayName || '').trim() || userKey,
      role: null,
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
      biggestWinMeta: { game: null, betAmount: 0, multiplier: 1, timestamp: 0 },
      totalProfitWins: 0,
      analyticsStartedAt: Date.now(),
      gameNet: emptyGameNet(),
      gamePlayCounts: emptyGamePlayCounts(),
      xpBySource: emptyXpBySource(),
      plinkoRiskLevel: 'low',
      plinkoRiskUnlocked: { medium: false, high: false, extreme: false },
      createdAt: Date.now(),
    };
    if (!useDb) users.set(userKey, user);
    await saveUser(user);
    await addAdminLog({ type: 'user_registered', targetUsername: userKey, targetDisplayName: user.displayName });
    const token = generateToken();
    if (useDb) await db.setSession(token, userKey);
    else { sessions.set(token, userKey); saveSessionsSync(); }
    res.json({ token, user: publicUser(user) });
  } catch (e) {
    console.error('Register error:', e);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const userKey = (username || '').toLowerCase().trim();
    const user = await getUserId(userKey);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    let passwordMatch = false;
    let isBcryptHash = false;
    try {
      isBcryptHash = typeof user.password === 'string' && user.password.startsWith('$2');
      passwordMatch = isBcryptHash
        ? bcrypt.compareSync(password, user.password)
        : user.password === password;
    } catch (e) {
      console.error('Login password check error:', e.message);
      return res.status(500).json({ error: 'Login error. Please try again.' });
    }
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Wrong password' });
    }
    if (!isBcryptHash) {
      user.password = bcrypt.hashSync(password, 10);
      await saveUser(user);
    }
    ensureFields(user);
    const token = generateToken();
    if (useDb) await db.setSession(token, userKey);
    else { sessions.set(token, userKey); saveSessionsSync(); }
    res.json({ token, user: publicUser(user) });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    if (useDb) await db.deleteSession(token);
    else { sessions.delete(token); saveSessionsSync(); }
  }
  res.json({ success: true });
});

// ----- Admin (owner, admin, or mod) -----
function requireAdmin(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  getUserFromSession(token)
    .then((user) => {
      if (!user) return res.status(401).json({ error: 'Not authenticated' });
      ensureFields(user);
      const canAdmin = user.isOwner || user.isAdmin || user.role === 'mod' || user.role === 'owner';
      if (!canAdmin) return res.status(403).json({ error: 'Forbidden' });
      req.adminUser = user;
      next();
    })
    .catch(next);
}

function requireOwner(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  getUserFromSession(token).then((user) => {
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    ensureFields(user);
    if (!(user.isOwner || user.role === 'owner')) return res.status(403).json({ error: 'Forbidden' });
    req.adminUser = user;
    next();
  }).catch(next);
}

function adminSafeUser(u) {
  ensureFields(u);
  ensureProfileSlug(u);
  const level = getLevelFromXp(u.xp || 0);
  return {
    username: u.username,
    profileSlug: u.profileSlug,
    displayName: u.displayName || u.username,
    balance: u.balance ?? 0,
    level,
    xp: u.xp || 0,
    totalClicks: u.totalClicks || 0,
    totalBets: u.totalBets || 0,
    totalGamblingWins: u.totalGamblingWins || 0,
    totalWinsCount: u.totalWinsCount || 0,
    biggestWinAmount: u.biggestWinAmount || 0,
    biggestWinMultiplier: u.biggestWinMultiplier || 1,
    isOwner: !!u.isOwner,
    isAdmin: !!(u.isOwner || u.isAdmin),
    role: (u.role != null && ['member', 'mod', 'admin', 'owner'].includes(u.role)) ? u.role : null,
    createdAt: u.createdAt || null,
    chatMutedUntil: u.chatMutedUntil != null ? u.chatMutedUntil : null,
  };
}

app.post('/api/admin/users/:username/mute', requireAdmin, async (req, res) => {
  try {
    const key = (req.params.username || '').toLowerCase().trim();
    const user = await getUserByKeyOrSlug(key);
    if (!user) return res.status(404).json({ error: 'User not found' });
    ensureFields(user);
    const body = req.body || {};
    if (body.unmute === true || (body.minutes !== undefined && Number(body.minutes) === 0)) {
      user.chatMutedUntil = null;
    } else {
      let until = body.until != null ? Number(body.until) : null;
      if (until == null && body.minutes != null) {
        const min = Number(body.minutes);
        if (!Number.isFinite(min) || min < 0) return res.status(400).json({ error: 'Invalid minutes' });
        until = min > 0 ? Date.now() + min * 60 * 1000 : null;
      }
      if (until != null) user.chatMutedUntil = until;
    }
    if (!useDb) users.set(user.username, user);
    await saveUser(user);
    await addAdminLog({
      type: 'chat_mute',
      actorUsername: req.adminUser.username,
      actorDisplayName: req.adminUser.displayName,
      targetUsername: user.username,
      targetDisplayName: user.displayName,
      meta: user.chatMutedUntil != null ? { until: user.chatMutedUntil, minutes: body.minutes } : { unmute: true },
    });
    res.json({ chatMutedUntil: user.chatMutedUntil });
  } catch (e) {
    console.error('Mute error:', e);
    res.status(500).json({ error: 'Failed to update mute' });
  }
});

app.post('/api/admin/users/:username/role', requireAdmin, async (req, res) => {
  try {
    const key = (req.params.username || '').toLowerCase().trim();
    const user = await getUserByKeyOrSlug(key);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const role = (req.body.role || '').toLowerCase().trim();
    if (!['member', 'mod', 'admin', 'owner'].includes(role)) return res.status(400).json({ error: 'Invalid role. Use member, mod, admin, or owner.' });
    if (role === 'owner' && !(req.adminUser.isOwner || req.adminUser.role === 'owner')) return res.status(403).json({ error: 'Only owner can assign owner role' });
    ensureFields(user);
    user.role = role;
    user.isOwner = role === 'owner';
    user.isAdmin = role === 'admin' || role === 'owner';
    if (!useDb) users.set(user.username, user);
    await saveUser(user);
    await addAdminLog({ type: 'role_assigned', actorUsername: req.adminUser.username, actorDisplayName: req.adminUser.displayName, targetUsername: user.username, targetDisplayName: user.displayName, role });
    res.json(adminSafeUser(user));
  } catch (e) {
    console.error('Role assign error:', e);
    res.status(500).json({ error: 'Failed to set role' });
  }
});

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const list = (await getAllUsersList()).map((u) => adminSafeUser(u));
    res.json(list);
  } catch (e) {
    console.error('Admin users list error:', e);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

app.get('/api/admin/users/:username', requireAdmin, async (req, res) => {
  try {
    const key = (req.params.username || '').toLowerCase().trim();
    const user = await getUserByKeyOrSlug(key);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (ensureProfileSlug(user)) {
      if (!useDb) users.set(user.username, user);
      await saveUser(user);
    }
    res.json(adminSafeUser(user));
  } catch (e) {
    console.error('Admin user detail error:', e);
    res.status(500).json({ error: 'Failed to load user' });
  }
});

app.get('/api/admin/users/:username/chat-logs', requireAdmin, async (req, res) => {
  try {
    const key = (req.params.username || '').toLowerCase().trim();
    const user = await getUserByKeyOrSlug(key);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const targetUsername = (user.username || '').toLowerCase();
    const logs = chatMessages
      .filter((m) => (m.username || '').toLowerCase() === targetUsername)
      .map((m) => ({ text: m.text, time: m.time, displayName: m.displayName, role: m.role }))
      .slice(-500);
    res.json({ messages: logs.reverse() });
  } catch (e) {
    console.error('Admin chat logs error:', e);
    res.status(500).json({ error: 'Failed to load chat logs' });
  }
});

app.post('/api/admin/users/:username/adjust', requireAdmin, async (req, res) => {
  if (req.adminUser.role === 'mod') return res.status(403).json({ error: 'Only Admin or Owner can adjust XP or money' });
  try {
    const key = (req.params.username || '').toLowerCase().trim();
    const user = await getUserByKeyOrSlug(key);
    if (!user) return res.status(404).json({ error: 'User not found' });
    ensureFields(user);
    const { type, value } = req.body;
    const num = typeof value === 'number' ? value : parseInt(String(value || '').trim(), 10);
    if (!Number.isFinite(num)) return res.status(400).json({ error: 'Invalid value' });
    if (type === 'xp') {
      user.xp = Math.max(0, (user.xp || 0) + num);
      user.level = getLevelFromXp(user.xp);
      if (!useDb) users.set(user.username, user);
      await saveUser(user);
      await addAdminLog({ type: 'adjust', actorUsername: req.adminUser.username, actorDisplayName: req.adminUser.displayName, targetUsername: user.username, targetDisplayName: user.displayName, adjustType: 'xp', value: num });
      return res.json({ username: user.username, xp: user.xp, level: user.level });
    }
    if (type === 'money') {
      user.balance = Math.max(0, (user.balance ?? 0) + num);
      if (!useDb) users.set(user.username, user);
      await saveUser(user);
      await addAdminLog({ type: 'adjust', actorUsername: req.adminUser.username, actorDisplayName: req.adminUser.displayName, targetUsername: user.username, targetDisplayName: user.displayName, adjustType: 'money', value: num });
      return res.json({ username: user.username, balance: user.balance });
    }
    return res.status(400).json({ error: 'Invalid type. Use "xp" or "money".' });
  } catch (e) {
    console.error('Adjust error:', e);
    res.status(500).json({ error: 'Failed to adjust' });
  }
});

app.get('/api/admin/logs', requireOwner, async (req, res) => {
  try {
    const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 500), 1000);
    const list = useDb ? await db.getAdminLogs(limit) : adminLogs.slice(-limit).reverse();
    res.json(list);
  } catch (e) {
    console.error('Admin logs error:', e);
    res.status(500).json({ error: 'Failed to load logs' });
  }
});

// Public profile (no balance, no email) – for viewing other users. Lookup by username or profileSlug.
app.get('/api/user/:slug/profile', async (req, res) => {
  const slug = (req.params.slug || '').trim();
  if (!slug) return res.status(400).json({ error: 'Profile identifier required' });
  const user = await getUserByKeyOrSlug(slug);
  if (!user) return res.status(404).json({ error: 'User not found' });
  ensureFields(user);
  if (ensureProfileSlug(user)) {
    if (!useDb) users.set(user.username, user);
    await saveUser(user);
  }
  user.level = getLevelFromXp(user.xp);
  res.json(publicProfile(user));
});

// ===== STATS =====

app.get('/api/user/stats', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  ensureFields(user);
  user.level = getLevelFromXp(user.xp);
  res.json(publicUser(user));
});

// Accept chat rules (one-time; stored per user)
app.post('/api/user/chat-rules-accept', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  ensureFields(user);
  user.chatRulesAccepted = true;
  if (!useDb) users.set(user.username, user);
  await saveUser(user);
  res.json({ chatRulesAccepted: true });
});

// ===== CHAT =====
// Mute and rate limits are enforced only on the server. Clients cannot bypass via API, console or any request.
const CHAT_API_LIMIT = 100;
app.get('/api/chat', (req, res) => {
  res.json({ messages: chatMessages.slice(-CHAT_API_LIMIT) });
});

app.post('/api/chat', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  ensureFields(user);
  const now = Date.now();
  const key = user.username;

  if (user.chatMutedUntil != null && user.chatMutedUntil > now) {
    return res.status(403).json({
      error: 'Muted until [date][time]',
      mutedUntil: user.chatMutedUntil,
      code: 'CHAT_MUTED',
    });
  }
  if (chatRateLimitMutedUntil[key] != null && chatRateLimitMutedUntil[key] > now) {
    const secs = Math.ceil((chatRateLimitMutedUntil[key] - now) / 1000);
    return res.status(403).json({
      error: 'You are sending messages too fast - Muted for ' + secs + 's',
      mutedUntil: chatRateLimitMutedUntil[key],
      code: 'CHAT_RATE_MUTED',
    });
  }
  const last = chatLastSend[key];
  if (last != null && now - last < CHAT_DELAY_MS) {
    const waitSec = Math.ceil((CHAT_DELAY_MS - (now - last)) / 1000);
    const retryAfterMs = Math.max(100, (CHAT_DELAY_MS - (now - last)));
    return res.status(429).json({
      error: 'Please wait ' + waitSec + ' second(s) between messages.',
      code: 'CHAT_DELAY',
      retryAfterMs,
    });
  }
  let recent = chatRecentSends[key] || [];
  recent = recent.filter((t) => t > now - CHAT_BURST_WINDOW_MS);
  if (recent.length >= CHAT_BURST_COUNT) {
    chatRateLimitMutedUntil[key] = now + CHAT_RATE_MUTE_MS;
    return res.status(403).json({
      error: 'You are sending messages too fast - Muted for 15s',
      mutedUntil: chatRateLimitMutedUntil[key],
      code: 'CHAT_RATE_MUTED',
    });
  }

  const text = (req.body?.text || '').toString().trim();
  if (!text || text.length > 500) return res.status(400).json({ error: 'Message must be 1–500 characters' });

  chatLastSend[key] = now;
  recent.push(now);
  chatRecentSends[key] = recent;

  ensureProfileSlug(user);
  const role = (user.role && ['member', 'mod', 'admin', 'owner'].includes(user.role)) ? user.role : null;
  const msg = {
    username: user.username,
    displayName: user.displayName || user.username,
    profileSlug: user.profileSlug || null,
    role,
    text,
    time: now,
  };
  chatMessages.push(msg);
  if (chatMessages.length > CHAT_MAX) chatMessages.shift();
  res.json({ message: msg });
});

// Only sync non-delta fields: xp, level, biggestWin
app.post('/api/user/update-stats', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  ensureFields(user);
  const { level, xp, biggestWinAmount, biggestWinMultiplier } = req.body;
  if (xp !== undefined) {
    const oldLevel = getLevelFromXp(user.xp || 0);
    user.xp = xp;
    user.level = getLevelFromXp(xp);
    const newLevel = user.level;
    if (newLevel > oldLevel) {
      const key = `${user.username}:${newLevel}`;
      const last = levelUpLogDedupe.get(key) || 0;
      const now = Date.now();
      if (now - last >= LEVEL_UP_DEDUPE_MS) {
        levelUpLogDedupe.set(key, now);
        await addAdminLog({ type: 'level_up', targetUsername: user.username, targetDisplayName: user.displayName, newLevel, previousLevel: oldLevel });
      }
    }
  } else if (level !== undefined) user.level = level;
  if (biggestWinAmount !== undefined && biggestWinAmount > user.biggestWinAmount) {
    user.biggestWinAmount = biggestWinAmount;
    user.biggestWinMultiplier = biggestWinMultiplier || 1;
  }
  if (!useDb) users.set(user.username, user);
  await saveUser(user);
  res.json({ success: true });
});

// ===== DELTA ENDPOINTS =====

app.post('/api/user/place-bet', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  ensureFields(user);
  const amount = Number(req.body.amount);
  const source = normalizeGameSource(req.body?.source);
  if (!Number.isFinite(amount) || amount < 0.01 || amount > user.balance) {
    return res.status(400).json({ error: 'Invalid bet amount or insufficient balance' });
  }
  user.balance -= amount;
  user.totalBets += 1;
  if (source && source !== 'click') {
    user.gameNet[source] -= amount;
    user.gamePlayCounts[source] += 1;
    user.xpBySource[source] += 3;
  }
  if (!useDb) users.set(user.username, user);
  await saveUser(user);
  res.json({ balance: user.balance, totalBets: user.totalBets });
});

app.post('/api/user/win', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  ensureFields(user);
  const amount = Number(req.body.amount);
  const multiplier = req.body.multiplier != null ? Number(req.body.multiplier) : null;
  const betAmount = req.body.betAmount != null ? Number(req.body.betAmount) : null;
  const source = normalizeGameSource(req.body?.source);
  if (!Number.isFinite(amount) || amount < 0) {
    return res.status(400).json({ error: 'Invalid win amount' });
  }
  user.balance += amount;
  user.totalGamblingWins += amount;
  if (source && source !== 'click') {
    user.gameNet[source] += amount;
  }
  const isProfit = betAmount != null ? amount > betAmount : true;
  if (amount > 0 && isProfit) {
    const profit = Math.max(0, amount - (Number.isFinite(betAmount) ? betAmount : 0));
    user.totalProfitWins += profit;
    user.totalWinsCount += 1;
    if (source) user.xpBySource[source] += 3;
    if (amount > user.biggestWinAmount) {
      user.biggestWinAmount = amount;
      user.biggestWinMultiplier = (multiplier != null && Number.isFinite(multiplier)) ? multiplier : 1;
      user.biggestWinMeta = {
        game: source,
        betAmount: Number.isFinite(betAmount) ? betAmount : 0,
        multiplier: user.biggestWinMultiplier,
        timestamp: Date.now(),
      };
    }
  }
  if (!useDb) users.set(user.username, user);
  await saveUser(user);
  res.json({
    balance: user.balance,
    totalGamblingWins: user.totalGamblingWins,
    totalWinsCount: user.totalWinsCount,
    biggestWinAmount: user.biggestWinAmount,
    biggestWinMultiplier: user.biggestWinMultiplier,
  });
});

// Refund: adds to balance only (no win tracking)
app.post('/api/user/refund', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    return res.status(400).json({ error: 'Invalid refund amount' });
  }
  user.balance += amount;
  if (!useDb) users.set(user.username, user);
  await saveUser(user);
  res.json({ balance: user.balance });
});

app.post('/api/plinko/risk-level', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  ensureFields(user);

  const level = String(req.body?.level || '').toLowerCase().trim();
  if (!['low', 'medium', 'high', 'extreme'].includes(level)) {
    return res.status(400).json({ error: 'Invalid risk level' });
  }

  if (level === 'low') {
    user.plinkoRiskLevel = 'low';
  } else if (user.plinkoRiskUnlocked[level]) {
    user.plinkoRiskLevel = level;
  } else {
    if (level === 'high' && !user.plinkoRiskUnlocked.medium) {
      return res.status(400).json({ error: 'Unlock Medium first' });
    }
    if (level === 'extreme' && !user.plinkoRiskUnlocked.high) {
      return res.status(400).json({ error: 'Unlock High first' });
    }
    const cost = PLINKO_RISK_COSTS[level];
    if (!Number.isFinite(cost) || cost <= 0) {
      return res.status(400).json({ error: 'Invalid unlock configuration' });
    }
    if (user.balance < cost) {
      return res.status(400).json({ error: 'Insufficient balance for unlock' });
    }
    user.balance -= cost;
    user.plinkoRiskUnlocked[level] = true;
    user.plinkoRiskLevel = level;
  }

  if (!useDb) users.set(user.username, user);
  await saveUser(user);
  res.json({
    balance: user.balance,
    plinkoRiskLevel: user.plinkoRiskLevel,
    plinkoRiskUnlocked: user.plinkoRiskUnlocked,
  });
});

app.post('/api/user/click-earnings', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
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
  user.gameNet.click += capped;
  user.gamePlayCounts.click += cappedClicks;
  user.xpBySource.click += cappedClicks * 3;
  if (!useDb) users.set(user.username, user);
  await saveUser(user);
  res.json({ balance: user.balance, totalClickEarnings: user.totalClickEarnings, totalClicks: user.totalClicks });
});

// ===== LEADERBOARD =====

function validLeaderboardType(type) {
  return ['clicks', 'wins', 'biggest-win', 'networth', 'xp', 'level'].includes(type);
}

async function buildLeaderboardRows(type) {
  const list = await getAllUsersList();
  const allUsers = list.map(u => {
    ensureFields(u);
    ensureProfileSlug(u);
    const xp = u.xp || 0;
    const level = getLevelFromXp(xp);
    return {
      username: u.username,
      profileSlug: u.profileSlug,
      displayName: u.displayName || u.username,
      isOwner: !!u.isOwner,
      balance: u.balance ?? 0,
      level,
      xp,
      totalClicks: u.totalClicks || 0,
      totalClickEarnings: u.totalClickEarnings || 0,
      totalGamblingWins: u.totalGamblingWins || 0,
      totalProfitWins: u.totalProfitWins || 0,
      totalWinsCount: u.totalWinsCount || 0,
      biggestWinAmount: u.biggestWinAmount || 0,
      biggestWinMultiplier: u.biggestWinMultiplier || 1,
      biggestWinMeta: u.biggestWinMeta || { game: null, betAmount: 0, multiplier: 1, timestamp: 0 },
      gameNet: u.gameNet || emptyGameNet(),
      gamePlayCounts: u.gamePlayCounts || emptyGamePlayCounts(),
      xpBySource: u.xpBySource || emptyXpBySource(),
      analyticsStartedAt: u.analyticsStartedAt || u.createdAt || Date.now(),
    };
  });
  let sorted;
  if (type === 'clicks') sorted = allUsers.sort((a, b) => b.totalClicks - a.totalClicks);
  else if (type === 'wins') sorted = allUsers.sort((a, b) => (b.totalGamblingWins || 0) - (a.totalGamblingWins || 0));
  else if (type === 'biggest-win') sorted = allUsers.sort((a, b) => b.biggestWinAmount - a.biggestWinAmount);
  else if (type === 'networth') sorted = allUsers.sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0));
  else if (type === 'xp') sorted = allUsers.sort((a, b) => b.xp - a.xp);
  else if (type === 'level') sorted = allUsers.sort((a, b) => b.level - a.level || b.xp - a.xp);
  else sorted = allUsers;
  return sorted;
}

function getTopGamesFromCounts(gamePlayCounts) {
  const gameLabel = (key) => {
    if (key === 'plinko') return 'Plinko';
    if (key === 'roulette') return 'Roulette';
    if (key === 'slots') return 'Slots';
    if (key === 'click') return 'Click';
    return key;
  };
  const entries = Object.entries(gamePlayCounts || {})
    .filter(([key]) => key !== 'click')
    .map(([key, count]) => [key, Number(count) || 0])
    .sort((a, b) => b[1] - a[1]);
  return entries.slice(0, 3).map(([key]) => gameLabel(key));
}

app.get('/api/leaderboard/:type', async (req, res) => {
  const { type } = req.params;
  if (!validLeaderboardType(type)) {
    return res.status(400).json({ error: 'Invalid leaderboard type' });
  }
  const sorted = await buildLeaderboardRows(type);
  res.json(sorted.slice(0, 100));
});

app.get('/api/leaderboard/:type/user/:slug', async (req, res) => {
  const { type, slug } = req.params;
  if (!validLeaderboardType(type)) {
    return res.status(400).json({ error: 'Invalid leaderboard type' });
  }
  const sorted = await buildLeaderboardRows(type);
  const normalizedSlug = String(slug || '').toLowerCase().trim();
  const idx = sorted.findIndex((u) =>
    (u.profileSlug || '').toLowerCase() === normalizedSlug ||
    (u.username || '').toLowerCase() === normalizedSlug
  );
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  const user = sorted[idx];
  const now = Date.now();
  const startedAt = Number(user.analyticsStartedAt) || now;
  const daysActive = Math.max(1, (now - startedAt) / (1000 * 60 * 60 * 24));
  const gameLabel = (key) => {
    if (key === 'plinko') return 'Plinko';
    if (key === 'roulette') return 'Roulette';
    if (key === 'slots') return 'Slots';
    if (key === 'click') return 'Click';
    return key || null;
  };
  res.json({
    type,
    rank: idx + 1,
    username: user.username,
    profileSlug: user.profileSlug,
    displayName: user.displayName,
    level: user.level,
    xp: user.xp,
    balance: user.balance,
    totalClicks: user.totalClicks,
    totalClickEarnings: user.totalClickEarnings,
    avgClicksPerDay: Math.round((user.totalClicks || 0) / daysActive),
    totalGamblingWins: user.totalGamblingWins,
    totalProfitWins: user.totalProfitWins || 0,
    totalWinsCount: user.totalWinsCount,
    biggestWinAmount: user.biggestWinAmount,
    biggestWinMultiplier: user.biggestWinMultiplier,
    biggestWinBetAmount: user.biggestWinMeta?.betAmount || 0,
    biggestWinGame: gameLabel(user.biggestWinMeta?.game || null),
    biggestWinTimestamp: user.biggestWinMeta?.timestamp || 0,
    netByGame: user.gameNet || emptyGameNet(),
    xpBySource: user.xpBySource || emptyXpBySource(),
    topGames: getTopGamesFromCounts(user.gamePlayCounts),
    analyticsStartedAt: startedAt,
  });
});

app.post('/api/plinko-land', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const { slotIndex, bet, multiplier } = req.body;
  const si = typeof slotIndex === 'number' ? Math.floor(slotIndex) : -1;
  const idx = si >= 0 && si <= 17 ? si : 18;
  plinkoStats.totalBalls += 1;
  plinkoStats.landings[idx] = (plinkoStats.landings[idx] || 0) + 1;
  await savePlinkoStats();
  res.json({ ok: true });
});

// Plinko stats – public, read-only (hvor mange baller har landet i hver slot)
app.get('/api/plinko-stats', (req, res) => {
  const total = plinkoStats.totalBalls;
  const slots = plinkoStats.landings.slice(0, 18).map((n, i) => ({
    slot: i,
    count: n,
    pct: total > 0 ? ((n / total) * 100).toFixed(2) + '%' : '0%',
  }));
  const edge = plinkoStats.landings[18] || 0;
  res.json({
    totalBalls: total,
    slots,
    edgeCount: edge,
    edgePct: total > 0 ? ((edge / total) * 100).toFixed(2) + '%' : '0%',
  });
});

app.get('/api/admin/plinko-stats', (req, res) => {
  const key = req.query.key || req.headers['x-admin-key'];
  if (!process.env.ADMIN_RESET_KEY || key !== process.env.ADMIN_RESET_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const total = plinkoStats.totalBalls;
  const slots = plinkoStats.landings.slice(0, 18).map((n, i) => ({
    slot: i,
    count: n,
    pct: total > 0 ? ((n / total) * 100).toFixed(2) + '%' : '0%',
  }));
  const edge = plinkoStats.landings[18] || 0;
  res.json({
    totalBalls: total,
    slots,
    edgeCount: edge,
    edgePct: total > 0 ? ((edge / total) * 100).toFixed(2) + '%' : '0%',
  });
});

// Admin: reset all data (for beta end, etc). Requires ADMIN_RESET_KEY env.
app.post('/api/admin/reset', async (req, res) => {
  const key = req.body?.key || req.headers['x-admin-key'];
  if (!process.env.ADMIN_RESET_KEY || key !== process.env.ADMIN_RESET_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (useDb) {
    try {
      const client = await db.getPool().connect();
      await client.query('DELETE FROM sessions');
      await client.query('DELETE FROM users');
      await client.query('DELETE FROM admin_logs');
      await client.query('UPDATE plinko_stats SET total_balls = 0, landings = $1 WHERE id = 1', [JSON.stringify(Array(19).fill(0))]);
      client.release();
      plinkoStats.totalBalls = 0;
      plinkoStats.landings = Array(19).fill(0);
    } catch (e) {
      console.error('Admin reset DB error:', e);
      return res.status(500).json({ error: 'Reset failed' });
    }
  } else {
    users.clear();
    sessions.clear();
    saveUsersSync();
    saveSessionsSync();
  }
  console.log('Admin reset: all data cleared');
  res.json({ success: true });
});

// ===== ROULETTE ROUND SYSTEM =====
const ROULETTE_BETTING_MS = 20000;
const ROULETTE_SPINNING_MS = 5000;
const ROULETTE_RESULT_MS = 3000;
const ROULETTE_RED = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
const ROULETTE_STRICT_CASINO_MODE = true;

const rouletteState = {
  roundId: 1,
  phase: 'betting',
  phaseEndTime: Date.now() + ROULETTE_BETTING_MS,
  winNumber: null,
  bets: new Map(),       // username -> [{key, amount}]
  recentWinners: [],     // last 20
};

function rouletteTick() {
  const now = Date.now();
  if (now < rouletteState.phaseEndTime) return;
  if (rouletteState.phase === 'betting') {
    rouletteState.winNumber = Math.floor(Math.random() * 37);
    rouletteState.phase = 'spinning';
    rouletteState.phaseEndTime = now + ROULETTE_SPINNING_MS;
  } else if (rouletteState.phase === 'spinning') {
    resolveAllRouletteBets().catch((e) => console.error('resolveAllRouletteBets error:', e));
    rouletteState.phase = 'result';
    rouletteState.phaseEndTime = now + ROULETTE_RESULT_MS;
  } else if (rouletteState.phase === 'result') {
    rouletteState.roundId += 1;
    rouletteState.phase = 'betting';
    rouletteState.phaseEndTime = now + ROULETTE_BETTING_MS;
    rouletteState.winNumber = null;
    rouletteState.bets = new Map();
    rouletteState.recentWinners = [];
  }
}

function isRouletteWin(key, n) {
  if (key === String(n)) return true;
  const isR = ROULETTE_RED.includes(n);
  if (key === 'red' && isR) return true;
  if (key === 'black' && n !== 0 && !isR) return true;
  if (key === 'odd' && n !== 0 && n % 2 === 1) return true;
  if (key === 'even' && n !== 0 && n % 2 === 0) return true;
  if (key === '1-18' && n >= 1 && n <= 18) return true;
  if (key === '19-36' && n >= 19 && n <= 36) return true;
  if (key === '1-12' && n >= 1 && n <= 12) return true;
  if (key === '13-24' && n >= 13 && n <= 24) return true;
  if (key === '25-36' && n >= 25 && n <= 36) return true;
  return false;
}

function roulettePayout(key) {
  const normalized = typeof key === 'string' ? key.trim() : String(key ?? '').trim();
  const num = parseInt(normalized, 10);
  if (!isNaN(num) && String(num) === normalized && num >= 0 && num <= 36) return 36;
  if (key === '1-12' || key === '13-24' || key === '25-36') return 3;
  return 2;
}

function isValidRouletteBetKey(key) {
  if (typeof key !== 'string' || !key.trim()) return false;
  const normalized = key.trim();
  const num = parseInt(normalized, 10);
  if (!isNaN(num) && String(num) === normalized && num >= 0 && num <= 36) return true;
  const outside = new Set(['1-12', '13-24', '25-36', 'red', 'black', 'odd', 'even', '1-18', '19-36']);
  return outside.has(normalized);
}

function rouletteOutsideGroup(key) {
  if (key === '1-12' || key === '13-24' || key === '25-36') return 'dozen';
  if (key === '1-18' || key === '19-36') return 'half';
  if (key === 'odd' || key === 'even') return 'parity';
  if (key === 'red' || key === 'black') return 'color';
  return null;
}

function hasStrictRouletteConflict(existingBets, incomingKey) {
  if (!ROULETTE_STRICT_CASINO_MODE) return false;
  const incomingGroup = rouletteOutsideGroup(incomingKey);
  if (!incomingGroup) return false;
  for (const b of existingBets) {
    if (rouletteOutsideGroup(b.key) === incomingGroup) {
      return true;
    }
  }
  return false;
}

async function resolveAllRouletteBets() {
  const win = rouletteState.winNumber;
  for (const [username, userBets] of rouletteState.bets) {
    const user = useDb ? await db.getUserByUsername(username) : users.get(username);
    if (!user) continue;
    ensureFields(user);
    let totalWin = 0;
    let totalBet = 0;
    let bestWinningBet = null;

    for (const { key, amount } of userBets) {
      totalBet += amount;
      if (isRouletteWin(key, win)) {
        const payout = amount * roulettePayout(key);
        if (!bestWinningBet || payout > bestWinningBet.payout) {
          bestWinningBet = { key, amount, payout };
        }
      }
    }

    // Casino rule for this project: only one winning condition is paid per round.
    if (bestWinningBet) {
      totalWin = bestWinningBet.payout;
    }

    if (totalWin > 0) {
      user.balance += totalWin;
      user.totalGamblingWins += totalWin;
      user.gameNet.roulette += totalWin;
      if (totalWin > totalBet) {
        user.totalProfitWins += (totalWin - totalBet);
        user.totalWinsCount += 1;
        user.xpBySource.roulette += 3;
        if (totalWin > user.biggestWinAmount) {
          user.biggestWinAmount = totalWin;
          user.biggestWinMultiplier = totalBet > 0 ? Math.round((totalWin / totalBet) * 100) / 100 : 1;
          user.biggestWinMeta = {
            game: 'roulette',
            betAmount: totalBet,
            multiplier: user.biggestWinMultiplier,
            timestamp: Date.now(),
          };
        }
      }
      if (!useDb) users.set(username, user);
      await saveUser(user);
      rouletteState.recentWinners.unshift({
        username: user.displayName || username,
        amount: totalWin,
        number: win,
        roundId: rouletteState.roundId,
        timestamp: Date.now(),
      });
    }
  }
  if (rouletteState.recentWinners.length > 20) {
    rouletteState.recentWinners = rouletteState.recentWinners.slice(0, 20);
  }
}

setInterval(rouletteTick, 500);

app.get('/api/roulette/round', async (req, res) => {
  rouletteTick();
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  const resp = {
    roundId: rouletteState.roundId,
    phase: rouletteState.phase,
    phaseEndTime: rouletteState.phaseEndTime,
    serverTime: Date.now(),
    winNumber: (rouletteState.phase === 'spinning' || rouletteState.phase === 'result') ? rouletteState.winNumber : null,
  };
  if (user) {
    ensureFields(user);
    resp.balance = user.balance;
    resp.myBets = rouletteState.bets.get(user.username) || [];
  }
  res.json(resp);
});

app.post('/api/roulette/bet', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  ensureFields(user);
  rouletteTick();
  if (rouletteState.phase !== 'betting') {
    return res.status(400).json({ error: 'Betting phase is over' });
  }
  const { key, amount } = req.body;
  const amt = Number(amount);
  if (!isValidRouletteBetKey(key) || !Number.isFinite(amt) || amt < 1) {
    return res.status(400).json({ error: 'Invalid bet' });
  }
  if (amt > user.balance) {
    return res.status(400).json({ error: 'Insufficient balance' });
  }
  if (!rouletteState.bets.has(user.username)) {
    rouletteState.bets.set(user.username, []);
  }
  const userBets = rouletteState.bets.get(user.username);
  if (hasStrictRouletteConflict(userBets, key)) {
    return res.status(400).json({ error: 'Strict mode: conflicting outside bet in same category is not allowed' });
  }
  user.balance -= amt;
  user.totalBets += 1;
  user.gameNet.roulette -= amt;
  user.gamePlayCounts.roulette += 1;
  user.xpBySource.roulette += 3;
  if (!useDb) users.set(user.username, user);
  await saveUser(user);
  userBets.push({ key, amount: amt });
  res.json({ balance: user.balance, totalBets: user.totalBets });
});

app.post('/api/roulette/clear-bets', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  ensureFields(user);
  rouletteTick();
  if (rouletteState.phase !== 'betting') {
    return res.status(400).json({ error: 'Cannot clear bets outside betting phase' });
  }
  const userBets = rouletteState.bets.get(user.username) || [];
  let refundTotal = 0;
  for (const b of userBets) refundTotal += b.amount;
  if (refundTotal > 0) {
    user.balance += refundTotal;
    user.gameNet.roulette += refundTotal;
    if (!useDb) users.set(user.username, user);
    await saveUser(user);
  }
  rouletteState.bets.delete(user.username);
  res.json({ balance: user.balance, refunded: refundTotal });
});

app.get('/api/roulette/winners', (req, res) => {
  res.json(rouletteState.recentWinners);
});

app.get('/api/roulette/all-bets', (req, res) => {
  const agg = new Map();
  for (const [username, userBets] of rouletteState.bets) {
    for (const { key, amount } of userBets) {
      const cur = agg.get(key) || { key, total: 0, players: new Set() };
      cur.total += amount;
      cur.players.add(username);
      agg.set(key, cur);
    }
  }
  res.json(Array.from(agg.entries()).map(([k, v]) => ({
    key: k,
    total: v.total,
    count: v.players.size,
  })).sort((a, b) => b.total - a.total));
});

async function start() {
  loadData();
  if (useDb) {
    try {
      await db.ensureTables();
      const ps = await db.getPlinkoStats();
      plinkoStats.totalBalls = ps.totalBalls ?? 0;
      plinkoStats.landings = Array.isArray(ps.landings) ? ps.landings : Array(19).fill(0);
      while (plinkoStats.landings.length < 19) plinkoStats.landings.push(0);
    } catch (e) {
      console.error('Database startup failed:', e.message || e);
      console.error('Stack:', e.stack);
      console.error('Sjekk at scripts/init-db.sql er kjort i Supabase og at DATABASE_URL er riktig i Render.');
      throw e;
    }
  }
  app.listen(PORT, () => {
    console.log(`Gambleio server running on http://localhost:${PORT}`);
    if (!useDb && DATA_DIR !== path.join(__dirname, 'data')) {
      console.log(`Data dir: ${DATA_DIR}`);
    }
    if (useDb) console.log('Storage: database (DATABASE_URL)');
  });
}
start().catch((e) => {
  console.error('Startup failed:', e.message || e);
  if (e.stack) console.error(e.stack);
  process.exit(1);
});
