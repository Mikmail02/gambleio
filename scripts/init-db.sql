-- Gambleio database schema for PostgreSQL (Supabase).
-- Run this once in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS users (
  username VARCHAR(255) PRIMARY KEY,
  profile_slug VARCHAR(255),
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(255),
  role VARCHAR(50),
  balance DECIMAL(20,2) DEFAULT 0,
  xp INTEGER DEFAULT 0,
  level INTEGER DEFAULT 1,
  total_clicks BIGINT DEFAULT 0,
  total_bets BIGINT DEFAULT 0,
  total_gambling_wins DECIMAL(20,2) DEFAULT 0,
  total_wins_count INTEGER DEFAULT 0,
  biggest_win_amount DECIMAL(20,2) DEFAULT 0,
  biggest_win_multiplier DECIMAL(10,2) DEFAULT 1,
  total_click_earnings DECIMAL(20,2) DEFAULT 0,
  total_profit_wins DECIMAL(20,2) DEFAULT 0,
  is_owner BOOLEAN DEFAULT FALSE,
  is_admin BOOLEAN DEFAULT FALSE,
  created_at BIGINT,
  analytics_started_at BIGINT,
  game_net JSONB DEFAULT '{}',
  game_play_counts JSONB DEFAULT '{}',
  xp_by_source JSONB DEFAULT '{}',
  plinko_risk_level VARCHAR(50) DEFAULT 'low',
  plinko_risk_unlocked JSONB DEFAULT '{}',
  biggest_win_meta JSONB DEFAULT '{}',
  chat_muted_until BIGINT
);

CREATE TABLE IF NOT EXISTS sessions (
  token VARCHAR(255) PRIMARY KEY,
  user_key VARCHAR(255) NOT NULL,
  created_at BIGINT
);

CREATE TABLE IF NOT EXISTS admin_logs (
  id SERIAL PRIMARY KEY,
  type VARCHAR(50),
  timestamp BIGINT,
  actor_username VARCHAR(255),
  actor_display_name VARCHAR(255),
  target_username VARCHAR(255),
  target_display_name VARCHAR(255),
  role VARCHAR(50),
  adjust_type VARCHAR(50),
  value NUMERIC,
  new_level INTEGER,
  previous_level INTEGER,
  meta JSONB DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS plinko_stats (
  id INTEGER PRIMARY KEY DEFAULT 1,
  total_balls BIGINT DEFAULT 0,
  landings JSONB DEFAULT '[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]',
  CONSTRAINT plinko_single_row CHECK (id = 1)
);

INSERT INTO plinko_stats (id, total_balls, landings) VALUES (1, 0, '[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]')
ON CONFLICT (id) DO NOTHING;

-- Add chat_muted_until if table already existed without it
ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_muted_until BIGINT;
