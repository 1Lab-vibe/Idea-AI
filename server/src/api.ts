import express from "express";
import { z } from "zod";
import { ensureUser, pool } from "./db.js";

export function createApiRouter() {
  const router = express.Router();

  router.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  router.get("/projects", async (req, res) => {
    const userId = z.string().min(1).safeParse(req.query.userId);
    if (!userId.success) return res.status(400).json({ error: "userId required" });

    await ensureUser(userId.data);
    const { rows } = await pool.query(
      `SELECT
         p.id,
         p.title,
         p.created_at,
         p.updated_at,
         (SELECT COUNT(*)::int FROM thoughts t WHERE t.project_id = p.id) AS thought_count
       FROM projects p
       WHERE p.user_id = $1
       ORDER BY p.updated_at DESC`,
      [userId.data],
    );
    res.json({ projects: rows });
  });

  router.post("/projects", async (req, res) => {
    const Body = z.object({
      userId: z.string().min(1),
      title: z.string().min(1),
    });
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { userId, title } = parsed.data;
    await ensureUser(userId);

    const { rows } = await pool.query(
      `INSERT INTO projects (user_id, title)
       VALUES ($1, $2)
       RETURNING id, title, created_at, updated_at`,
      [userId, title],
    );
    res.json({ project: rows[0] });
  });

  router.patch("/projects/:projectId", async (req, res) => {
    const projectId = z.string().uuid().safeParse(req.params.projectId);
    if (!projectId.success) return res.status(400).json({ error: "projectId invalid" });

    const Body = z.object({
      userId: z.string().min(1),
      title: z.string().min(1),
    });
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { userId, title } = parsed.data;
    await ensureUser(userId);

    const { rows } = await pool.query(
      `UPDATE projects
       SET title = $3, updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING id, title, created_at, updated_at`,
      [projectId.data, userId, title],
    );
    if (!rows[0]) return res.status(404).json({ error: "not found" });
    res.json({ project: rows[0] });
  });

  router.get("/projects/:projectId/thoughts", async (req, res) => {
    const userId = z.string().min(1).safeParse(req.query.userId);
    if (!userId.success) return res.status(400).json({ error: "userId required" });
    const projectId = z.string().uuid().safeParse(req.params.projectId);
    if (!projectId.success) return res.status(400).json({ error: "projectId invalid" });

    await ensureUser(userId.data);
    const { rows } = await pool.query(
      `SELECT id, content, type, source, created_at, voice_file_url, voice_mime_type
       FROM thoughts
       WHERE user_id = $1 AND project_id = $2
       ORDER BY created_at ASC`,
      [userId.data, projectId.data],
    );
    res.json({ thoughts: rows });
  });

  router.post("/projects/:projectId/thoughts", async (req, res) => {
    const projectId = z.string().uuid().safeParse(req.params.projectId);
    if (!projectId.success) return res.status(400).json({ error: "projectId invalid" });

    const Body = z.object({
      userId: z.string().min(1),
      content: z.string().min(1),
      type: z.enum(["TEXT", "VOICE", "FILE"]).default("TEXT"),
      source: z.string().default("web"),
    });
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { userId, content, type, source } = parsed.data;
    await ensureUser(userId);

    const { rows } = await pool.query(
      `INSERT INTO thoughts (user_id, project_id, content, type, source)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, content, type, source, created_at`,
      [userId, projectId.data, content, type, source],
    );

    await pool.query(
      `UPDATE projects SET updated_at = now() WHERE id = $1 AND user_id = $2`,
      [projectId.data, userId],
    );

    res.json({ thought: rows[0] });
  });

  router.post("/thoughts/:thoughtId/copy", async (req, res) => {
    const thoughtId = z.string().uuid().safeParse(req.params.thoughtId);
    if (!thoughtId.success) return res.status(400).json({ error: "thoughtId invalid" });
    const Body = z.object({
      userId: z.string().min(1),
      targetProjectId: z.string().uuid(),
    });
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { userId, targetProjectId } = parsed.data;
    await ensureUser(userId);

    const ownTarget = await pool.query(`SELECT 1 FROM projects WHERE id = $1 AND user_id = $2`, [
      targetProjectId,
      userId,
    ]);
    if (!ownTarget.rows[0]) return res.status(403).json({ error: "forbidden" });

    const src = await pool.query(
      `SELECT content, type, source, telegram_chat_id, telegram_message_id, voice_file_url, voice_mime_type
       FROM thoughts
       WHERE id = $1 AND user_id = $2`,
      [thoughtId.data, userId],
    );
    if (!src.rows[0]) return res.status(404).json({ error: "not found" });

    const t = src.rows[0];
    const inserted = await pool.query(
      `INSERT INTO thoughts
        (user_id, project_id, content, type, source, telegram_chat_id, telegram_message_id, voice_file_url, voice_mime_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, created_at`,
      [
        userId,
        targetProjectId,
        t.content,
        t.type,
        t.source,
        t.telegram_chat_id,
        t.telegram_message_id,
        t.voice_file_url,
        t.voice_mime_type,
      ],
    );
    await pool.query(`UPDATE projects SET updated_at = now() WHERE id = $1 AND user_id = $2`, [
      targetProjectId,
      userId,
    ]);
    res.json({ thought: inserted.rows[0] });
  });

  router.post("/thoughts/:thoughtId/move", async (req, res) => {
    const thoughtId = z.string().uuid().safeParse(req.params.thoughtId);
    if (!thoughtId.success) return res.status(400).json({ error: "thoughtId invalid" });
    const Body = z.object({
      userId: z.string().min(1),
      targetProjectId: z.string().uuid(),
    });
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { userId, targetProjectId } = parsed.data;
    await ensureUser(userId);

    const ownTarget = await pool.query(`SELECT 1 FROM projects WHERE id = $1 AND user_id = $2`, [
      targetProjectId,
      userId,
    ]);
    if (!ownTarget.rows[0]) return res.status(403).json({ error: "forbidden" });

    const moved = await pool.query(
      `UPDATE thoughts
       SET project_id = $3
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [thoughtId.data, userId, targetProjectId],
    );
    if (!moved.rows[0]) return res.status(404).json({ error: "not found" });

    await pool.query(`UPDATE projects SET updated_at = now() WHERE id = $1 AND user_id = $2`, [
      targetProjectId,
      userId,
    ]);

    res.json({ ok: true });
  });

  router.delete("/projects/:projectId/thoughts/:thoughtId", async (req, res) => {
    const userId = z.string().min(1).safeParse(req.query.userId);
    if (!userId.success) return res.status(400).json({ error: "userId required" });
    const projectId = z.string().uuid().safeParse(req.params.projectId);
    if (!projectId.success) return res.status(400).json({ error: "projectId invalid" });
    const thoughtId = z.string().uuid().safeParse(req.params.thoughtId);
    if (!thoughtId.success) return res.status(400).json({ error: "thoughtId invalid" });

    await ensureUser(userId.data);
    await pool.query(
      `DELETE FROM thoughts
       WHERE id = $1 AND user_id = $2 AND project_id = $3`,
      [thoughtId.data, userId.data, projectId.data],
    );
    await pool.query(
      `UPDATE projects SET updated_at = now() WHERE id = $1 AND user_id = $2`,
      [projectId.data, userId.data],
    );
    res.json({ ok: true });
  });

  router.get("/projects/:projectId/telegram-links", async (req, res) => {
    const userId = z.string().min(1).safeParse(req.query.userId);
    if (!userId.success) return res.status(400).json({ error: "userId required" });
    const projectId = z.string().uuid().safeParse(req.params.projectId);
    if (!projectId.success) return res.status(400).json({ error: "projectId invalid" });

    const owner = userId.data;
    await ensureUser(owner);

    // Ensure owner actually owns the project
    const own = await pool.query(`SELECT 1 FROM projects WHERE id = $1 AND user_id = $2`, [projectId.data, owner]);
    if (!own.rows[0]) return res.status(403).json({ error: "forbidden" });

    const { rows } = await pool.query(
      `SELECT chat_id, created_at
       FROM tg_links
       WHERE owner_user_id = $1 AND project_id = $2
       ORDER BY created_at DESC`,
      [owner, projectId.data],
    );
    res.json({ links: rows });
  });

  router.post("/projects/:projectId/telegram-links", async (req, res) => {
    const projectId = z.string().uuid().safeParse(req.params.projectId);
    if (!projectId.success) return res.status(400).json({ error: "projectId invalid" });

    const Body = z.object({
      userId: z.string().min(1),
      chatId: z.coerce.number().int().positive(),
    });
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { userId, chatId } = parsed.data;
    await ensureUser(userId);

    const own = await pool.query(`SELECT 1 FROM projects WHERE id = $1 AND user_id = $2`, [projectId.data, userId]);
    if (!own.rows[0]) return res.status(403).json({ error: "forbidden" });

    await pool.query(
      `INSERT INTO tg_links (chat_id, owner_user_id, project_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (chat_id, owner_user_id, project_id) DO NOTHING`,
      [chatId, userId, projectId.data],
    );

    res.json({ ok: true });
  });

  router.delete("/projects/:projectId/telegram-links/:chatId", async (req, res) => {
    const userId = z.string().min(1).safeParse(req.query.userId);
    if (!userId.success) return res.status(400).json({ error: "userId required" });
    const projectId = z.string().uuid().safeParse(req.params.projectId);
    if (!projectId.success) return res.status(400).json({ error: "projectId invalid" });
    const chatId = z.coerce.number().int().positive().safeParse(req.params.chatId);
    if (!chatId.success) return res.status(400).json({ error: "chatId invalid" });

    const owner = userId.data;
    await ensureUser(owner);

    const own = await pool.query(`SELECT 1 FROM projects WHERE id = $1 AND user_id = $2`, [projectId.data, owner]);
    if (!own.rows[0]) return res.status(403).json({ error: "forbidden" });

    await pool.query(
      `DELETE FROM tg_links
       WHERE chat_id = $1 AND owner_user_id = $2 AND project_id = $3`,
      [chatId.data, owner, projectId.data],
    );
    res.json({ ok: true });
  });

  return router;
}

