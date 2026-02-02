import { pool } from "./db.js";

export async function migrate() {
  // Idempotent migrations for existing volumes
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tg_links (
      chat_id BIGINT NOT NULL,
      owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (chat_id, owner_user_id, project_id)
    );
  `);

  // If tg_links existed with old PK(chat_id), replace PK with composite.
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name = 'tg_links'
          AND constraint_type = 'PRIMARY KEY'
          AND constraint_name = 'tg_links_pkey'
      ) THEN
        BEGIN
          ALTER TABLE tg_links DROP CONSTRAINT tg_links_pkey;
        EXCEPTION WHEN others THEN
          -- ignore
        END;
      END IF;

      BEGIN
        ALTER TABLE tg_links
          ADD CONSTRAINT tg_links_pkey PRIMARY KEY (chat_id, owner_user_id, project_id);
      EXCEPTION WHEN others THEN
        -- already exists or cannot be added; ignore
      END;
    END $$;
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS tg_links_owner_user_id_idx ON tg_links(owner_user_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS tg_links_project_id_idx ON tg_links(project_id);`);
}

