-- Case Battle schema for PostgreSQL (Supabase).
-- Run after init-db.sql.

CREATE TABLE IF NOT EXISTS case_battle_cases (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE,
  rtp_decimal DECIMAL(6,4) NOT NULL,
  price DECIMAL(20,2) NOT NULL,
  expected_value DECIMAL(20,2) NOT NULL,
  created_at BIGINT NOT NULL,
  created_by VARCHAR(255),
  is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS case_battle_items (
  id SERIAL PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES case_battle_cases(id) ON DELETE CASCADE,
  name VARCHAR(255),
  value DECIMAL(20,2) NOT NULL,
  probability DECIMAL(10,6) NOT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_case_battle_items_case_id ON case_battle_items(case_id);

CREATE TABLE IF NOT EXISTS case_battle_battles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  format VARCHAR(50) NOT NULL,
  mode VARCHAR(50) NOT NULL,
  total_pot DECIMAL(20,2) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'waiting',
  server_seed_hex VARCHAR(64),
  client_seed VARCHAR(255),
  nonce INTEGER DEFAULT 0,
  created_at BIGINT NOT NULL,
  started_at BIGINT,
  finished_at BIGINT,
  winner_team_index INTEGER,
  meta JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_case_battle_battles_status ON case_battle_battles(status);
CREATE INDEX IF NOT EXISTS idx_case_battle_battles_created ON case_battle_battles(created_at);

CREATE TABLE IF NOT EXISTS case_battle_battle_cases (
  id SERIAL PRIMARY KEY,
  battle_id UUID NOT NULL REFERENCES case_battle_battles(id) ON DELETE CASCADE,
  case_id INTEGER NOT NULL REFERENCES case_battle_cases(id),
  count INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_case_battle_battle_cases_battle ON case_battle_battle_cases(battle_id);

CREATE TABLE IF NOT EXISTS case_battle_participants (
  id SERIAL PRIMARY KEY,
  battle_id UUID NOT NULL REFERENCES case_battle_battles(id) ON DELETE CASCADE,
  team_index INTEGER NOT NULL,
  slot_index INTEGER NOT NULL,
  username VARCHAR(255) NOT NULL,
  entry_paid DECIMAL(20,2) NOT NULL,
  total_value DECIMAL(20,2) DEFAULT 0,
  terminal_value DECIMAL(20,2) DEFAULT 0,
  payout DECIMAL(20,2) DEFAULT 0,
  joined_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_case_battle_participants_battle ON case_battle_participants(battle_id);

CREATE TABLE IF NOT EXISTS case_battle_rounds (
  id SERIAL PRIMARY KEY,
  battle_id UUID NOT NULL REFERENCES case_battle_battles(id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL REFERENCES case_battle_participants(id) ON DELETE CASCADE,
  case_id INTEGER NOT NULL REFERENCES case_battle_cases(id),
  round_order INTEGER NOT NULL,
  item_id INTEGER REFERENCES case_battle_items(id),
  item_value DECIMAL(20,2) NOT NULL,
  opened_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_case_battle_rounds_battle ON case_battle_rounds(battle_id);
CREATE INDEX IF NOT EXISTS idx_case_battle_rounds_participant ON case_battle_rounds(participant_id);
