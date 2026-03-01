/**
 * PostgreSQL database layer for Gambleio.
 * Requires DATABASE_URL. Passwords are stored only as bcrypt hashes (never plain text).
 */
const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required for database mode');
    pool = new Pool({
      connectionString: url,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
    });
  }
  return pool;
}

function rowToUser(row) {
  if (!row) return null;
  return {
    username: row.username,
    profileSlug: row.profile_slug,
    password: row.password_hash,
    displayName: row.display_name,
    role: row.role,
    balance: Number(row.balance ?? 0),
    xp: Number(row.xp ?? 0),
    level: Number(row.level ?? 1),
    totalClicks: Number(row.total_clicks ?? 0),
    totalBets: Number(row.total_bets ?? 0),
    totalGamblingWins: Number(row.total_gambling_wins ?? 0),
    totalWinsCount: Number(row.total_wins_count ?? 0),
    biggestWinAmount: Number(row.biggest_win_amount ?? 0),
    biggestWinMultiplier: Number(row.biggest_win_multiplier ?? 1),
    totalClickEarnings: Number(row.total_click_earnings ?? 0),
    totalProfitWins: Number(row.total_profit_wins ?? 0),
    isOwner: !!row.is_owner,
    isAdmin: !!row.is_admin,
    createdAt: row.created_at != null ? Number(row.created_at) : undefined,
    analyticsStartedAt: row.analytics_started_at != null ? Number(row.analytics_started_at) : undefined,
    gameNet: row.game_net && typeof row.game_net === 'object' ? row.game_net : { click: 0, plinko: 0, roulette: 0, slots: 0 },
    gamePlayCounts: row.game_play_counts && typeof row.game_play_counts === 'object' ? row.game_play_counts : { click: 0, plinko: 0, roulette: 0, slots: 0 },
    xpBySource: row.xp_by_source && typeof row.xp_by_source === 'object' ? row.xp_by_source : { click: 0, plinko: 0, roulette: 0, slots: 0 },
    plinkoRiskLevel: row.plinko_risk_level || 'low',
    plinkoRiskUnlocked: row.plinko_risk_unlocked && typeof row.plinko_risk_unlocked === 'object' ? row.plinko_risk_unlocked : { medium: false, high: false, extreme: false },
    biggestWinMeta: row.biggest_win_meta && typeof row.biggest_win_meta === 'object' ? row.biggest_win_meta : { game: null, betAmount: 0, multiplier: 1, timestamp: 0 },
  };
}

async function getUserByUsername(key) {
  const k = (key || '').toLowerCase().trim();
  if (!k) return null;
  const res = await getPool().query('SELECT * FROM users WHERE username = $1', [k]);
  return rowToUser(res.rows[0]);
}

async function getUserByProfileSlug(slug) {
  if (!slug) return null;
  const res = await getPool().query('SELECT * FROM users WHERE LOWER(profile_slug) = LOWER($1)', [slug]);
  return rowToUser(res.rows[0]);
}

async function saveUser(user) {
  const u = user;
  const gameNet = typeof u.gameNet === 'object' ? u.gameNet : {};
  const gamePlayCounts = typeof u.gamePlayCounts === 'object' ? u.gamePlayCounts : {};
  const xpBySource = typeof u.xpBySource === 'object' ? u.xpBySource : {};
  const plinkoRiskUnlocked = typeof u.plinkoRiskUnlocked === 'object' ? u.plinkoRiskUnlocked : {};
  const biggestWinMeta = typeof u.biggestWinMeta === 'object' ? u.biggestWinMeta : {};

  await getPool().query(
    `INSERT INTO users (
      username, profile_slug, password_hash, display_name, role, balance, xp, level,
      total_clicks, total_bets, total_gambling_wins, total_wins_count, biggest_win_amount, biggest_win_multiplier,
      total_click_earnings, total_profit_wins, is_owner, is_admin, created_at, analytics_started_at,
      game_net, game_play_counts, xp_by_source, plinko_risk_level, plinko_risk_unlocked, biggest_win_meta
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26
    ) ON CONFLICT (username) DO UPDATE SET
      profile_slug = EXCLUDED.profile_slug,
      password_hash = EXCLUDED.password_hash,
      display_name = EXCLUDED.display_name,
      role = EXCLUDED.role,
      balance = EXCLUDED.balance,
      xp = EXCLUDED.xp,
      level = EXCLUDED.level,
      total_clicks = EXCLUDED.total_clicks,
      total_bets = EXCLUDED.total_bets,
      total_gambling_wins = EXCLUDED.total_gambling_wins,
      total_wins_count = EXCLUDED.total_wins_count,
      biggest_win_amount = EXCLUDED.biggest_win_amount,
      biggest_win_multiplier = EXCLUDED.biggest_win_multiplier,
      total_click_earnings = EXCLUDED.total_click_earnings,
      total_profit_wins = EXCLUDED.total_profit_wins,
      is_owner = EXCLUDED.is_owner,
      is_admin = EXCLUDED.is_admin,
      analytics_started_at = EXCLUDED.analytics_started_at,
      game_net = EXCLUDED.game_net,
      game_play_counts = EXCLUDED.game_play_counts,
      xp_by_source = EXCLUDED.xp_by_source,
      plinko_risk_level = EXCLUDED.plinko_risk_level,
      plinko_risk_unlocked = EXCLUDED.plinko_risk_unlocked,
      biggest_win_meta = EXCLUDED.biggest_win_meta`,
    [
      u.username,
      u.profileSlug || null,
      u.password || '',
      u.displayName || u.username,
      u.role ?? null,
      u.balance ?? 0,
      u.xp ?? 0,
      u.level ?? 1,
      u.totalClicks ?? 0,
      u.totalBets ?? 0,
      u.totalGamblingWins ?? 0,
      u.totalWinsCount ?? 0,
      u.biggestWinAmount ?? 0,
      u.biggestWinMultiplier ?? 1,
      u.totalClickEarnings ?? 0,
      u.totalProfitWins ?? 0,
      !!u.isOwner,
      !!(u.isOwner || u.isAdmin),
      u.createdAt ?? Date.now(),
      u.analyticsStartedAt ?? Date.now(),
      JSON.stringify(gameNet),
      JSON.stringify(gamePlayCounts),
      JSON.stringify(xpBySource),
      u.plinkoRiskLevel || 'low',
      JSON.stringify(plinkoRiskUnlocked),
      JSON.stringify(biggestWinMeta),
    ]
  );
}

async function getAllUsers() {
  const res = await getPool().query('SELECT * FROM users ORDER BY username');
  return res.rows.map(rowToUser);
}

async function userExists(key) {
  const k = (key || '').toLowerCase().trim();
  if (!k) return false;
  const res = await getPool().query('SELECT 1 FROM users WHERE username = $1', [k]);
  return res.rowCount > 0;
}

async function getSession(token) {
  if (!token) return null;
  const res = await getPool().query('SELECT user_key FROM sessions WHERE token = $1', [token]);
  return res.rows[0] ? res.rows[0].user_key : null;
}

async function setSession(token, userKey) {
  await getPool().query(
    'INSERT INTO sessions (token, user_key, created_at) VALUES ($1, $2, $3) ON CONFLICT (token) DO UPDATE SET user_key = $2, created_at = $3',
    [token, userKey, Date.now()]
  );
}

async function deleteSession(token) {
  if (!token) return;
  await getPool().query('DELETE FROM sessions WHERE token = $1', [token]);
}

async function getPlinkoStats() {
  const res = await getPool().query('SELECT total_balls, landings FROM plinko_stats WHERE id = 1');
  const row = res.rows[0];
  if (!row) return { totalBalls: 0, landings: Array(19).fill(0) };
  const landings = Array.isArray(row.landings) ? row.landings : (typeof row.landings === 'object' ? Object.values(row.landings) : []);
  while (landings.length < 19) landings.push(0);
  return {
    totalBalls: Number(row.total_balls ?? 0),
    landings: landings.slice(0, 19).map((n) => Number(n) || 0),
  };
}

async function savePlinkoStats(data) {
  const landings = Array.isArray(data.landings) ? data.landings : Array(19).fill(0);
  while (landings.length < 19) landings.push(0);
  await getPool().query(
    'INSERT INTO plinko_stats (id, total_balls, landings) VALUES (1, $1, $2) ON CONFLICT (id) DO UPDATE SET total_balls = $1, landings = $2',
    [Number(data.totalBalls ?? 0), JSON.stringify(landings)]
  );
}

async function addAdminLog(entry) {
  const e = { ...entry, timestamp: entry.timestamp || Date.now() };
  await getPool().query(
    `INSERT INTO admin_logs (type, timestamp, actor_username, actor_display_name, target_username, target_display_name, role, adjust_type, value, new_level, previous_level, meta)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      e.type || null,
      e.timestamp,
      e.actorUsername || null,
      e.actorDisplayName || null,
      e.targetUsername || null,
      e.targetDisplayName || null,
      e.role || null,
      e.adjustType || null,
      e.value != null ? e.value : null,
      e.newLevel != null ? e.newLevel : null,
      e.previousLevel != null ? e.previousLevel : null,
      JSON.stringify(e.meta || {}),
    ]
  );
}

async function getAdminLogs(limit = 500) {
  const l = Math.min(Math.max(1, limit), 1000);
  const res = await getPool().query(
    `SELECT type, timestamp, actor_username AS "actorUsername", actor_display_name AS "actorDisplayName",
      target_username AS "targetUsername", target_display_name AS "targetDisplayName", role, adjust_type AS "adjustType", value, new_level AS "newLevel", previous_level AS "previousLevel"
     FROM admin_logs ORDER BY id DESC LIMIT $1`,
    [l]
  );
  return res.rows;
}

async function ensureTables() {
  const client = await getPool().connect();
  try {
    await client.query('SELECT 1 FROM users LIMIT 1');
  } catch (err) {
    console.warn('Database tables may not exist. Run scripts/init-db.sql in Supabase SQL Editor.');
  } finally {
    client.release();
  }
}

module.exports = {
  getPool,
  getUserByUsername,
  getUserByProfileSlug,
  saveUser,
  getAllUsers,
  userExists,
  getSession,
  setSession,
  deleteSession,
  getPlinkoStats,
  savePlinkoStats,
  addAdminLog,
  getAdminLogs,
  ensureTables,
};
