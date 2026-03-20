-- Migration: AI-generated music tracks
-- Run this in Supabase SQL Editor (or your Postgres client)
-- Safe to run more than once (IF NOT EXISTS / DO NOTHING guards everywhere)

CREATE TABLE IF NOT EXISTS ai_tracks (
  id             SERIAL  PRIMARY KEY,
  user_id        TEXT    NOT NULL,             -- username of the creator
  task_id        TEXT    UNIQUE NOT NULL,      -- music-generation task ID from provider
  title          TEXT    NOT NULL DEFAULT '',
  style          TEXT    NOT NULL DEFAULT '',
  prompt         TEXT    NOT NULL DEFAULT '',
  audio_url      TEXT,
  image_url      TEXT,
  lyrics         TEXT,                         -- raw; [MM:SS.mm] timestamped or plain text
  suno_clip_id   TEXT,                         -- provider's internal clip ID (used to request video)
  wants_video    BOOLEAN NOT NULL DEFAULT FALSE,
  video_task_id  TEXT    UNIQUE,               -- video-generation task ID from provider
  video_url      TEXT,                         -- final MP4 URL once video job completes
  status         TEXT    NOT NULL DEFAULT 'PENDING',   -- PENDING | COMPLETE | FAILED
  is_published   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     BIGINT  NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

-- Add new columns to existing installations (safe if already present)
DO $$ BEGIN
  ALTER TABLE ai_tracks ADD COLUMN IF NOT EXISTS suno_clip_id  TEXT;
  ALTER TABLE ai_tracks ADD COLUMN IF NOT EXISTS wants_video   BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE ai_tracks ADD COLUMN IF NOT EXISTS video_task_id TEXT;
  ALTER TABLE ai_tracks ADD COLUMN IF NOT EXISTS video_url     TEXT;
  -- Rename kie_task_id → task_id if the old column still exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_tracks' AND column_name = 'kie_task_id'
  ) THEN
    ALTER TABLE ai_tracks RENAME COLUMN kie_task_id TO task_id;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ai_tracks_user_id_idx       ON ai_tracks (user_id);
CREATE INDEX IF NOT EXISTS ai_tracks_task_id_idx       ON ai_tracks (task_id);
CREATE INDEX IF NOT EXISTS ai_tracks_video_task_id_idx ON ai_tracks (video_task_id) WHERE video_task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_tracks_is_published_idx  ON ai_tracks (is_published)  WHERE is_published = TRUE;
