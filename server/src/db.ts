import pg from "pg";
import { getEnv } from "./env.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: getEnv().DATABASE_URL,
});

export async function waitForDbReady(opts?: { retries?: number; delayMs?: number }) {
  const retries = opts?.retries ?? 60;
  const delayMs = opts?.delayMs ?? 1000;
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

export async function ensureUser(userId: string) {
  await pool.query(
    `INSERT INTO users (id) VALUES ($1)
     ON CONFLICT (id) DO NOTHING`,
    [userId],
  );
}

export type ProjectRow = {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type ThoughtRow = {
  id: string;
  user_id: string;
  project_id: string;
  content: string;
  type: "TEXT" | "VOICE" | "FILE";
  source: string;
  created_at: string;
  telegram_chat_id: number | null;
  telegram_message_id: number | null;
  voice_file_url: string | null;
  voice_mime_type: string | null;
};

