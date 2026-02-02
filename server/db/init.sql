-- Initial schema for Idea-AI (local)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS projects_user_id_idx ON projects(user_id);

CREATE TABLE IF NOT EXISTS thoughts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('TEXT', 'VOICE', 'FILE')),
  source TEXT NOT NULL DEFAULT 'web',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  telegram_chat_id BIGINT NULL,
  telegram_message_id BIGINT NULL,
  voice_file_url TEXT NULL,
  voice_mime_type TEXT NULL
);

CREATE INDEX IF NOT EXISTS thoughts_project_id_idx ON thoughts(project_id);
CREATE INDEX IF NOT EXISTS thoughts_user_id_idx ON thoughts(user_id);
CREATE INDEX IF NOT EXISTS thoughts_created_at_idx ON thoughts(created_at DESC);

CREATE TABLE IF NOT EXISTS tg_sessions (
  chat_id BIGINT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active_project_id UUID NULL REFERENCES projects(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Link multiple Telegram chats into one web user + project
CREATE TABLE IF NOT EXISTS tg_links (
  chat_id BIGINT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, owner_user_id, project_id)
);

CREATE INDEX IF NOT EXISTS tg_links_owner_user_id_idx ON tg_links(owner_user_id);
CREATE INDEX IF NOT EXISTS tg_links_project_id_idx ON tg_links(project_id);

CREATE TABLE IF NOT EXISTS bot_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

