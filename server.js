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
app.use(express.static(__dirname));

// --- File-based persistence ---
// Use DATA_DIR env for persistent storage on deploy (e.g. /data or mounted volume)
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const PLINKO_STATS_FILE = path.join(DATA_DIR, 'plinko-stats.json');

const users = new Map();
const sessions = new Map();

const plinkoStats = { totalBalls: 0, landings: Array(19).fill(0) };

function loadData() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(USERS_FILE)) {
      const obj = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
      for (const [k, v] of Object.entries(obj)) {
        const key = (k || '').toLowerCase().trim();
        if (key && v) {
          v.username = v.username || key;
          if (!v.profileSlug) v.profileSlug = getProfileSlug(v.username);
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
  } catch (e) {
    console.warn('Could not load data, starting fresh:', e.message);
  }
}

function savePlinkoStats() {
  try {
    fs.writeFileSync(PLINKO_STATS_FILE, JSON.stringify(plinkoStats, null, 2));
  } catch (e) {
    console.error('Failed to save plinko stats:', e.message);
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

// Pre-made Mikmail owner – full profile, always exists after server start
const MIKMAIL_EMAIL = 'mikael@betyr.no';
const MIKMAIL_PASSWORD = 'owner123';

function ensureMikmailUser() {
  const key = MIKMAIL_EMAIL.toLowerCase().trim();
  let user = users.get(key);
  const fullUser = {
    username: key,
    profileSlug: getProfileSlug(key),
    password: bcrypt.hashSync(MIKMAIL_PASSWORD, 10),
    displayName: 'Mikmail',
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
    isOwner: true,
    createdAt: Date.now(),
  };
  ensureFields(fullUser);
  if (!user) {
    users.set(key, fullUser);
    saveUsers();
    console.log(`[Gambleio] Mikmail owner created. Login: ${MIKMAIL_EMAIL} / ${MIKMAIL_PASSWORD}`);
  } else {
    user.username = key;
    user.profileSlug = getProfileSlug(key);
    user.password = fullUser.password;
    user.displayName = 'Mikmail';
    user.balance = fullUser.balance;
    user.totalGamblingWins = fullUser.totalGamblingWins;
    user.totalClickEarnings = fullUser.totalClickEarnings;
    user.totalBets = fullUser.totalBets;
    user.level = fullUser.level;
    user.xp = fullUser.xp;
    user.totalClicks = fullUser.totalClicks;
    user.totalWinsCount = fullUser.totalWinsCount;
    user.biggestWinAmount = fullUser.biggestWinAmount;
    user.biggestWinMultiplier = fullUser.biggestWinMultiplier;
    user.isOwner = true;
    ensureFields(user);
    users.set(key, user);
    saveUsers();
  }
}
ensureMikmailUser();

function generateToken() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

function getUserFromSession(token) {
  if (!token) return null;
  const userId = sessions.get(token);
  if (!userId) return null;
  return users.get(userId);
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
  if (user.biggestWinAmount === undefined) user.biggestWinAmount = 0;
  if (user.biggestWinMultiplier === undefined) user.biggestWinMultiplier = 1;
  if (user.totalBets === undefined) user.totalBets = 0;
  if (user.xp === undefined) user.xp = 0;
  if (user.level === undefined) user.level = 1;
  if (user.balance === undefined) user.balance = 0;
  return user;
}

function publicUser(u) {
  ensureProfileSlug(u);
  return {
    username: u.username,
    profileSlug: u.profileSlug || getProfileSlug(u.username),
    displayName: u.displayName || u.username,
    isOwner: !!u.isOwner,
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

function getProfileSlug(username) {
  if (!username || typeof username !== 'string') return '';
  if (!username.includes('@')) return username.toLowerCase();
  return 'u' + crypto.createHash('sha256').update(username.toLowerCase()).digest('hex').slice(0, 12);
}

function ensureProfileSlug(user) {
  if (!user.profileSlug) {
    user.profileSlug = getProfileSlug(user.username);
  }
}

function publicProfile(u) {
  ensureProfileSlug(u);
  return {
    username: u.username,
    profileSlug: u.profileSlug || getProfileSlug(u.username),
    displayName: u.displayName || u.username,
    isOwner: !!u.isOwner,
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
  const userKey = (username || '').toLowerCase().trim();
  if (!userKey || !password || userKey.length < 3 || password.length < 3) {
    return res.status(400).json({ error: 'Username and password must be at least 3 characters' });
  }
  if (users.has(userKey)) {
    return res.status(400).json({ error: 'Username already exists' });
  }
  const user = {
    username: userKey,
    profileSlug: getProfileSlug(userKey),
    password: bcrypt.hashSync(password, 10),
    displayName: (displayName || '').trim() || userKey,
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
  users.set(userKey, user);
  saveUsers();
  const token = generateToken();
  sessions.set(token, userKey);
  saveSessions();
  res.json({ token, user: publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const userKey = (username || '').toLowerCase().trim();
  const user = users.get(userKey);
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
    users.set(user.username, user);
    saveUsers();
  }
  ensureFields(user);
  const token = generateToken();
  sessions.set(token, userKey);
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

// Public profile (no balance, no email) – for viewing other users. Lookup by username or profileSlug.
app.get('/api/user/:slug/profile', (req, res) => {
  const slug = (req.params.slug || '').trim();
  if (!slug) return res.status(400).json({ error: 'Profile identifier required' });
  let user = users.get(slug.toLowerCase());
  if (!user) {
    user = Array.from(users.values()).find(u => {
      ensureProfileSlug(u);
      return (u.profileSlug || getProfileSlug(u.username)) === slug;
    });
  }
  if (!user) return res.status(404).json({ error: 'User not found' });
  ensureFields(user);
  user.level = getLevelFromXp(user.xp);
  res.json(publicProfile(user));
});

// ===== STATS =====

app.get('/api/user/stats', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  ensureFields(user);
  user.level = getLevelFromXp(user.xp);
  res.json(publicUser(user));
});

// Only sync non-delta fields: xp, level, biggestWin
app.post('/api/user/update-stats', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  ensureFields(user);
  const { level, xp, biggestWinAmount, biggestWinMultiplier } = req.body;
  if (xp !== undefined) {
    user.xp = xp;
    user.level = getLevelFromXp(xp);
  } else if (level !== undefined) user.level = level;
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
  const validTypes = ['clicks', 'wins', 'biggest-win', 'networth', 'xp', 'level'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: 'Invalid leaderboard type' });
  }
  const allUsers = Array.from(users.values()).map(u => {
    ensureFields(u);
    ensureProfileSlug(u);
    return {
      username: u.username,
      profileSlug: u.profileSlug || getProfileSlug(u.username),
      displayName: u.displayName || u.username,
      isOwner: !!u.isOwner,
      balance: u.balance ?? 0,
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
  else if (type === 'networth') sorted = allUsers.sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0));
  else if (type === 'xp') sorted = allUsers.sort((a, b) => b.xp - a.xp);
  else if (type === 'level') sorted = allUsers.sort((a, b) => b.level - a.level || b.xp - a.xp);
  res.json(sorted.slice(0, 100));
});

app.post('/api/plinko-land', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const { slotIndex, bet, multiplier } = req.body;
  const si = typeof slotIndex === 'number' ? Math.floor(slotIndex) : -1;
  const idx = si >= 0 && si <= 17 ? si : 18;
  plinkoStats.totalBalls += 1;
  plinkoStats.landings[idx] = (plinkoStats.landings[idx] || 0) + 1;
  savePlinkoStats();
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

// ===== ROULETTE ROUND SYSTEM =====
const ROULETTE_BETTING_MS = 20000;
const ROULETTE_SPINNING_MS = 5000;
const ROULETTE_RESULT_MS = 3000;
const ROULETTE_RED = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];

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
    resolveAllRouletteBets();
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
  const num = parseInt(key, 10);
  if (!isNaN(num) && num >= 0 && num <= 36) return 36;
  if (key === '1-12' || key === '13-24' || key === '25-36') return 3;
  return 2;
}

function resolveAllRouletteBets() {
  const win = rouletteState.winNumber;
  for (const [username, userBets] of rouletteState.bets) {
    const user = users.get(username);
    if (!user) continue;
    ensureFields(user);
    let totalWin = 0;
    let totalBet = 0;
    for (const { key, amount } of userBets) {
      totalBet += amount;
      if (isRouletteWin(key, win)) {
        totalWin += amount * roulettePayout(key);
      }
    }
    if (totalWin > 0) {
      user.balance += totalWin;
      user.totalGamblingWins += totalWin;
      if (totalWin > totalBet) {
        user.totalWinsCount += 1;
        if (totalWin > user.biggestWinAmount) {
          user.biggestWinAmount = totalWin;
          user.biggestWinMultiplier = totalBet > 0 ? Math.round((totalWin / totalBet) * 100) / 100 : 1;
        }
      }
      users.set(username, user);
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
  saveUsers();
}

setInterval(rouletteTick, 500);

app.get('/api/roulette/round', (req, res) => {
  rouletteTick();
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = getUserFromSession(token);
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

app.post('/api/roulette/bet', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = getUserFromSession(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  ensureFields(user);
  rouletteTick();
  if (rouletteState.phase !== 'betting') {
    return res.status(400).json({ error: 'Betting phase is over' });
  }
  const { key, amount } = req.body;
  const amt = Number(amount);
  if (!key || !Number.isFinite(amt) || amt < 1) {
    return res.status(400).json({ error: 'Invalid bet' });
  }
  if (amt > user.balance) {
    return res.status(400).json({ error: 'Insufficient balance' });
  }
  user.balance -= amt;
  user.totalBets += 1;
  users.set(user.username, user);
  saveUsers();
  if (!rouletteState.bets.has(user.username)) {
    rouletteState.bets.set(user.username, []);
  }
  rouletteState.bets.get(user.username).push({ key, amount: amt });
  res.json({ balance: user.balance, totalBets: user.totalBets });
});

app.post('/api/roulette/clear-bets', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = getUserFromSession(token);
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
    users.set(user.username, user);
    saveUsers();
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

app.listen(PORT, () => {
  console.log(`Gambleio server running on http://localhost:${PORT}`);
  if (DATA_DIR !== path.join(__dirname, 'data')) {
    console.log(`Data dir: ${DATA_DIR}`);
  }
});
