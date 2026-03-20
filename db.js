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
    // Tillat selvsignert cert (f.eks. Supabase pooler fra Render) – passord lagres uansett kun som hash
    pool = new Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
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
    isOwner: !!row.is_owner || row.role === 'owner',
    isAdmin: !!row.is_admin || row.role === 'admin' || row.role === 'owner',
    createdAt: row.created_at != null ? Number(row.created_at) : undefined,
    analyticsStartedAt: row.analytics_started_at != null ? Number(row.analytics_started_at) : undefined,
    gameNet: row.game_net && typeof row.game_net === 'object' ? row.game_net : { click: 0, plinko: 0, roulette: 0, slots: 0 },
    gamePlayCounts: row.game_play_counts && typeof row.game_play_counts === 'object' ? row.game_play_counts : { click: 0, plinko: 0, roulette: 0, slots: 0 },
    xpBySource: row.xp_by_source && typeof row.xp_by_source === 'object' ? row.xp_by_source : { click: 0, plinko: 0, roulette: 0, slots: 0 },
    plinkoRiskLevel: row.plinko_risk_level || 'low',
    plinkoRiskUnlocked: row.plinko_risk_unlocked && typeof row.plinko_risk_unlocked === 'object' ? row.plinko_risk_unlocked : { medium: false, high: false, extreme: false },
    biggestWinMeta: row.biggest_win_meta && typeof row.biggest_win_meta === 'object' ? row.biggest_win_meta : { game: null, betAmount: 0, multiplier: 1, timestamp: 0 },
    chatMutedUntil: row.chat_muted_until != null ? Number(row.chat_muted_until) : null,
    chatRulesAccepted: !!row.chat_rules_accepted,
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
      game_net, game_play_counts, xp_by_source, plinko_risk_level, plinko_risk_unlocked, biggest_win_meta, chat_muted_until, chat_rules_accepted
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28
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
      biggest_win_meta = EXCLUDED.biggest_win_meta,
      chat_muted_until = EXCLUDED.chat_muted_until,
      chat_rules_accepted = EXCLUDED.chat_rules_accepted`,
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
      u.chatMutedUntil != null ? u.chatMutedUntil : null,
      !!u.chatRulesAccepted,
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
  const defaults = { totalBalls: 0, landings: Array(19).fill(0) };
  try {
    const res = await getPool().query('SELECT total_balls, landings FROM plinko_stats WHERE id = 1');
    const row = res.rows[0];
    if (!row) return defaults;
    const landings = Array.isArray(row.landings) ? row.landings : (typeof row.landings === 'object' ? Object.values(row.landings) : []);
    while (landings.length < 19) landings.push(0);
    return {
      totalBalls: Number(row.total_balls ?? 0),
      landings: landings.slice(0, 19).map((n) => Number(n) || 0),
    };
  } catch (err) {
    console.warn('getPlinkoStats failed (kjør scripts/init-db.sql hvis tabeller mangler):', err.message);
    return defaults;
  }
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

function rowToCaseBattleCase(row) {
  if (!row) return null;
  const items = Array.isArray(row.items) ? row.items : (typeof row.items === 'string' ? JSON.parse(row.items || '[]') : []);
  return {
    id: String(row.id),
    name: row.name || '',
    slug: row.slug || '',
    rtpDecimal: Number(row.rtp_decimal ?? 0),
    price: Number(row.price ?? 0),
    expectedValue: Number(row.expected_value ?? 0),
    items,
    createdAt: row.created_at != null ? Number(row.created_at) : Date.now(),
    createdBy: row.created_by || null,
    isActive: row.is_active !== false,
    usageCount: Number(row.usage_count ?? 0),
  };
}

async function getCaseBattleCases() {
  const res = await getPool().query(
    'SELECT id, name, slug, rtp_decimal, price, expected_value, items, created_at, created_by, is_active, usage_count FROM case_battle_cases WHERE is_active = TRUE ORDER BY id'
  );
  return res.rows.map(rowToCaseBattleCase);
}

async function saveCaseBattleCase(doc) {
  const items = Array.isArray(doc.items) ? doc.items : [];
  const slug = (doc.slug || '').trim() || null;
  if (doc.id && /^\d+$/.test(String(doc.id))) {
    await getPool().query(
      `UPDATE case_battle_cases SET name = $1, slug = $2, rtp_decimal = $3, price = $4, expected_value = $5, items = $6, created_by = $7, is_active = $8, usage_count = $9 WHERE id = $10`,
      [
        doc.name || '',
        slug,
        doc.rtpDecimal ?? 0,
        doc.price ?? 0,
        doc.expectedValue ?? 0,
        JSON.stringify(items),
        doc.createdBy || null,
        doc.isActive !== false,
        doc.usageCount ?? 0,
        doc.id,
      ]
    );
    return doc.id;
  }
  const res = await getPool().query(
    `INSERT INTO case_battle_cases (name, slug, rtp_decimal, price, expected_value, items, created_at, created_by, is_active, usage_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [
      doc.name || '',
      slug,
      doc.rtpDecimal ?? 0,
      doc.price ?? 0,
      doc.expectedValue ?? 0,
      JSON.stringify(items),
      doc.createdAt ?? Date.now(),
      doc.createdBy || null,
      doc.isActive !== false,
      doc.usageCount ?? 0,
    ]
  );
  return String(res.rows[0].id);
}

async function updateCaseBattleCaseUsageCount(caseId, usageCount) {
  await getPool().query('UPDATE case_battle_cases SET usage_count = $1 WHERE id = $2', [Number(usageCount) || 0, caseId]);
}

async function getChatMessages(limit = 200) {
  try {
    const l = Math.min(Math.max(1, limit), 500);
    const res = await getPool().query(
      'SELECT id, username, display_name, profile_slug, role, text, time, is_server, challenge_id FROM chat_messages ORDER BY id DESC LIMIT $1',
      [l]
    );
    return res.rows.reverse().map((r) => ({
      username: r.username || null,
      displayName: r.display_name || null,
      profileSlug: r.profile_slug || null,
      role: r.role || null,
      text: r.text || '',
      time: Number(r.time),
      isServer: !!r.is_server,
      challengeId: r.challenge_id || null,
    }));
  } catch (e) {
    console.warn('getChatMessages failed:', e.message);
    return [];
  }
}

async function saveChatMessage(msg) {
  try {
    await getPool().query(
      'INSERT INTO chat_messages (username, display_name, profile_slug, role, text, time, is_server, challenge_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [msg.username || null, msg.displayName || null, msg.profileSlug || null, msg.role || null, msg.text || '', msg.time || Date.now(), !!msg.isServer, msg.challengeId || null]
    );
    // Trim to last 200 rows
    await getPool().query('DELETE FROM chat_messages WHERE id NOT IN (SELECT id FROM chat_messages ORDER BY id DESC LIMIT 200)');
  } catch (e) {
    console.warn('saveChatMessage failed:', e.message);
  }
}

function rowToFeedback(r) {
  return {
    id: String(r.id),
    username: r.username || null,
    discordName: r.discord_name || null,
    submitterUsername: r.submitter_username || null,
    title: r.title || '',
    type: r.type || '',
    description: r.description || '',
    referenceImage: r.reference_image || null,
    status: r.status || 'pending',
    createdAt: Number(r.created_at),
    updatedAt: r.updated_at ? Number(r.updated_at) : null,
  };
}

async function submitFeedback(doc) {
  const res = await getPool().query(
    `INSERT INTO feedbacks (username, discord_name, submitter_username, title, type, description, reference_image, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [doc.username || null, doc.discordName || null, doc.submitterUsername || null, doc.title || '', doc.type || '', doc.description || '', doc.referenceImage || null, doc.status || 'pending', doc.createdAt || Date.now(), doc.updatedAt || null]
  );
  return String(res.rows[0].id);
}

async function getFeedbacks({ status, submitterUsername, limit } = {}) {
  let q = 'SELECT id, username, discord_name, submitter_username, title, type, description, reference_image, status, created_at, updated_at FROM feedbacks';
  const params = [];
  const where = [];
  if (status) {
    if (Array.isArray(status)) {
      where.push(`status = ANY($${params.length + 1})`);
      params.push(status);
    } else {
      where.push(`status = $${params.length + 1}`);
      params.push(status);
    }
  }
  if (submitterUsername) {
    where.push(`submitter_username = $${params.length + 1}`);
    params.push(submitterUsername);
  }
  if (where.length) q += ' WHERE ' + where.join(' AND ');
  q += ' ORDER BY id DESC';
  if (limit) { q += ` LIMIT $${params.length + 1}`; params.push(limit); }
  const res = await getPool().query(q, params);
  return res.rows.map(rowToFeedback);
}

async function updateFeedbackStatus(id, status) {
  await getPool().query('UPDATE feedbacks SET status = $1, updated_at = $2 WHERE id = $3', [status, Date.now(), id]);
}

async function updateChatServerMessage(challengeId, newText) {
  try {
    await getPool().query(
      'UPDATE chat_messages SET text = $1 WHERE challenge_id = $2 AND is_server = TRUE',
      [newText, challengeId]
    );
  } catch (e) {
    console.warn('updateChatServerMessage failed:', e.message);
  }
}

// ── AI Tracks ──────────────────────────────────────────────────────────────

// Columns selected in every AI-track query
const AI_TRACK_COLS = `
  id, user_id, task_id, title, style, prompt,
  audio_url, image_url, lyrics,
  suno_clip_id, wants_video, video_task_id, video_url,
  status, is_published, is_restricted, created_at`;

function rowToAiTrack(r) {
  return {
    id:          String(r.id),
    userId:      r.user_id,
    taskId:      r.task_id,
    title:       r.title       || '',
    style:       r.style       || '',
    prompt:      r.prompt      || '',
    audioUrl:    r.audio_url   || null,
    imageUrl:    r.image_url   || null,
    lyrics:      r.lyrics      || null,
    sunoClipId:  r.suno_clip_id || null,
    wantsVideo:  !!r.wants_video,
    videoTaskId: r.video_task_id || null,
    videoUrl:    r.video_url   || null,
    status:       r.status      || 'PENDING',
    isPublished:  !!r.is_published,
    isRestricted: !!r.is_restricted,
    createdAt:    Number(r.created_at),
  };
}

async function createAiTrack(doc) {
  const res = await getPool().query(
    `INSERT INTO ai_tracks (user_id, task_id, title, style, prompt, wants_video, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7) RETURNING id`,
    [doc.userId, doc.taskId, doc.title || '', doc.style || '', doc.prompt || '',
     !!doc.wantsVideo, Date.now()]
  );
  return String(res.rows[0].id);
}

async function updateAiTrackByTaskId(taskId, updates) {
  const sets = [];
  const vals = [];
  let i = 1;
  if (updates.audioUrl    !== undefined) { sets.push(`audio_url = $${i++}`);    vals.push(updates.audioUrl); }
  if (updates.imageUrl    !== undefined) { sets.push(`image_url = $${i++}`);    vals.push(updates.imageUrl); }
  if (updates.lyrics      !== undefined) { sets.push(`lyrics = $${i++}`);       vals.push(updates.lyrics); }
  if (updates.status      !== undefined) { sets.push(`status = $${i++}`);       vals.push(updates.status); }
  if (updates.title       !== undefined) { sets.push(`title = $${i++}`);        vals.push(updates.title); }
  if (updates.sunoClipId  !== undefined) { sets.push(`suno_clip_id = $${i++}`); vals.push(updates.sunoClipId); }
  if (updates.videoTaskId !== undefined) { sets.push(`video_task_id = $${i++}`);vals.push(updates.videoTaskId); }
  if (updates.videoUrl    !== undefined) { sets.push(`video_url = $${i++}`);    vals.push(updates.videoUrl); }
  if (!sets.length) return;
  vals.push(taskId);
  await getPool().query(
    `UPDATE ai_tracks SET ${sets.join(', ')} WHERE task_id = $${i}`,
    vals
  );
}

async function updateAiTrackByVideoTaskId(videoTaskId, updates) {
  const sets = [];
  const vals = [];
  let i = 1;
  if (updates.videoUrl !== undefined) { sets.push(`video_url = $${i++}`); vals.push(updates.videoUrl); }
  if (updates.status   !== undefined) { sets.push(`status = $${i++}`);    vals.push(updates.status); }
  if (!sets.length) return;
  vals.push(videoTaskId);
  await getPool().query(
    `UPDATE ai_tracks SET ${sets.join(', ')} WHERE video_task_id = $${i}`,
    vals
  );
}

async function getAiTracksByUser(userId) {
  const res = await getPool().query(
    `SELECT ${AI_TRACK_COLS} FROM ai_tracks WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return res.rows.map(rowToAiTrack);
}

async function getPublishedAiTracks() {
  const res = await getPool().query(
    `SELECT ${AI_TRACK_COLS} FROM ai_tracks WHERE is_published = TRUE AND status = 'COMPLETE' ORDER BY created_at DESC`
  );
  return res.rows.map(rowToAiTrack);
}

async function getAiTrackByTaskId(taskId) {
  const res = await getPool().query(
    `SELECT ${AI_TRACK_COLS} FROM ai_tracks WHERE task_id = $1`,
    [taskId]
  );
  return res.rows[0] ? rowToAiTrack(res.rows[0]) : null;
}

async function getAiTrackByVideoTaskId(videoTaskId) {
  const res = await getPool().query(
    `SELECT ${AI_TRACK_COLS} FROM ai_tracks WHERE video_task_id = $1`,
    [videoTaskId]
  );
  return res.rows[0] ? rowToAiTrack(res.rows[0]) : null;
}

async function getAiTrackById(id) {
  const res = await getPool().query(
    `SELECT ${AI_TRACK_COLS} FROM ai_tracks WHERE id = $1`,
    [id]
  );
  return res.rows[0] ? rowToAiTrack(res.rows[0]) : null;
}

async function publishAiTrack(id, userId) {
  const res = await getPool().query(
    `UPDATE ai_tracks SET is_published = TRUE WHERE id = $1 AND user_id = $2 AND is_restricted = FALSE RETURNING id`,
    [id, userId]
  );
  return res.rowCount > 0;
}

async function deleteAiTrack(id) {
  await getPool().query(`DELETE FROM ai_tracks WHERE id = $1`, [id]);
}

async function unpublishAiTrack(id) {
  await getPool().query(
    `UPDATE ai_tracks SET is_published = FALSE, is_restricted = TRUE WHERE id = $1`,
    [id]
  );
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
  getCaseBattleCases,
  saveCaseBattleCase,
  updateCaseBattleCaseUsageCount,
  getChatMessages,
  saveChatMessage,
  updateChatServerMessage,
  submitFeedback,
  getFeedbacks,
  updateFeedbackStatus,
  createAiTrack,
  updateAiTrackByTaskId,
  updateAiTrackByVideoTaskId,
  getAiTracksByUser,
  getPublishedAiTracks,
  getAiTrackByTaskId,
  getAiTrackByVideoTaskId,
  getAiTrackById,
  publishAiTrack,
  deleteAiTrack,
  unpublishAiTrack,
};
