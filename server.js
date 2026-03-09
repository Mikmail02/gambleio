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
const caseBattleMath = require('./lib/case-battle-math');
const caseBattleProvably = require('./lib/case-battle-provably-fair');
const blackjackCore = require('./lib/blackjack-core');

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const PLINKO_STATS_FILE = path.join(DATA_DIR, 'plinko-stats.json');
const ADMIN_LOGS_FILE = path.join(DATA_DIR, 'admin-logs.json');
const CHAT_MESSAGES_FILE = path.join(DATA_DIR, 'chat-messages.json');

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

const rateLimitUpdateStats = {};
const rateLimitWin = {};
const rateLimitRefund = {};
const RATE_LIMIT_UPDATE_STATS_PER_MIN = 30;
const RATE_LIMIT_WIN_PER_MIN = 60;
const RATE_LIMIT_REFUND_PER_MIN = 20;

const MAX_XP_INCREASE_PER_SYNC = 10000;
const MAX_WIN_AMOUNT_PER_REQUEST = 100_000_000;
const MAX_BIGGEST_WIN_AMOUNT = 10_000_000;
const MAX_REFUND_AMOUNT_PER_REQUEST = 1_000_000;

function checkRateLimit(store, key, maxPerMin) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  if (!store[key]) store[key] = [];
  const arr = store[key];
  const cutoff = now - windowMs;
  while (arr.length && arr[0] < cutoff) arr.shift();
  if (arr.length >= maxPerMin) return false;
  arr.push(now);
  return true;
}

function loadData() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(CHAT_MESSAGES_FILE)) {
      const arr = JSON.parse(fs.readFileSync(CHAT_MESSAGES_FILE, 'utf8'));
      if (Array.isArray(arr)) {
        chatMessages.length = 0;
        chatMessages.push(...arr.slice(-CHAT_MAX));
        console.log(`Loaded ${chatMessages.length} chat messages`);
      }
    }
  } catch (e) {
    console.warn('Could not load chat:', e.message);
  }
  if (useDb) return;
  try {
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

function saveChatMessages() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CHAT_MESSAGES_FILE, JSON.stringify(chatMessages.slice(-CHAT_MAX), null, 2));
  } catch (e) {
    console.error('Failed to save chat messages:', e.message);
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
const PLINKO_MAX_BET_BY_RISK = { low: 100, medium: 1000, high: 10000, extreme: 100000 };
const PLINKO_ODDS = {
  low: [0.8, 1.8, 3, 5, 7, 9.7, 15.3, 9.7, 7, 7, 9.7, 15.3, 9.7, 7, 5, 3, 1.8, 0.8],
  medium: [0.6, 1.4, 2.4, 4, 6, 8.5, 13.5, 8.5, 6.5, 6.5, 8.5, 13.5, 8.5, 6.5, 4, 2.4, 1.4, 0.6],
  high: [0.4, 1, 1.8, 3.2, 5, 7.5, 12, 7.5, 6, 6, 7.5, 12, 7.5, 6, 5, 3.2, 1.8, 0.4],
  extreme: [0.05, 0.2, 0.4, 0.6, 1.5, 3, 5, 16, 60, 60, 16, 5, 3, 1.5, 0.6, 0.4, 0.2, 0.05],
};
const PLINKO_MULTIPLIERS = {
  low: [15, 8.5, 4.3, 2.7, 1.3, 1.1, 1, 0.8, 0.5, 0.5, 0.8, 1, 1.1, 1.3, 2.7, 4.3, 8.5, 15],
  medium: [20, 10, 5, 2.5, 1.2, 1, 0.8, 0.6, 0.3, 0.3, 0.6, 0.8, 1, 1.2, 2.5, 5, 10, 20],
  high: [50, 25, 10, 3, 1, 0.5, 0.3, 0.2, 0.1, 0.1, 0.2, 0.3, 0.5, 1, 3, 10, 25, 50],
  extreme: [1000, 100, 20, 5, 1, 0.2, 0.1, 0.05, 0.01, 0.01, 0.05, 0.1, 0.2, 1, 5, 20, 100, 1000],
};
const TRACKED_GAME_SOURCES = ['click', 'plinko', 'roulette', 'slots', 'crash', 'mines', 'blackjack'];

function emptyGameNet() {
  return { click: 0, plinko: 0, roulette: 0, slots: 0, crash: 0, mines: 0, blackjack: 0 };
}

function emptyGamePlayCounts() {
  return { click: 0, plinko: 0, roulette: 0, slots: 0, crash: 0, mines: 0, blackjack: 0 };
}

function emptyXpBySource() {
  return { click: 0, plinko: 0, roulette: 0, slots: 0, crash: 0, mines: 0, blackjack: 0 };
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
  if (user.gambleLockedUntil === undefined) user.gambleLockedUntil = null;
  if (!user.gameNet || typeof user.gameNet !== 'object') {
    user.gameNet = emptyGameNet();
  } else {
    user.gameNet = {
      click: Number(user.gameNet.click) || 0,
      plinko: Number(user.gameNet.plinko) || 0,
      roulette: Number(user.gameNet.roulette) || 0,
      slots: Number(user.gameNet.slots) || 0,
      crash: Number(user.gameNet.crash) || 0,
      mines: Number(user.gameNet.mines) || 0,
      blackjack: Number(user.gameNet.blackjack) || 0,
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
      crash: Number(user.gamePlayCounts.crash) || 0,
      mines: Number(user.gamePlayCounts.mines) || 0,
      blackjack: Number(user.gamePlayCounts.blackjack) || 0,
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
      crash: Number(user.xpBySource.crash) || 0,
      mines: Number(user.xpBySource.mines) || 0,
      blackjack: Number(user.xpBySource.blackjack) || 0,
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

// Local dev only: set all users to owner (for testing with a single user)
const allowGiveAllOwner = process.env.NODE_ENV !== 'production' || process.env.LOCAL_DEV === '1';
app.post('/api/dev/give-all-owner', async (req, res) => {
  if (!allowGiveAllOwner) return res.status(404).json({ error: 'Not available' });
  try {
    const list = await getAllUsersList();
    for (const user of list) {
      ensureFields(user);
      user.role = 'owner';
      user.isOwner = true;
      user.isAdmin = true;
      if (!useDb) users.set(user.username, user);
      await saveUser(user);
    }
    res.json({ updated: list.length, message: 'All users set to owner (local dev only).' });
  } catch (e) {
    console.error('Give all owner error:', e);
    res.status(500).json({ error: 'Failed to update users' });
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
// ===== CHALLENGES =====
const challenges = new Map();
let challengeIdCounter = 1;

function formatChallengeWager(wagerType, wagerValue) {
  if (wagerType === 'money') return '$' + (wagerValue || 0).toLocaleString();
  if (wagerType === 'gamble_lock') return 'Gamble Lock ' + (wagerValue || 0) + ' min';
  return String(wagerValue || '');
}

function formatChallengeGame(game) {
  if (game === 'gambly_bird') return 'Gambly Bird';
  return game || 'Gambly Bird';
}

function safeChallengeLabel(displayName, username) {
  const d = displayName || username;
  if (d && !String(d).includes('@')) return d;
  return (username && !String(username).includes('@') ? username : null) || displayName || 'Player';
}

function addChallengeServerMessage(challenge, statusText) {
  const challenger = safeChallengeLabel(challenge.challengerDisplayName, challenge.challengerUsername) || '?';
  const target = safeChallengeLabel(challenge.targetDisplayName, challenge.targetUsername) || '?';
  const wager = formatChallengeWager(challenge.wagerType, challenge.wagerValue);
  const game = formatChallengeGame(challenge.game);
  const text = challenger + ' challenged ' + target + '\nWager: ' + wager + '\nGame: ' + game + '\n' + statusText;
  const msg = {
    isServer: true,
    challengeId: challenge.id,
    text,
    time: Date.now(),
  };
  chatMessages.push(msg);
  if (chatMessages.length > CHAT_MAX) chatMessages.shift();
  saveChatMessages();
  return msg;
}

function updateChallengeServerMessage(challengeId, statusText) {
  for (let i = chatMessages.length - 1; i >= 0; i--) {
    const m = chatMessages[i];
    if (m && m.isServer && m.challengeId === challengeId && m.text) {
      const lines = m.text.split('\n');
      if (lines.length >= 4) {
        lines[3] = statusText;
        m.text = lines.join('\n');
        saveChatMessages();
        return;
      }
    }
  }
}

app.post('/api/challenge/send', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  ensureFields(user);
  const { targetUsername, wagerType, wagerValue, game } = req.body || {};
  const targetKey = (targetUsername || '').toLowerCase().trim();
  if (!targetKey) return res.status(400).json({ error: 'Target user required' });
  if (targetKey === (user.username || '').toLowerCase()) return res.status(400).json({ error: 'Cannot challenge yourself' });
  const target = await getUserByKeyOrSlug(targetKey);
  if (!target) return res.status(404).json({ error: 'User not found' });
  ensureFields(target);

  const wType = (wagerType === 'gamble_lock') ? 'gamble_lock' : 'money';
  let wVal;
  if (wType === 'money') {
    const amt = Number(wagerValue);
    if (!Number.isFinite(amt) || amt < 1) return res.status(400).json({ error: 'Invalid money amount (min 1)' });
    wVal = Math.floor(amt);
  } else {
    const min = Math.min(10, Math.max(1, Math.floor(Number(wagerValue) || 5)));
    wVal = min;
  }

  const id = 'c' + (challengeIdCounter++);
  const challenge = {
    id,
    challengerUsername: user.username,
    challengerDisplayName: user.displayName || user.username,
    targetUsername: target.username,
    targetDisplayName: target.displayName || target.username,
    wagerType: wType,
    wagerValue: wVal,
    game: game || 'gambly_bird',
    status: 'pending',
    createdAt: Date.now(),
  };
  challenges.set(id, challenge);
  addChallengeServerMessage(challenge, 'Waiting....');
  res.json({ challenge });
});

app.get('/api/challenge/pending', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const targetKey = (user.username || '').toLowerCase();
  for (const c of challenges.values()) {
    if ((c.targetUsername || '').toLowerCase() === targetKey && c.status === 'pending') {
      return res.json({ challenge: c });
    }
  }
  res.json({ challenge: null });
});

const matches = new Map();

function stringHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(31, h) + str.charCodeAt(i);
  }
  return (h >>> 0) || 1;
}

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function simulateGamblyBird(seedStr, jumpTimestampsMs) {
  const GAME_HEIGHT = 600;
  const SCALE = GAME_HEIGHT / 1080;
  const GRAVITY = 2000 * SCALE;
  const JUMP_VELOCITY = -600 * SCALE;
  const MAX_FALL_VELOCITY = 800 * SCALE;
  const PIPE_SPEED = 300 * SCALE;
  const PIPE_DISTANCE = 350;
  const PIPE_GAP = 180;
  const PIPE_WIDTH = 70;
  const BIRD_RADIUS = 18;
  const BIRD_X = 120;
  const GAME_WIDTH = 800;
  const PIPE_SPAWN_X = GAME_WIDTH + PIPE_WIDTH;
  const DT = 1 / 60;

  const h = stringHash(String(seedStr));
  let seed = h;
  const random = () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  function generatePipeGapY() {
    const minY = PIPE_GAP / 2;
    const maxY = GAME_HEIGHT - PIPE_GAP / 2;
    return minY + random() * (maxY - minY);
  }

  let birdY = GAME_HEIGHT / 2;
  let birdVy = 0;
  let pipes = [];
  let score = 0;
  let nextPipeX = PIPE_SPAWN_X + 1;
  const jumps = (jumpTimestampsMs || []).slice().sort((a, b) => a - b);
  let jumpIdx = 0;

  function checkCollision(by, bx) {
    if (by - BIRD_RADIUS < 0 || by + BIRD_RADIUS > GAME_HEIGHT) return true;
    for (const p of pipes) {
      if (p.x + PIPE_WIDTH < bx - BIRD_RADIUS || p.x > bx + BIRD_RADIUS) continue;
      if (by - BIRD_RADIUS < p.topHeight || by + BIRD_RADIUS > p.bottomY) return true;
    }
    return false;
  }

  function addPipeServer() {
    const gapY = generatePipeGapY();
    pipes.push({
      x: PIPE_SPAWN_X,
      topHeight: gapY - PIPE_GAP / 2,
      bottomY: gapY + PIPE_GAP / 2,
      passed: false,
    });
    nextPipeX = PIPE_SPAWN_X - PIPE_DISTANCE;
  }

  addPipeServer();
  const maxSimTime = 300000;
  let simTime = 0;

  while (simTime < maxSimTime) {
    const stepStartMs = simTime;
    const stepEndMs = simTime + DT * 1000;

    while (jumpIdx < jumps.length && jumps[jumpIdx] >= stepStartMs && jumps[jumpIdx] < stepEndMs) {
      birdVy = JUMP_VELOCITY;
      jumpIdx++;
    }

    birdVy += GRAVITY * DT;
    if (birdVy > MAX_FALL_VELOCITY) birdVy = MAX_FALL_VELOCITY;
    birdY += birdVy * DT;

    const speedMult = 1 + 0.01 * (simTime / 1000);
    const pipeDx = PIPE_SPEED * speedMult * DT;
    for (const p of pipes) {
      p.x -= pipeDx;
      if (!p.passed && p.x + PIPE_WIDTH < BIRD_X - BIRD_RADIUS) {
        p.passed = true;
        score++;
      }
    }
    pipes = pipes.filter((p) => p.x + PIPE_WIDTH > 0);

    while (pipes.length === 0 || (pipes[pipes.length - 1] && pipes[pipes.length - 1].x < nextPipeX)) {
      addPipeServer();
    }

    if (checkCollision(birdY, BIRD_X)) break;
    simTime = stepEndMs;
  }

  return score;
}

app.post('/api/challenge/accept', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const { challengeId } = req.body || {};
  const c = challenges.get(challengeId);
  if (!c || c.status !== 'pending') return res.status(404).json({ error: 'Challenge not found or already resolved' });
  if ((c.targetUsername || '').toLowerCase() !== (user.username || '').toLowerCase()) {
    return res.status(403).json({ error: 'This challenge is not for you' });
  }
  c.status = 'accepted';
  const seed = 'gambly_' + challengeId + '_' + Date.now();
  const startTime = Date.now() + 3000;
  const match = {
    challengeId,
    seed,
    startTime,
    challengerUsername: c.challengerUsername,
    targetUsername: c.targetUsername,
    wagerType: c.wagerType,
    wagerValue: c.wagerValue,
    results: {},
    status: 'playing',
  };
  matches.set(challengeId, match);
  c.matchSeed = seed;
  c.matchStartTime = startTime;
  updateChallengeServerMessage(challengeId, 'Accepted. Playing Gambly Bird...');
  res.json({ challenge: c, match: { seed, startTime } });
});

app.get('/api/challenge/active-match', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const un = (user.username || '').toLowerCase();
  for (const [id, m] of matches) {
    if (m.status !== 'playing') continue;
    const c = challenges.get(id);
    if (!c) continue;
    const isChallenger = (c.challengerUsername || '').toLowerCase() === un;
    const isTarget = (c.targetUsername || '').toLowerCase() === un;
    if (isChallenger || isTarget) {
      const key = isChallenger ? 'challenger' : 'target';
      if (m.results[key] !== undefined) continue;
      return res.json({ challengeId: id, seed: m.seed, startTime: m.startTime });
    }
  }
  res.json({ challengeId: null });
});

app.get('/api/challenge/:id/result', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const m = matches.get(req.params.id);
  const c = challenges.get(req.params.id);
  if (!m || !c) return res.status(404).json({ error: 'Not found' });
  const un = (user.username || '').toLowerCase();
  if ((c.challengerUsername || '').toLowerCase() !== un && (c.targetUsername || '').toLowerCase() !== un) {
    return res.status(403).json({ error: 'Not your match' });
  }
  const bothDone = m.results.challenger != null && m.results.target != null;
  const winner = bothDone
    ? (Number(m.results.challenger?.score ?? 0) > Number(m.results.target?.score ?? 0) ? c.challengerUsername : Number(m.results.challenger?.score ?? 0) < Number(m.results.target?.score ?? 0) ? c.targetUsername : null)
    : null;
  const winnerDisplayName = winner
    ? (safeChallengeLabel(winner === c.challengerUsername ? c.challengerDisplayName : c.targetDisplayName, winner === c.challengerUsername ? c.challengerUsername : c.targetUsername) || 'Player')
    : null;
  res.json({ bothDone, winner, winnerDisplayName: winnerDisplayName || 'Player' });
});

app.get('/api/challenge/:id/match', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const c = challenges.get(req.params.id);
  const m = matches.get(req.params.id);
  if (!c || !m) return res.status(404).json({ error: 'Match not found' });
  const un = (user.username || '').toLowerCase();
  if ((c.challengerUsername || '').toLowerCase() !== un && (c.targetUsername || '').toLowerCase() !== un) {
    return res.status(403).json({ error: 'Not your match' });
  }
  res.json({ seed: m.seed, startTime: m.startTime });
});

app.post('/api/challenge/submit-result', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const { challengeId, jumpTimestamps } = req.body || {};
  const c = challenges.get(challengeId);
  const m = matches.get(challengeId);
  if (!c || !m || m.status !== 'playing') return res.status(404).json({ error: 'Match not found or finished' });
  const un = (user.username || '').toLowerCase();
  const isChallenger = (c.challengerUsername || '').toLowerCase() === un;
  const isTarget = (c.targetUsername || '').toLowerCase() === un;
  if (!isChallenger && !isTarget) return res.status(403).json({ error: 'Not your match' });

  const timestamps = Array.isArray(jumpTimestamps) ? jumpTimestamps.map(Number).filter(Number.isFinite) : [];
  const score = simulateGamblyBird(m.seed, timestamps);

  const key = isChallenger ? 'challenger' : 'target';
  if (m.results[key] !== undefined) return res.status(400).json({ error: 'Already submitted' });
  m.results[key] = { score, jumpTimestamps: timestamps };

  const bothDone = m.results.challenger !== undefined && m.results.target !== undefined;
  if (bothDone) {
    m.status = 'finished';
    const scA = Number(m.results.challenger?.score ?? 0);
    const scB = Number(m.results.target?.score ?? 0);
    let winner = null;
    let loser = null;
    if (scA > scB) {
      winner = c.challengerUsername;
      loser = c.targetUsername;
    } else if (scB > scA) {
      winner = c.targetUsername;
      loser = c.challengerUsername;
    }

    if (winner && loser) {
      const loserUser = await getUserByKeyOrSlug(loser);
      const winnerUser = await getUserByKeyOrSlug(winner);
      if (loserUser && winnerUser) {
        ensureFields(loserUser);
        ensureFields(winnerUser);
        if (c.wagerType === 'money') {
          const amt = c.wagerValue || 0;
          loserUser.balance = Math.max(0, (loserUser.balance ?? 0) - amt);
          winnerUser.balance = (winnerUser.balance ?? 0) + amt;
        } else if (c.wagerType === 'gamble_lock') {
          const min = Math.min(10, Math.max(1, c.wagerValue || 5));
          loserUser.gambleLockedUntil = Date.now() + min * 60 * 1000;
        }
        if (!useDb) {
          users.set(loserUser.username, loserUser);
          users.set(winnerUser.username, winnerUser);
        }
        await saveUser(loserUser);
        await saveUser(winnerUser);
      }
    }
    const winnerDisplayName = winner
      ? (safeChallengeLabel(winner === c.challengerUsername ? c.challengerDisplayName : c.targetDisplayName, winner === c.challengerUsername ? c.challengerUsername : c.targetUsername) || 'Player')
      : null;
    const winnerLabel = winnerDisplayName || 'Player';
    updateChallengeServerMessage(challengeId, 'Finished. ' + (winner ? (winnerLabel + ' wins!') : "It's a tie!"));
  }

  const winner = bothDone
    ? (Number(m.results.challenger?.score ?? 0) > Number(m.results.target?.score ?? 0) ? c.challengerUsername : Number(m.results.challenger?.score ?? 0) < Number(m.results.target?.score ?? 0) ? c.targetUsername : null)
    : null;
  const winnerDisplayName = winner
    ? (safeChallengeLabel(winner === c.challengerUsername ? c.challengerDisplayName : c.targetDisplayName, winner === c.challengerUsername ? c.challengerUsername : c.targetUsername) || 'Player')
    : null;
  res.json({ score, bothDone, winner, winnerDisplayName: winnerDisplayName || 'Player' });
});

app.post('/api/challenge/decline', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const { challengeId } = req.body || {};
  const c = challenges.get(challengeId);
  if (!c || c.status !== 'pending') return res.status(404).json({ error: 'Challenge not found or already resolved' });
  if ((c.targetUsername || '').toLowerCase() !== (user.username || '').toLowerCase()) {
    return res.status(403).json({ error: 'This challenge is not for you' });
  }
  c.status = 'declined';
  updateChallengeServerMessage(challengeId, 'Declined.');
  res.json({ challenge: c });
});

// ===== CHAT =====
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
    const untilFormatted = new Date(user.chatMutedUntil).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' });
    const secs = Math.ceil((user.chatMutedUntil - now) / 1000);
    return res.status(403).json({
      error: 'You have been muted until ' + untilFormatted + ' - ' + secs + ' second(s)',
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
  saveChatMessages();
  res.json({ message: msg });
});

// Only sync non-delta fields: xp, level, biggestWin. Server enforces caps so client cannot cheat.
app.post('/api/user/update-stats', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  ensureFields(user);
  if (!checkRateLimit(rateLimitUpdateStats, user.username, RATE_LIMIT_UPDATE_STATS_PER_MIN)) {
    return res.status(429).json({ error: 'Too many sync requests' });
  }
  const { level, xp, biggestWinAmount, biggestWinMultiplier } = req.body;
  if (xp !== undefined) {
    const numXp = Number(xp);
    if (!Number.isFinite(numXp) || numXp < 0) {
      return res.status(400).json({ error: 'Invalid xp' });
    }
    const currentXp = Number(user.xp) || 0;
    const maxAllowedXp = currentXp + MAX_XP_INCREASE_PER_SYNC;
    const clampedXp = Math.min(numXp, maxAllowedXp);
    const oldLevel = getLevelFromXp(currentXp);
    user.xp = clampedXp;
    user.level = getLevelFromXp(clampedXp);
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
  } else if (level !== undefined) {
    const numLevel = Math.max(1, Math.floor(Number(level)) || 1);
    const maxLevelFromXp = getLevelFromXp((Number(user.xp) || 0) + MAX_XP_INCREASE_PER_SYNC);
    user.level = Math.min(numLevel, maxLevelFromXp);
  }
  if (biggestWinAmount !== undefined && biggestWinAmount > (user.biggestWinAmount || 0)) {
    const capped = Math.min(Number(biggestWinAmount) || 0, MAX_BIGGEST_WIN_AMOUNT);
    if (capped > user.biggestWinAmount) {
      user.biggestWinAmount = capped;
      user.biggestWinMultiplier = (biggestWinMultiplier != null && Number.isFinite(biggestWinMultiplier)) ? biggestWinMultiplier : 1;
    }
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
  if (!checkGambleLock(user, res)) return;
  const amount = Number(req.body.amount);
  const source = normalizeGameSource(req.body?.source);
  if (!Number.isFinite(amount) || amount < 0.01 || amount > user.balance) {
    return res.status(400).json({ error: 'Invalid bet amount or insufficient balance' });
  }
  if (source === 'plinko') {
    const risk = user.plinkoRiskLevel || 'low';
    const maxBet = PLINKO_MAX_BET_BY_RISK[risk] ?? PLINKO_MAX_BET_BY_RISK.low;
    if (amount > maxBet) {
      return res.status(400).json({ error: `Max bet for ${risk} risk is $${maxBet.toLocaleString()}` });
    }
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
  if (!checkRateLimit(rateLimitWin, user.username, RATE_LIMIT_WIN_PER_MIN)) {
    return res.status(429).json({ error: 'Too many win requests' });
  }
  const rawAmount = req.body.amount;
  const amount = typeof rawAmount === 'number' ? rawAmount : Number(rawAmount);
  if (amount !== amount || amount < 0 || amount === Infinity || amount > MAX_WIN_AMOUNT_PER_REQUEST) {
    return res.status(400).json({ error: 'Invalid win amount or exceeds maximum allowed (' + MAX_WIN_AMOUNT_PER_REQUEST + ')' });
  }
  const amountToAdd = Math.min(Math.floor(amount), MAX_WIN_AMOUNT_PER_REQUEST);
  if (!Number.isFinite(amountToAdd) || amountToAdd < 0) {
    return res.status(400).json({ error: 'Invalid win amount' });
  }
  const multiplier = req.body.multiplier != null ? Number(req.body.multiplier) : null;
  const betAmount = req.body.betAmount != null ? Number(req.body.betAmount) : null;
  const source = normalizeGameSource(req.body?.source);
  user.balance += amountToAdd;
  user.totalGamblingWins += amountToAdd;
  if (source && source !== 'click') {
    user.gameNet[source] += amountToAdd;
  }
  const isProfit = betAmount != null ? amountToAdd > betAmount : true;
  if (amountToAdd > 0 && isProfit) {
    const profit = Math.max(0, amountToAdd - (Number.isFinite(betAmount) ? betAmount : 0));
    user.totalProfitWins += profit;
    user.totalWinsCount += 1;
    if (source) user.xpBySource[source] += 3;
    if (amountToAdd > user.biggestWinAmount) {
      user.biggestWinAmount = Math.min(amountToAdd, MAX_BIGGEST_WIN_AMOUNT);
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

// Refund: adds to balance only (no win tracking). Always capped server-side – client cannot grant more.
app.post('/api/user/refund', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  if (!checkRateLimit(rateLimitRefund, user.username, RATE_LIMIT_REFUND_PER_MIN)) {
    return res.status(429).json({ error: 'Too many refund requests' });
  }
  const raw = req.body.amount;
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (num !== num || num < 0 || num === Infinity) {
    return res.status(400).json({ error: 'Invalid refund amount' });
  }
  const amountToAdd = Math.min(Math.max(0, Math.floor(num)), MAX_REFUND_AMOUNT_PER_REQUEST);
  user.balance = (Number(user.balance) || 0) + amountToAdd;
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
    if (key === 'crash') return 'Crash';
    if (key === 'mines') return 'Mines';
    if (key === 'blackjack') return 'Blackjack';
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
    if (key === 'crash') return 'Crash';
    if (key === 'mines') return 'Mines';
    if (key === 'blackjack') return 'Blackjack';
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

function plinkoPickSlot(risk) {
  const odds = PLINKO_ODDS[risk] || PLINKO_ODDS.low;
  const r = Math.random() * 100;
  let sum = 0;
  for (let i = 0; i < odds.length; i++) {
    sum += odds[i];
    if (r < sum) return i;
  }
  return odds.length - 1;
}

app.post('/api/plinko/resolve', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  ensureFields(user);
  const amount = typeof req.body.amount === 'number' ? req.body.amount : Number(req.body.amount);
  if (!Number.isFinite(amount) || amount < 0.01 || amount > user.balance) {
    return res.status(400).json({ error: 'Invalid bet amount or insufficient balance' });
  }
  const risk = user.plinkoRiskLevel || 'low';
  const maxBet = PLINKO_MAX_BET_BY_RISK[risk] ?? PLINKO_MAX_BET_BY_RISK.low;
  if (amount > maxBet) return res.status(400).json({ error: 'Bet exceeds max for risk level' });

  const slotIndex = plinkoPickSlot(risk);
  const mults = PLINKO_MULTIPLIERS[risk] || PLINKO_MULTIPLIERS.low;
  const multiplier = mults[slotIndex] ?? 1;
  const winAmount = Math.floor(amount * multiplier);

  user.balance -= amount;
  user.totalBets += 1;
  if (user.gameNet) user.gameNet.plinko = (user.gameNet.plinko || 0) - amount;
  if (user.gamePlayCounts) user.gamePlayCounts.plinko = (user.gamePlayCounts.plinko || 0) + 1;
  if (user.xpBySource) user.xpBySource.plinko = (user.xpBySource.plinko || 0) + 3;

  user.balance += winAmount;
  user.totalGamblingWins += winAmount;
  if (user.gameNet) user.gameNet.plinko = (user.gameNet.plinko || 0) + winAmount;

  const isProfit = winAmount > amount;
  if (winAmount > 0 && isProfit) {
    const profit = Math.max(0, winAmount - amount);
    user.totalProfitWins = (user.totalProfitWins || 0) + profit;
    user.totalWinsCount = (user.totalWinsCount || 0) + 1;
    if (user.xpBySource) user.xpBySource.plinko = (user.xpBySource.plinko || 0) + 3;
    if (winAmount > (user.biggestWinAmount || 0)) {
      user.biggestWinAmount = Math.min(winAmount, MAX_BIGGEST_WIN_AMOUNT);
      user.biggestWinMultiplier = multiplier;
      user.biggestWinMeta = { game: 'plinko', betAmount: amount, multiplier, timestamp: Date.now() };
    }
  }

  const idx = slotIndex >= 0 && slotIndex <= 17 ? slotIndex : 18;
  plinkoStats.totalBalls += 1;
  plinkoStats.landings[idx] = (plinkoStats.landings[idx] || 0) + 1;
  await savePlinkoStats();
  if (!useDb) users.set(user.username, user);
  await saveUser(user);

  res.json({ slotIndex, multiplier, winAmount, path: null, balance: user.balance });
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
// Owner only: reset all user stats (balance, xp, level, clicks, wins, etc.) — keeps users and accounts
app.post('/api/admin/reset-all-stats', requireOwner, async (req, res) => {
  const now = Date.now();
  const resetBalance = 10000;
  const emptyNet = emptyGameNet();
  const emptyCounts = emptyGamePlayCounts();
  const emptyXp = emptyXpBySource();
  const emptyMeta = { game: null, betAmount: 0, multiplier: 1, timestamp: 0 };

  if (useDb) {
    try {
      const client = await db.getPool().connect();
      await client.query(
        `UPDATE users SET
          balance = $1, xp = 0, level = 1,
          total_clicks = 0, total_bets = 0, total_gambling_wins = 0, total_wins_count = 0,
          biggest_win_amount = 0, biggest_win_multiplier = 1, biggest_win_meta = $2,
          total_click_earnings = 0, total_profit_wins = 0,
          analytics_started_at = $3,
          game_net = $4, game_play_counts = $5, xp_by_source = $6`,
        [resetBalance, JSON.stringify(emptyMeta), now, JSON.stringify(emptyNet), JSON.stringify(emptyCounts), JSON.stringify(emptyXp)]
      );
      client.release();
    } catch (e) {
      console.error('Reset all stats DB error:', e);
      return res.status(500).json({ error: 'Reset failed' });
    }
  } else {
    for (const user of users.values()) {
      user.balance = resetBalance;
      user.xp = 0;
      user.level = 1;
      user.totalClicks = 0;
      user.totalBets = 0;
      user.totalGamblingWins = 0;
      user.totalWinsCount = 0;
      user.biggestWinAmount = 0;
      user.biggestWinMultiplier = 1;
      user.biggestWinMeta = { ...emptyMeta };
      user.totalClickEarnings = 0;
      user.totalProfitWins = 0;
      user.analyticsStartedAt = now;
      user.gameNet = { ...emptyNet };
      user.gamePlayCounts = { ...emptyCounts };
      user.xpBySource = { ...emptyXp };
      users.set(user.username, user);
    }
    saveUsersSync();
  }
  await addAdminLog({ type: 'reset_all_stats', actorUsername: req.adminUser.username, actorDisplayName: req.adminUser.displayName });
  console.log('Owner reset all user stats');
  res.json({ success: true });
});

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
const ROULETTE_STRICT_CASINO_MODE = false;

const rouletteState = {
  roundId: 1,
  phase: 'betting',
  phaseEndTime: Date.now() + ROULETTE_BETTING_MS,
  winNumber: null,
  bets: new Map(),       // username -> [{key, amount}]
  recentWinners: [],     // last 20
};

/** Return a display name that is never an email (for use in public lists). */
function getSafeDisplayName(user) {
  if (!user) return 'Player';
  const dn = (user.displayName || '').trim();
  const un = (user.username || '').trim();
  if (dn && !dn.includes('@')) return dn;
  if (un && !un.includes('@')) return un;
  return 'Player';
}

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

// Roulette: no max win cap; payout is unlimited.
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
        username: getSafeDisplayName(user),
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

function checkGambleLock(user, res) {
  const now = Date.now();
  if (user.gambleLockedUntil != null && user.gambleLockedUntil > now) {
    res.status(403).json({
      error: 'You lost a challenge, you are gamble locked',
      code: 'GAMBLE_LOCKED',
      gambleLockedUntil: user.gambleLockedUntil,
    });
    return false;
  }
  return true;
}

app.post('/api/roulette/bet', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  ensureFields(user);
  if (!checkGambleLock(user, res)) return;
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

app.post('/api/roulette/remove-bet', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  ensureFields(user);
  rouletteTick();
  if (rouletteState.phase !== 'betting') {
    return res.status(400).json({ error: 'Cannot remove bet outside betting phase' });
  }
  const { key } = req.body;
  if (!isValidRouletteBetKey(key)) {
    return res.status(400).json({ error: 'Invalid bet key' });
  }
  const userBets = rouletteState.bets.get(user.username) || [];
  let idx = -1;
  for (let i = userBets.length - 1; i >= 0; i--) {
    if (userBets[i].key === key) { idx = i; break; }
  }
  if (idx < 0) {
    return res.status(400).json({ error: 'No bet on that field' });
  }
  const removed = userBets[idx].amount;
  userBets.splice(idx, 1);
  if (userBets.length === 0) rouletteState.bets.delete(user.username);
  user.balance += removed;
  user.gameNet.roulette += removed;
  if (!useDb) users.set(user.username, user);
  await saveUser(user);
  res.json({ balance: user.balance, removed });
});

app.get('/api/roulette/winners', (req, res) => {
  res.json(rouletteState.recentWinners);
});

app.get('/api/roulette/all-bets', async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  const agg = new Map();
  for (const [username, userBets] of rouletteState.bets) {
    const user = await getUserId(username);
    const displayName = getSafeDisplayName(user || { username });
    const perKey = new Map();
    for (const b of userBets) {
      const k = String(b.key);
      const amt = Number(b.amount);
      if (!k || !Number.isFinite(amt)) continue;
      perKey.set(k, (perKey.get(k) || 0) + amt);
    }
    for (const [k, totalAmt] of perKey) {
      let cur = agg.get(k);
      if (!cur) {
        cur = { key: k, total: 0, players: [] };
        agg.set(k, cur);
      }
      cur.total += totalAmt;
      cur.players.push({ username: displayName, amount: totalAmt });
    }
  }
  const bets = Array.from(agg.values()).map((v) => {
    v.players.sort((a, b) => b.amount - a.amount);
    return {
      key: v.key,
      total: v.total,
      count: v.players.length,
      players: v.players.map((p) => ({ username: p.username, amount: p.amount })),
    };
  }).sort((a, b) => b.total - a.total);
  res.json({ bets });
});

// ===== CRASH (2% house edge, RTP 98%. M = 0.98/(1-U), U~U(0,1); if M<1 then M=1. Exponential: M(t)=e^(k*t), 2× in 10s => k=ln(2)/10) =====
const CRASH_K = Math.LN2 / 10; // ~0.0693: multiplier reaches 2× in 10 seconds
const CRASH_HOUSE_EDGE = 0.02; // 2% house edge, RTP 98%
const CRASH_COUNTDOWN_MS = 10000;
const CRASH_POST_RESULT_MS = 8000; // 5s extra so round results stay visible 8s total after crash

let crashState = {
  phase: 'counting_down', // counting_down | flying | crashed
  roundId: 0,
  countdownEndAt: null,
  roundStartAt: null,
  crashPoint: null,
  crashTime: null, // seconds from roundStartAt until crash (variable: ln(M)/CRASH_K)
  bets: new Map(), // username -> { amount }
  cashOuts: new Map(), // username -> { amount, multiplier, winAmount }
  crashTimer: null,
  lastRoundCashOuts: [],
  lastRoundLosers: [],
};

function crashMultiplierAt(tSeconds) {
  if (crashState.crashTime == null) return crashState.crashPoint ?? 1;
  if (crashState.crashTime <= 0 || tSeconds >= crashState.crashTime) return crashState.crashPoint ?? 1;
  return Math.exp(CRASH_K * tSeconds);
}

function runCrashNextRound() {
  crashState.phase = 'counting_down';
  crashState.roundId += 1;
  crashState.countdownEndAt = Date.now() + CRASH_COUNTDOWN_MS;
  crashState.roundStartAt = null;
  crashState.crashPoint = null;
  crashState.crashTime = null;
  crashState.bets = new Map();
  crashState.cashOuts = new Map();
  crashState.lastRoundCashOuts = [];
  crashState.lastRoundLosers = [];
  if (crashState.crashTimer) clearTimeout(crashState.crashTimer);
  crashState.crashTimer = setTimeout(() => {
    crashState.crashTimer = null;
    startCrashFlying();
  }, CRASH_COUNTDOWN_MS);
}

function startCrashFlying() {
  // 2% house edge: U ~ U(0,1), M = 0.98/(1-U). If M < 1 then override to M = 1 (instant crash).
  const U = Math.random(); // 0 <= U < 1
  let M = (1 - CRASH_HOUSE_EDGE) / (1 - U);
  if (M < 1) M = 1; // house wins immediately 5% of the time
  const safeCrashPoint = Math.min(10000, Math.floor(M * 100) / 100);
  const crashTime = safeCrashPoint <= 1 ? 0 : Math.log(safeCrashPoint) / CRASH_K; // t_crash = ln(M)/k
  crashState.phase = 'flying';
  crashState.roundStartAt = Date.now();
  crashState.crashPoint = safeCrashPoint;
  crashState.crashTime = crashTime;
  if (crashState.crashTimer) clearTimeout(crashState.crashTimer);
  crashState.crashTimer = setTimeout(settleCrash, Math.max(50, crashTime * 1000));
}

async function settleCrash() {
  crashState.crashTimer = null;
  // Build lists for clients (display name only, never email)
  crashState.lastRoundCashOuts = (await Promise.all(
    Array.from(crashState.cashOuts.entries()).map(async ([username, o]) => {
      const u = await getUserId(username);
      return { username: getSafeDisplayName(u || {}), multiplier: o.multiplier, winAmount: o.winAmount };
    })
  )).sort((a, b) => (b.winAmount || 0) - (a.winAmount || 0));
  crashState.lastRoundLosers = (await Promise.all(
    Array.from(crashState.bets.entries())
      .filter(([username]) => !crashState.cashOuts.has(username))
      .map(async ([username, o]) => {
        const u = await getUserId(username);
        return { username: getSafeDisplayName(u || {}), multiplier: crashState.crashPoint, betAmount: o.amount };
      })
  )).sort((a, b) => (b.betAmount || 0) - (a.betAmount || 0));
  crashState.phase = 'crashed';
  for (const [username] of crashState.bets) {
    if (crashState.cashOuts.has(username)) continue;
    const user = await getUserId(username);
    if (!user) continue;
    ensureFields(user);
    if (!useDb) users.set(user.username, user);
    await saveUser(user);
  }
  crashState.bets = new Map();
  crashState.cashOuts = new Map();
  setTimeout(runCrashNextRound, CRASH_POST_RESULT_MS);
}

app.get('/api/crash/round', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  const now = Date.now();
  let currentMultiplier = null;
  if (crashState.phase === 'flying' && crashState.roundStartAt != null) {
    const t = (now - crashState.roundStartAt) / 1000;
    currentMultiplier = t >= crashState.crashTime ? crashState.crashPoint : crashMultiplierAt(t);
  }
  let cashOutsList = [];
  let losersList = [];
  if (crashState.phase === 'flying') {
    cashOutsList = (await Promise.all(
      Array.from(crashState.cashOuts.entries()).map(async ([username, o]) => {
        const u = await getUserId(username);
        return { username: getSafeDisplayName(u || {}), multiplier: o.multiplier, winAmount: o.winAmount };
      })
    )).sort((a, b) => (b.winAmount || 0) - (a.winAmount || 0));
  } else if (crashState.phase === 'crashed') {
    cashOutsList = crashState.lastRoundCashOuts || [];
    losersList = crashState.lastRoundLosers || [];
  }
  const payload = {
    roundId: crashState.roundId,
    phase: crashState.phase,
    countdownEndAt: crashState.countdownEndAt,
    roundStartAt: crashState.roundStartAt,
    serverTime: now,
    crashPoint: crashState.phase === 'crashed' ? crashState.crashPoint : undefined,
    crashTime: crashState.phase === 'crashed' ? crashState.crashTime : undefined, // so client can draw full curve
    crashK: (crashState.phase === 'flying' || crashState.phase === 'crashed') ? CRASH_K : undefined,
    currentMultiplier: currentMultiplier != null ? Math.floor(currentMultiplier * 100) / 100 : null,
    cashOutsList,
    losersList,
  };
  if (user) {
    ensureFields(user);
    payload.balance = user.balance;
    const myBet = crashState.bets.get(user.username);
    payload.myBet = myBet ? myBet.amount : null;
    payload.myCashOut = crashState.cashOuts.get(user.username) || null;
  }
  res.json(payload);
});

app.post('/api/crash/bet', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  ensureFields(user);
  if (!checkGambleLock(user, res)) return;
  if (crashState.phase !== 'counting_down') {
    return res.status(400).json({ error: 'Betting only during countdown' });
  }
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount < 0.01) {
    return res.status(400).json({ error: 'Invalid bet amount' });
  }
  if (amount > user.balance) {
    return res.status(400).json({ error: 'Insufficient balance' });
  }
  if (crashState.bets.has(user.username)) {
    return res.status(400).json({ error: 'Already bet this round' });
  }
  user.balance -= amount;
  user.totalBets += 1;
  user.gameNet.crash -= amount;
  user.gamePlayCounts.crash += 1;
  user.xpBySource.crash = (user.xpBySource.crash || 0) + 3;
  if (!useDb) users.set(user.username, user);
  await saveUser(user);
  crashState.bets.set(user.username, { amount });
  res.json({ balance: user.balance, bet: amount });
});

// --- Mines: 5x5 grid, N mines, RTP 97% ---
const MINES_RTP = 0.97;
const MINES_GRID_SIZE = 25;
const minesRounds = new Map();

function binom(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let r = 1;
  for (let i = 0; i < k; i++) {
    r = r * (n - i) / (i + 1);
  }
  return r;
}

function minesProbReached(s, N) {
  if (s < 0 || s > MINES_GRID_SIZE - N) return 0;
  return binom(MINES_GRID_SIZE - s, N) / binom(MINES_GRID_SIZE, N);
}

function minesGetMultiplier(s, N) {
  const p = minesProbReached(s, N);
  if (p <= 0) return 0;
  return MINES_RTP / p;
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

app.post('/api/mines/bet', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  ensureFields(user);
  if (!checkGambleLock(user, res)) return;
  const amount = Number(req.body.amount);
  const mines = Number(req.body.mines);
  if (!Number.isFinite(amount) || amount < 0.01) {
    return res.status(400).json({ error: 'Invalid bet amount' });
  }
  if (!Number.isFinite(mines) || mines < 1 || mines > 24) {
    return res.status(400).json({ error: 'Invalid mines count (1–24)' });
  }
  if (amount > user.balance) {
    return res.status(400).json({ error: 'Insufficient balance' });
  }
  const roundId = crypto.randomBytes(16).toString('hex');
  const indices = Array.from({ length: MINES_GRID_SIZE }, (_, i) => i);
  const minePositions = shuffleArray(indices).slice(0, mines);
  const mineSet = new Set(minePositions);
  user.balance -= amount;
  user.totalBets += 1;
  user.gameNet.mines -= amount;
  user.gamePlayCounts.mines += 1;
  user.xpBySource.mines = (user.xpBySource.mines || 0) + 3;
  if (!useDb) users.set(user.username, user);
  await saveUser(user);
  minesRounds.set(roundId, {
    username: user.username,
    bet: amount,
    mines,
    mineSet,
    revealed: [],
    safeClicks: 0,
  });
  res.json({ roundId, balance: user.balance });
});

app.post('/api/mines/reveal', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  ensureFields(user);
  const { roundId, tileIndex } = req.body;
  if (!roundId || tileIndex == null) {
    return res.status(400).json({ error: 'Missing roundId or tileIndex' });
  }
  const idx = Number(tileIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= MINES_GRID_SIZE) {
    return res.status(400).json({ error: 'Invalid tile index' });
  }
  const round = minesRounds.get(roundId);
  if (!round || round.username !== user.username) {
    return res.status(400).json({ error: 'Invalid or expired round' });
  }
  if (round.revealed.includes(idx)) {
    return res.status(400).json({ error: 'Tile already revealed' });
  }
  round.revealed.push(idx);
  const isMine = round.mineSet.has(idx);
  if (isMine) {
    minesRounds.delete(roundId);
    res.json({
      isMine: true,
      safeClicks: round.safeClicks,
      multiplier: 0,
      winAmount: 0,
      balance: user.balance,
    });
    return;
  }
  round.safeClicks += 1;
  const multiplier = minesGetMultiplier(round.safeClicks, round.mines);
  res.json({
    isMine: false,
    safeClicks: round.safeClicks,
    multiplier,
    winAmount: Math.floor(round.bet * multiplier * 100) / 100,
    balance: user.balance,
  });
});

app.post('/api/mines/cash-out', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  ensureFields(user);
  const { roundId } = req.body;
  if (!roundId) return res.status(400).json({ error: 'Missing roundId' });
  const round = minesRounds.get(roundId);
  if (!round || round.username !== user.username) {
    return res.status(400).json({ error: 'Invalid or expired round' });
  }
  if (round.safeClicks === 0) {
    return res.status(400).json({ error: 'Nothing to cash out' });
  }
  const multiplier = minesGetMultiplier(round.safeClicks, round.mines);
  const winAmount = Math.floor(round.bet * multiplier * 100) / 100;
  user.balance += winAmount;
  user.totalGamblingWins += winAmount;
  user.totalWinsCount += 1;
  if (winAmount > round.bet) user.totalProfitWins += 1;
  user.gameNet.mines += winAmount;
  if (winAmount > (user.biggestWinAmount || 0)) {
    user.biggestWinAmount = winAmount;
    user.biggestWinMultiplier = multiplier;
    user.biggestWinMeta = { game: 'mines', betAmount: round.bet, multiplier, timestamp: Date.now() };
  }
  user.xpBySource.mines = (user.xpBySource.mines || 0) + 5;
  if (!useDb) users.set(user.username, user);
  await saveUser(user);
  minesRounds.delete(roundId);
  res.json({ balance: user.balance, multiplier, winAmount });
});

app.post('/api/crash/cash-out', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  ensureFields(user);
  if (crashState.phase !== 'flying') {
    return res.status(400).json({ error: 'Can only cash out while round is flying' });
  }
  const myBet = crashState.bets.get(user.username);
  if (!myBet) return res.status(400).json({ error: 'No bet this round' });
  if (crashState.cashOuts.has(user.username)) {
    return res.status(400).json({ error: 'Already cashed out' });
  }
  const t = (Date.now() - crashState.roundStartAt) / 1000;
  if (t >= crashState.crashTime) {
    return res.status(400).json({ error: 'Round already crashed' });
  }
  const multiplier = Math.floor(crashMultiplierAt(t) * 100) / 100;
  const winAmount = Math.floor(myBet.amount * multiplier * 100) / 100;
  user.balance += winAmount;
  user.totalGamblingWins += winAmount;
  user.totalWinsCount += 1;
  if (winAmount > myBet.amount) user.totalProfitWins += 1;
  user.gameNet.crash += winAmount;
  if (winAmount > (user.biggestWinAmount || 0)) {
    user.biggestWinAmount = winAmount;
    user.biggestWinMultiplier = multiplier;
    user.biggestWinMeta = { game: 'crash', betAmount: myBet.amount, multiplier, timestamp: Date.now() };
  }
  user.xpBySource.crash = (user.xpBySource.crash || 0) + 5;
  if (!useDb) users.set(user.username, user);
  await saveUser(user);
  crashState.cashOuts.set(user.username, { amount: myBet.amount, multiplier, winAmount });
  res.json({ balance: user.balance, multiplier, winAmount });
});

// ===== BLACKJACK (6-deck shoe, provably fair, full rules) =====
const blackjackGames = new Map(); // username -> game state
const BLACKJACK_MIN_BET = 0.5;
const BLACKJACK_MAX_BET = 999999999; // No practical limit
const BLACKJACK_SHOE_RESHUFFLE_AT = 60; // reshuffle when ~60 cards left
const DEALER_HIT_SOFT_17 = true;

function getBlackjackGame(username) {
  return blackjackGames.get((username || '').toLowerCase());
}

function setBlackjackGame(username, game) {
  blackjackGames.set((username || '').toLowerCase(), game);
}

function drawFromShoe(game) {
  if (!game.shoe || game.shoe.length < 1) {
    const serverSeed = crypto.randomBytes(32).toString('hex');
    const clientSeed = (game.clientSeed || crypto.randomBytes(16).toString('hex')) + '_' + Date.now();
    game.shoe = blackjackCore.shuffleShoe(serverSeed, clientSeed);
    game.serverSeed = serverSeed;
    game.clientSeed = clientSeed;
  }
  return game.shoe.length > 0 ? game.shoe.pop() : null;
}

function blackjackEvaluateHand(cards) {
  return blackjackCore.evaluateHand(cards.map((c) => c.rank));
}

function runDealerTurn(game) {
  const { evaluateHand } = blackjackCore;
  let dealerHand = game.dealerHand;
  while (true) {
    const ev = evaluateHand(dealerHand.map((c) => c.rank));
    if (ev.bust) break;
    const hitSoft17 = DEALER_HIT_SOFT_17 && ev.soft && ev.total === 17;
    if (ev.total >= 17 && !hitSoft17) break;
    const card = drawFromShoe(game);
    if (!card) break;
    dealerHand.push(card);
  }
  game.dealerHand = dealerHand;
}

function resolveBlackjackHands(game, user) {
  const { evaluateHand } = blackjackCore;
  const dealerEv = evaluateHand(game.dealerHand.map((c) => c.rank));
  const results = [];

  for (let h = 0; h < game.hands.length; h++) {
    const hand = game.hands[h];
    const bet = hand.bet;
    const insurance = hand.insurance || 0;
    const ev = evaluateHand(hand.cards.map((c) => c.rank));
    let netChange = 0;

    if (hand.surrendered) {
      netChange = bet * 0.5;
    } else if (hand.insurance) {
      if (game.dealerBlackjack) {
        netChange += insurance * 2;
      } else {
        netChange -= insurance;
      }
    }

    if (hand.surrendered) {
      results.push({ handIndex: h, outcome: 'surrender', netChange });
      continue;
    }

    if (ev.bust) {
      netChange -= bet;
      results.push({ handIndex: h, outcome: 'bust', netChange });
      continue;
    }

    if (game.dealerBlackjack) {
      if (ev.blackjack) {
        netChange += bet;
        results.push({ handIndex: h, outcome: 'push', netChange });
      } else {
        netChange -= bet;
        results.push({ handIndex: h, outcome: 'lose', netChange });
      }
      continue;
    }

    if (ev.blackjack) {
      netChange += bet * 2.5;
      results.push({ handIndex: h, outcome: 'blackjack', netChange });
      continue;
    }

    if (dealerEv.bust) {
      netChange += bet;
      results.push({ handIndex: h, outcome: 'win', netChange });
      continue;
    }

    if (ev.total > dealerEv.total) {
      netChange += bet;
      results.push({ handIndex: h, outcome: 'win', netChange });
    } else if (ev.total < dealerEv.total) {
      netChange -= bet;
      results.push({ handIndex: h, outcome: 'lose', netChange });
    } else {
      results.push({ handIndex: h, outcome: 'push', netChange });
    }
  }

  let totalNet = 0;
  for (const r of results) totalNet += r.netChange;
  user.balance += totalNet;
  user.gameNet.blackjack = (user.gameNet.blackjack || 0) + totalNet;
  user.gamePlayCounts.blackjack = (user.gamePlayCounts.blackjack || 0) + 1;
  if (totalNet > 0) {
    user.totalGamblingWins = (user.totalGamblingWins || 0) + totalNet;
    user.xpBySource.blackjack = (user.xpBySource.blackjack || 0) + 3;
    const totalBet = game.hands.reduce((s, h) => s + h.bet, 0);
    if (totalNet > 0 && totalNet > totalBet) {
      user.totalProfitWins = (user.totalProfitWins || 0) + (totalNet - totalBet);
      user.totalWinsCount = (user.totalWinsCount || 0) + 1;
      if (totalNet > (user.biggestWinAmount || 0)) {
        user.biggestWinAmount = Math.min(totalNet, MAX_BIGGEST_WIN_AMOUNT);
        user.biggestWinMultiplier = 1;
        user.biggestWinMeta = { game: 'blackjack', betAmount: totalBet, multiplier: 1, timestamp: Date.now() };
      }
    }
  }
  game.results = results;
  game.totalNet = totalNet;
  return results;
}

function sanitizeGameState(game, forUser) {
  if (!game) return null;
  const g = { ...game };
  g.hands = (g.hands || []).map((h) => ({
    cards: h.cards,
    bet: h.bet,
    insurance: h.insurance,
    surrendered: h.surrendered,
    doubled: h.doubled,
    splitFromAces: h.splitFromAces,
  }));
  g.dealerHand = g.dealerHand || [];
  delete g.shoe;
  delete g.serverSeed;
  delete g.clientSeed;
  return g;
}

app.get('/api/blackjack/state', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const game = getBlackjackGame(user.username);
  res.json({
    balance: user.balance,
    game: sanitizeGameState(game, user.username),
  });
});

app.post('/api/blackjack/bet', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  ensureFields(user);
  if (!checkGambleLock(user, res)) return;
  const existing = getBlackjackGame(user.username);
  if (existing && existing.phase !== 'idle' && existing.phase !== 'resolved') {
    return res.status(400).json({ error: 'Game in progress' });
  }
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount < BLACKJACK_MIN_BET || amount > BLACKJACK_MAX_BET) {
    return res.status(400).json({ error: `Bet must be at least $${BLACKJACK_MIN_BET}` });
  }
  if (amount > (user.balance ?? 0)) {
    return res.status(400).json({ error: 'Insufficient balance' });
  }

  user.balance -= amount;
  user.totalBets += 1;
  user.gameNet.blackjack = (user.gameNet.blackjack || 0) - amount;
  user.gamePlayCounts.blackjack = (user.gamePlayCounts.blackjack || 0) + 1;
  user.xpBySource.blackjack = (user.xpBySource.blackjack || 0) + 3;

  let game = existing;
  if (!game || game.phase === 'resolved' || game.phase === 'idle') {
    const serverSeed = crypto.randomBytes(32).toString('hex');
    const clientSeed = crypto.randomBytes(16).toString('hex') + '_' + Date.now();
    game = {
      phase: 'dealing',
      shoe: blackjackCore.shuffleShoe(serverSeed, clientSeed),
      serverSeed,
      clientSeed,
      hands: [],
      dealerHand: [],
      currentHandIndex: 0,
      hasActed: false,
    };
  }

  const card1 = drawFromShoe(game);
  const card2 = drawFromShoe(game);
  const dealerCard1 = drawFromShoe(game);
  const dealerCard2 = drawFromShoe(game);
  if (!card1 || !card2 || !dealerCard1 || !dealerCard2) {
    user.balance += amount;
    user.gameNet.blackjack += amount;
    return res.status(500).json({ error: 'Deck error' });
  }

  game.hands = [{ cards: [card1, card2], bet: amount, insurance: 0, surrendered: false, doubled: false, splitFromAces: false }];
  game.dealerHand = [dealerCard1, dealerCard2];
  game.currentHandIndex = 0;
  game.hasActed = false;

  const dealerEv = blackjackEvaluateHand(game.dealerHand);
  const playerEv = blackjackEvaluateHand(game.hands[0].cards);

  if (dealerEv.blackjack && playerEv.blackjack) {
    game.phase = 'resolved';
    user.balance += amount;
    user.gameNet.blackjack += amount;
    game.dealerBlackjack = true;
    game.results = [{ handIndex: 0, outcome: 'push', netChange: 0 }];
    game.totalNet = 0;
  } else if (dealerEv.blackjack) {
    game.phase = 'resolved';
    game.dealerBlackjack = true;
    game.results = [{ handIndex: 0, outcome: 'lose', netChange: -amount }];
    game.totalNet = -amount;
  } else if (playerEv.blackjack) {
    game.phase = 'resolved';
    const winAmount = amount * 2.5;
    user.balance += winAmount;
    user.gameNet.blackjack += winAmount;
    user.totalGamblingWins = (user.totalGamblingWins || 0) + winAmount;
    user.totalProfitWins = (user.totalProfitWins || 0) + (winAmount - amount);
    user.totalWinsCount = (user.totalWinsCount || 0) + 1;
    user.xpBySource.blackjack = (user.xpBySource.blackjack || 0) + 3;
    if (winAmount > (user.biggestWinAmount || 0)) {
      user.biggestWinAmount = Math.min(winAmount, MAX_BIGGEST_WIN_AMOUNT);
      user.biggestWinMeta = { game: 'blackjack', betAmount: amount, multiplier: 1.5, timestamp: Date.now() };
    }
    game.results = [{ handIndex: 0, outcome: 'blackjack', netChange: amount * 1.5 }];
    game.totalNet = amount * 1.5;
  } else if (dealerCard1.rank === 'A') {
    game.phase = 'insurance';
    game.dealerBlackjack = false;
  } else {
    game.phase = 'waiting_for_player';
    game.dealerBlackjack = false;
  }

  if (!useDb) users.set(user.username, user);
  await saveUser(user);
  setBlackjackGame(user.username, game);

  res.json({
    balance: user.balance,
    game: sanitizeGameState(game, user.username),
  });
});

app.post('/api/blackjack/insurance', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  ensureFields(user);
  const game = getBlackjackGame(user.username);
  if (!game || game.phase !== 'insurance') {
    return res.status(400).json({ error: 'Insurance not available' });
  }
  const amount = Number(req.body.amount);
  const maxInsurance = game.hands[0].bet / 2;
  const insuranceAmount = Number.isFinite(amount) && amount >= 0 ? Math.min(amount, maxInsurance) : 0;
  if (insuranceAmount > 0 && insuranceAmount > (user.balance ?? 0)) {
    return res.status(400).json({ error: 'Insufficient balance for insurance' });
  }
  user.balance -= insuranceAmount;
  game.hands[0].insurance = insuranceAmount;
  const dealerEv = blackjackEvaluateHand(game.dealerHand);
  if (dealerEv.blackjack) {
    game.phase = 'resolved';
    game.dealerBlackjack = true;
    resolveBlackjackHands(game, user);
  } else {
    game.phase = 'waiting_for_player';
  }
  if (!useDb) users.set(user.username, user);
  await saveUser(user);
  setBlackjackGame(user.username, game);
  res.json({ balance: user.balance, game: sanitizeGameState(game, user.username) });
});

app.post('/api/blackjack/no-insurance', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  ensureFields(user);
  const game = getBlackjackGame(user.username);
  if (!game || game.phase !== 'insurance') {
    return res.status(400).json({ error: 'Wrong phase' });
  }
  const dealerEv = blackjackEvaluateHand(game.dealerHand);
  if (dealerEv.blackjack) {
    game.phase = 'resolved';
    game.dealerBlackjack = true;
    resolveBlackjackHands(game, user);
  } else {
    game.phase = 'waiting_for_player';
  }
  if (!useDb) users.set(user.username, user);
  await saveUser(user);
  setBlackjackGame(user.username, game);
  res.json({ balance: user.balance, game: sanitizeGameState(game, user.username) });
});

app.post('/api/blackjack/action', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  ensureFields(user);
  const game = getBlackjackGame(user.username);
  if (!game || (game.phase !== 'waiting_for_player' && game.phase !== 'player_turn')) {
    return res.status(400).json({ error: 'No action available' });
  }
  const action = String(req.body.action || '').toLowerCase();
  const handIndex = Math.max(0, parseInt(req.body.handIndex, 10) || 0);
  if (handIndex >= game.hands.length) {
    return res.status(400).json({ error: 'Invalid hand' });
  }
  const hand = game.hands[handIndex];
  const canFirstAction = !game.hasActed && hand.cards.length === 2;

  if (action === 'surrender') {
    if (!canFirstAction) return res.status(400).json({ error: 'Surrender only on first action' });
    hand.surrendered = true;
    user.balance += hand.bet * 0.5;
    user.gameNet.blackjack += hand.bet * 0.5;
    game.hasActed = true;
    game.results = [{ handIndex, outcome: 'surrender', netChange: hand.bet * 0.5 }];
    game.totalNet = hand.bet * 0.5;
    game.phase = 'resolved';
    if (!useDb) users.set(user.username, user);
    await saveUser(user);
    setBlackjackGame(user.username, game);
    return res.json({ balance: user.balance, game: sanitizeGameState(game, user.username) });
  }

  if (action === 'double') {
    if (!canFirstAction) return res.status(400).json({ error: 'Double only on first two cards' });
    if (hand.doubled || hand.splitFromAces) return res.status(400).json({ error: 'Cannot double' });
    if (hand.bet > (user.balance ?? 0)) return res.status(400).json({ error: 'Insufficient balance' });
    user.balance -= hand.bet;
    user.gameNet.blackjack -= hand.bet;
    hand.bet *= 2;
    hand.doubled = true;
    const card = drawFromShoe(game);
    if (card) hand.cards.push(card);
    const ev = blackjackEvaluateHand(hand.cards);
    if (ev.bust) {
      user.gameNet.blackjack -= hand.bet;
      game.results = [{ handIndex, outcome: 'bust', netChange: -hand.bet }];
      game.totalNet = -hand.bet;
      game.phase = 'resolved';
    } else {
      game.hasActed = true;
      game.currentHandIndex = handIndex + 1;
      if (game.currentHandIndex >= game.hands.length) {
        game.phase = 'dealer_turn';
        runDealerTurn(game);
        resolveBlackjackHands(game, user);
        game.phase = 'resolved';
      }
    }
    if (!useDb) users.set(user.username, user);
    await saveUser(user);
    setBlackjackGame(user.username, game);
    return res.json({ balance: user.balance, game: sanitizeGameState(game, user.username) });
  }

  if (action === 'split') {
    if (!canFirstAction) return res.status(400).json({ error: 'Split only on first two cards' });
    if (!blackjackCore.canSplit(hand.cards[0], hand.cards[1])) return res.status(400).json({ error: 'Cannot split' });
    if (hand.bet > (user.balance ?? 0)) return res.status(400).json({ error: 'Insufficient balance' });
    user.balance -= hand.bet;
    user.gameNet.blackjack -= hand.bet;
    const isAces = blackjackCore.isPairOfAces(hand.cards);
    const newHand = { cards: [hand.cards[1]], bet: hand.bet, insurance: 0, surrendered: false, doubled: false, splitFromAces: isAces };
    hand.cards = [hand.cards[0]];
    hand.splitFromAces = isAces;
    const card1 = drawFromShoe(game);
    const card2 = drawFromShoe(game);
    if (card1) hand.cards.push(card1);
    if (card2) newHand.cards.push(card2);
    game.hands.splice(handIndex + 1, 0, newHand);
    hand.insurance = 0;
    game.currentHandIndex = handIndex;
    game.hasActed = true;
    if (isAces) {
      game.phase = 'dealer_turn';
      runDealerTurn(game);
      resolveBlackjackHands(game, user);
      game.phase = 'resolved';
    }
    if (!useDb) users.set(user.username, user);
    await saveUser(user);
    setBlackjackGame(user.username, game);
    return res.json({ balance: user.balance, game: sanitizeGameState(game, user.username) });
  }

  if (action === 'hit') {
    const card = drawFromShoe(game);
    if (card) hand.cards.push(card);
    const ev = blackjackEvaluateHand(hand.cards);
    const doneWithHand = ev.bust || (hand.splitFromAces && hand.cards.length >= 2);
    if (doneWithHand) {
      game.currentHandIndex = handIndex + 1;
      if (game.currentHandIndex >= game.hands.length) {
        game.phase = 'dealer_turn';
        runDealerTurn(game);
        resolveBlackjackHands(game, user);
        game.phase = 'resolved';
      }
    }
    game.hasActed = true;
    if (!useDb) users.set(user.username, user);
    await saveUser(user);
    setBlackjackGame(user.username, game);
    return res.json({ balance: user.balance, game: sanitizeGameState(game, user.username) });
  }

  if (action === 'stand') {
    if (hand.splitFromAces && hand.cards.length < 2) return res.status(400).json({ error: 'Must take first card on split Aces' });
    game.hasActed = true;
    game.currentHandIndex = handIndex + 1;
    if (game.currentHandIndex >= game.hands.length) {
      game.phase = 'dealer_turn';
      runDealerTurn(game);
      resolveBlackjackHands(game, user);
      game.phase = 'resolved';
    }
    if (!useDb) users.set(user.username, user);
    await saveUser(user);
    setBlackjackGame(user.username, game);
    return res.json({ balance: user.balance, game: sanitizeGameState(game, user.username) });
  }

  return res.status(400).json({ error: 'Invalid action' });
});

// ===== CASE BATTLE (cases: DB when useDb/production, else file-backed; battles in-memory) =====
const CASE_BATTLE_CASES_FILE = path.join(DATA_DIR, 'case-battle-cases.json');
const caseBattleCases = new Map();
const caseBattleBattles = new Map();
let caseBattleCaseIdNext = 1;

function loadCaseBattleCasesFromFile() {
  try {
    if (fs.existsSync(CASE_BATTLE_CASES_FILE)) {
      const raw = fs.readFileSync(CASE_BATTLE_CASES_FILE, 'utf8');
      const arr = JSON.parse(raw);
      for (const c of arr) {
        if (c && c.id) {
          caseBattleCases.set(String(c.id), c);
          const n = parseInt(c.id, 10);
          if (!Number.isNaN(n) && n >= caseBattleCaseIdNext) caseBattleCaseIdNext = n + 1;
        }
      }
    }
  } catch (e) {
    console.warn('Could not load case battle cases from file:', e.message);
  }
}

function saveCaseBattleCasesToFile() {
  try {
    const arr = Array.from(caseBattleCases.values());
    fs.writeFileSync(CASE_BATTLE_CASES_FILE, JSON.stringify(arr, null, 0), 'utf8');
  } catch (e) {
    console.warn('Could not save case battle cases to file:', e.message);
  }
}
const BOT_NAMES = ['Ace', 'Blaze', 'Chip', 'Dice', 'Echo', 'Flux', 'Gale', 'Hex', 'Ivy', 'Jade', 'Kite', 'Luna', 'Nova', 'Onyx', 'Pepper', 'Quinn', 'Rex', 'Sky', 'Tank', 'Vex'];

function getBotDisplayName() {
  const name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
  return 'Bot ' + name;
}

/** Pick one item from a case by probability. roll01 in [0, 1). Case items have probability 0–100. */
function pickItemFromCase(caseDoc, roll01) {
  const items = caseDoc?.items || [];
  if (items.length === 0) return { value: 0, name: '', image: '' };
  const sum = items.reduce((s, i) => s + (Number(i.probability) || 0), 0);
  let cum = 0;
  const r = Math.max(0, Math.min(1, Number(roll01) || 0));
  for (const it of items) {
    const p = sum > 0 ? (Number(it.probability) || 0) / sum : 0;
    cum += p;
    if (r < cum) return { value: Number(it.value) || 0, name: it.name || '', image: it.image || '' };
  }
  const last = items[items.length - 1];
  return { value: Number(last?.value) || 0, name: last?.name || '', image: last?.image || '' };
}

/** Run battle: open cases for all participants, resolve winner, apply payouts. Call after short delay when status becomes in_progress. */
async function runCaseBattle(battleId) {
  const battle = caseBattleBattles.get(battleId);
  if (!battle || battle.status !== 'in_progress') return;
  const { serverSeed, clientSeed } = battle;
  let nonce = battle.nonce ?? 0;
  const roll = () => {
    const r = caseBattleProvably.roll01(serverSeed, clientSeed, nonce);
    nonce += 1;
    return r;
  };

  for (const p of battle.participants) {
    p.totalValue = 0;
    p.terminalValue = 0;
  }

  const roundResults = [];
  for (const { caseId, count } of battle.cases || []) {
    const caseDoc = caseBattleCases.get(String(caseId));
    if (!caseDoc) continue;
    const n = Math.max(1, parseInt(count, 10) || 1);
    for (let openIndex = 0; openIndex < n; openIndex++) {
      const roundItems = [];
      for (let i = 0; i < battle.participants.length; i++) {
        const p = battle.participants[i];
        const r = roll();
        const item = pickItemFromCase(caseDoc, r);
        p.totalValue = (p.totalValue || 0) + item.value;
        p.terminalValue = item.value;
        roundItems.push({ value: item.value, name: item.name, image: item.image });
      }
      roundResults.push({ caseId: String(caseId), items: roundItems });
    }
  }
  battle.nonce = nonce;

  // Pot to distribute = sum of ALL items opened (total value of all players), NEVER entry cost
  const totalValueOfAllItems = battle.participants.reduce((s, p) => s + (p.totalValue || 0), 0);
  const mode = (battle.mode || 'standard').toLowerCase();
  const crazyMode = !!(battle.crazyMode && mode !== 'coop');
  const payoutOpts = { totalValueOfAllItems, crazyMode };
  let result;
  if (mode === 'jackpot') {
    const byTeam = new Map();
    for (const p of battle.participants) {
      const t = p.teamIndex;
      if (!byTeam.has(t)) byTeam.set(t, { teamIndex: t, totalValue: 0 });
      byTeam.get(t).totalValue += p.totalValue || 0;
    }
    const teamTotals = Array.from(byTeam.values());
    const winnerTeam = caseBattleMath.resolveJackpotWinner(teamTotals, totalValueOfAllItems, roll(), { crazyMode });
    battle.nonce = nonce + 1;
    result = caseBattleMath.resolveBattleResult(battle.participants, mode, payoutOpts);
    result.winnerTeamIndex = winnerTeam;
    result.payouts = battle.participants.map((p) => ({
      teamIndex: p.teamIndex,
      slotIndex: p.slotIndex,
      amount: p.teamIndex === winnerTeam ? totalValueOfAllItems / Math.max(1, battle.participants.filter((x) => x.teamIndex === winnerTeam).length) : 0,
    }));
  } else {
    result = caseBattleMath.resolveBattleResult(battle.participants, mode, payoutOpts);
  }

  for (const pay of result.payouts || []) {
    const p = battle.participants.find((x) => x.teamIndex === pay.teamIndex && x.slotIndex === pay.slotIndex);
    if (!p || p.isBot || (pay.amount || 0) <= 0) continue;
    const u = await getUserByKeyOrSlug(p.username);
    if (u) {
      ensureFields(u);
      u.balance = (u.balance ?? 0) + pay.amount;
      if (!useDb) users.set(u.username, u);
      await saveUser(u);
    }
  }

  // Pre-generate deterministic strip data for client-sync'd animations
  const stripData = [];
  for (let r = 0; r < roundResults.length; r++) {
    const roundStrips = [];
    for (let pi = 0; pi < battle.participants.length; pi++) {
      roundStrips.push({
        stripSeed: caseBattleProvably.roll01(serverSeed, clientSeed, nonce),
        stopOffset: caseBattleProvably.roll01(serverSeed, clientSeed, nonce + 1),
      });
      nonce += 2;
    }
    stripData.push(roundStrips);
  }
  battle.nonce = nonce;

  battle.totalPot = totalValueOfAllItems;
  battle.status = 'finished';
  battle.finishedAt = Date.now();
  battle.animationStartedAt = Date.now();
  battle.animationDurationPerRound = 5500;
  battle.animationPausePerRound = 800;
  battle.result = { ...result, roundResults, stripData };
}

function scheduleCaseBattleRun(battleId) {
  setTimeout(() => runCaseBattle(battleId), 2500);
}

app.get('/api/case-battle/cases', async (req, res) => {
  const list = Array.from(caseBattleCases.values()).filter((c) => c.isActive !== false).map((c) => ({
    ...c,
    usageCount: c.usageCount ?? 0,
  }));
  res.json({ cases: list });
});

app.post('/api/case-battle/calculate-price', async (req, res) => {
  const { items, rtpDecimal } = req.body || {};
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items array required' });
  const rtp = Number(rtpDecimal);
  if (!Number.isFinite(rtp) || rtp <= 0 || rtp > 1) return res.status(400).json({ error: 'rtpDecimal 0–1 required' });
  const normalized = items.map((i) => ({
    value: Number(i.value) || 0,
    probability: Number(i.probability) != null ? Number(i.probability) / 100 : 0,
  }));
  const result = caseBattleMath.calculateCasePrice(normalized, rtp);
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json({ price: result.price, ev: result.ev });
});

app.post('/api/case-battle/cases', requireAdmin, async (req, res) => {
  const { name, rtpDecimal, items } = req.body || {};
  if (!name || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Name and items (with image, value, probability) required' });
  }
  const rtp = Number(rtpDecimal);
  if (!Number.isFinite(rtp) || rtp <= 0 || rtp > 1) {
    return res.status(400).json({ error: 'RTP must be decimal 0–1 (e.g. 0.95)' });
  }
  const normalized = items.map((i) => ({
    value: Number(i.value) || 0,
    probability: Number(i.probability) != null ? Number(i.probability) / 100 : 0,
    name: i.name || '',
    image: i.image || '',
  }));
  const result = caseBattleMath.calculateCasePrice(normalized, rtp);
  if (!result.success) return res.status(400).json({ error: result.error });
  const slug = (name || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'case-' + Date.now();
  const doc = {
    name: String(name).trim(),
    slug,
    rtpDecimal: rtp,
    price: result.price,
    expectedValue: result.ev,
    items: normalized.map((i) => ({ ...i, probability: i.probability * 100 })),
    createdAt: Date.now(),
    createdBy: req.adminUser?.username,
    isActive: true,
    usageCount: 0,
  };
  let id;
  if (useDb) {
    try {
      id = await db.saveCaseBattleCase(doc);
      doc.id = id;
      const n = parseInt(id, 10);
      if (!Number.isNaN(n) && n >= caseBattleCaseIdNext) caseBattleCaseIdNext = n + 1;
    } catch (e) {
      console.error('Save case battle case failed:', e.message || e);
      return res.status(500).json({ error: 'Failed to save case' });
    }
  } else {
    id = String(caseBattleCaseIdNext++);
    doc.id = id;
    saveCaseBattleCasesToFile();
  }
  caseBattleCases.set(id, doc);
  res.json({ case: doc });
});

async function enrichBattleParticipants(battle) {
  const participants = await Promise.all(
    (battle.participants || []).map(async (p) => {
      if (!p.username || p.isBot) return { ...p, displayName: p.username || '' };
      const u = await getUserByKeyOrSlug(p.username);
      return { ...p, displayName: (u && (u.displayName || u.username)) ? (u.displayName || u.username) : p.username };
    })
  );
  const out = { ...battle, participants };
  if (battle.cases && battle.cases.length > 0) {
    out.caseDefs = {};
    for (const { caseId } of battle.cases) {
      const c = caseBattleCases.get(String(caseId));
      if (c) out.caseDefs[caseId] = { name: c.name, items: c.items || [] };
    }
  }
  return out;
}

const FINISHED_BATTLE_VISIBLE_MS = 5 * 1000; // 5 sec after finished

app.get('/api/case-battle/battles', async (req, res) => {
  const now = Date.now();
  const active = Array.from(caseBattleBattles.values()).filter((b) => {
    if (b.status === 'waiting' || b.status === 'in_progress') return true;
    if (b.status === 'finished' && (b.finishedAt == null || now - b.finishedAt < FINISHED_BATTLE_VISIBLE_MS)) return true;
    return false;
  });
  const enriched = await Promise.all(active.map(enrichBattleParticipants));
  res.json({ battles: enriched });
});

app.post('/api/case-battle/battles', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  ensureFields(user);
  // Limit: one active battle per user
  const hasActive = Array.from(caseBattleBattles.values()).some((b) =>
    (b.status === 'waiting' || b.status === 'in_progress') &&
    b.participants.some((p) => p.username === user.username && !p.isBot)
  );
  if (hasActive) {
    return res.status(400).json({ error: 'You already have an active battle. Finish or delete it first.' });
  }
  const { format, mode, caseIds, botCount, crazyMode } = req.body || {};
  if (!format || !mode || !Array.isArray(caseIds) || caseIds.length === 0) {
    return res.status(400).json({ error: 'format, mode, and caseIds (array of { caseId, count }) required' });
  }
  const modeLower = (mode || '').toLowerCase();
  const isCrazy = !!(crazyMode && modeLower !== 'coop');
  const slotsPerSide = format.split('v').map((n) => parseInt(n, 10)).filter((n) => Number.isFinite(n));
  if (!caseBattleMath.isAllowedFormat(slotsPerSide)) {
    return res.status(400).json({ error: 'Invalid format (e.g. 1v1, 2v2, 3v3)' });
  }
  const totalSlots = slotsPerSide.reduce((a, b) => a + b, 0);
  let entryCost = 0;
  const casesInBattle = [];
  for (const { caseId, count } of caseIds) {
    const c = caseBattleCases.get(String(caseId));
    if (!c) return res.status(400).json({ error: 'Case not found: ' + caseId });
    const n = Math.max(1, parseInt(count, 10) || 1);
    entryCost += c.price * n;
    casesInBattle.push({ caseId: c.id, count: n });
  }
  if (entryCost > (user.balance ?? 0)) {
    return res.status(400).json({ error: 'Insufficient balance for entry' });
  }
  const battleId = crypto.randomUUID();
  const participants = [];
  let slotIdx = 0;
  for (let t = 0; t < slotsPerSide.length; t++) {
    for (let s = 0; s < slotsPerSide[t]; s++) {
      participants.push({
        teamIndex: t,
        slotIndex: s,
        username: slotIdx === 0 ? user.username : '',
        isBot: false,
        entryPaid: slotIdx === 0 ? entryCost : 0,
        totalValue: 0,
        terminalValue: 0,
      });
      slotIdx++;
    }
  }
  participants[0].username = user.username;
  participants[0].entryPaid = entryCost;
  user.balance -= entryCost;
  if (!useDb) users.set(user.username, user);
  await saveUser(user);
  const addBots = Math.min(Number(botCount) ?? 0, totalSlots - 1);
  const usedNames = new Set([user.username]);
  let added = 0;
  for (let i = 0; i < participants.length && added < addBots; i++) {
    if (participants[i].username) continue;
    const baseName = getBotDisplayName();
    let botName = baseName;
    let suffix = 1;
    while (usedNames.has(botName)) {
      botName = baseName + ' ' + suffix;
      suffix++;
    }
    usedNames.add(botName);
    participants[i].username = botName;
    participants[i].isBot = true;
    added++;
  }
  const battle = {
    id: battleId,
    createdBy: user.username,
    format,
    mode: modeLower || mode,
    crazyMode: isCrazy,
    entryCostPerSide: entryCost,
    totalPot: entryCost * slotsPerSide.length,
    status: participants.every((p) => p.username) ? 'in_progress' : 'waiting',
    cases: casesInBattle,
    participants,
    totalSlots,
    createdAt: Date.now(),
    serverSeed: caseBattleProvably.generateServerSeed(),
    clientSeed: 'cb_' + battleId.slice(0, 8),
    nonce: 0,
  };
  caseBattleBattles.set(battleId, battle);
  if (battle.status === 'in_progress') scheduleCaseBattleRun(battleId);
  for (const { caseId, count } of casesInBattle) {
    const c = caseBattleCases.get(String(caseId));
    if (c) {
      c.usageCount = (c.usageCount ?? 0) + count;
      if (useDb) db.updateCaseBattleCaseUsageCount(c.id, c.usageCount).catch((e) => console.error('Update case usage failed:', e.message));
    }
  }
  res.json({ battle: await enrichBattleParticipants(battle), balance: user.balance });
});

app.post('/api/case-battle/battles/:id/join', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  ensureFields(user);
  const battle = caseBattleBattles.get(req.params.id);
  if (!battle) return res.status(404).json({ error: 'Battle not found' });
  if (battle.status !== 'waiting') return res.status(400).json({ error: 'Battle already started' });
  let entryCost = 0;
  for (const { caseId, count } of battle.cases || []) {
    const c = caseBattleCases.get(String(caseId));
    if (c) entryCost += c.price * (parseInt(count, 10) || 1);
  }
  if ((user.balance ?? 0) < entryCost) return res.status(400).json({ error: 'Insufficient balance' });
  const emptySlot = battle.participants.findIndex((p) => !p.username);
  if (emptySlot < 0) return res.status(400).json({ error: 'No empty slot' });
  user.balance -= entryCost;
  battle.participants[emptySlot] = {
    ...battle.participants[emptySlot],
    username: user.username,
    isBot: false,
    entryPaid: entryCost,
  };
  if (battle.participants.every((p) => p.username)) {
    battle.status = 'in_progress';
    scheduleCaseBattleRun(battle.id);
  }
  if (!useDb) users.set(user.username, user);
  await saveUser(user);
  res.json({ battle: await enrichBattleParticipants(battle), balance: user.balance });
});

app.post('/api/case-battle/battles/:id/add-bot', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const battle = caseBattleBattles.get(req.params.id);
  if (!battle) return res.status(404).json({ error: 'Battle not found' });
  const slotIndex = req.body?.slotIndex != null ? parseInt(req.body.slotIndex, 10) : -1;
  const targetSlot = slotIndex >= 0 && slotIndex < battle.participants.length && !battle.participants[slotIndex].username
    ? slotIndex
    : battle.participants.findIndex((p) => !p.username);
  if (targetSlot < 0 || battle.participants[targetSlot].username) {
    return res.status(400).json({ error: 'No empty slot' });
  }
  const usedNames = new Set(battle.participants.map((p) => p.username).filter(Boolean));
  const baseName = getBotDisplayName();
  let botName = baseName;
  let suffix = 1;
  while (usedNames.has(botName)) {
    botName = baseName + ' ' + suffix;
    suffix++;
  }
  const teamSlot = battle.participants[targetSlot].teamIndex;
  const slotInTeam = battle.participants.filter((p) => p.teamIndex === teamSlot && p.username).length;
  battle.participants[targetSlot] = {
    teamIndex: teamSlot,
    slotIndex: slotInTeam,
    username: botName,
    isBot: true,
    entryPaid: 0,
    totalValue: 0,
    terminalValue: 0,
  };
  if (battle.participants.every((p) => p.username)) {
    battle.status = 'in_progress';
    scheduleCaseBattleRun(battle.id);
  }
  res.json({ battle: await enrichBattleParticipants(battle) });
});

app.get('/api/case-battle/battles/:id', async (req, res) => {
  const battle = caseBattleBattles.get(req.params.id);
  if (!battle) return res.status(404).json({ error: 'Battle not found' });
  res.json({ battle: await enrichBattleParticipants(battle) });
});

app.delete('/api/case-battle/battles/:id', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  ensureFields(user);
  const battle = caseBattleBattles.get(req.params.id);
  if (!battle) return res.status(404).json({ error: 'Battle not found' });
  if (battle.status !== 'waiting') return res.status(400).json({ error: 'Battle already started' });
  if (battle.createdBy !== user.username) return res.status(403).json({ error: 'Only the creator can delete this battle' });
  for (const p of battle.participants) {
    if (p.username && !p.isBot && p.entryPaid > 0) {
      const u = await getUserByKeyOrSlug(p.username);
      if (u) {
        ensureFields(u);
        u.balance = (u.balance ?? 0) + p.entryPaid;
        if (!useDb) users.set(u.username, u);
        await saveUser(u);
        if (u.username === user.username) user.balance = u.balance;
      }
    }
  }
  caseBattleBattles.delete(req.params.id);
  res.json({ ok: true, balance: user.balance });
});

async function start() {
  loadData();
  runCrashNextRound();
  if (!useDb) loadCaseBattleCasesFromFile();
  if (useDb) {
    try {
      await db.ensureTables();
      const ps = await db.getPlinkoStats();
      plinkoStats.totalBalls = ps.totalBalls ?? 0;
      plinkoStats.landings = Array.isArray(ps.landings) ? ps.landings : Array(19).fill(0);
      while (plinkoStats.landings.length < 19) plinkoStats.landings.push(0);
      const savedCases = await db.getCaseBattleCases();
      for (const c of savedCases) {
        caseBattleCases.set(c.id, c);
        const n = parseInt(c.id, 10);
        if (!Number.isNaN(n) && n >= caseBattleCaseIdNext) caseBattleCaseIdNext = n + 1;
      }
      if (savedCases.length) console.log('Case Battle: loaded ' + savedCases.length + ' cases from database');
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
