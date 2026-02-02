import { pool, ensureUser } from "./db.js";
import { analyzeProject, askProject, generateArchitecture, generatePrompts, routeLinkedThought, transcribeAudio } from "./gemini.js";
import { logTelegramError } from "./logger.js";

type TgUpdate = any;

// Per-chat queue: prevents long operations (voice/LLM) from blocking polling and keeps replies ordered.
const chatQueues = new Map<number, { tail: Promise<void>; length: number }>();

function enqueueChat(chatId: number, task: () => Promise<void>) {
  const q = chatQueues.get(chatId) ?? { tail: Promise.resolve(), length: 0 };
  q.length += 1;
  const position = q.length;

  const wrapped = async () => {
    try {
      await task();
    } catch (e) {
      await logTelegramError(e, { phase: "queueTask", chat_id: chatId });
    } finally {
      const cur = chatQueues.get(chatId);
      if (cur) {
        cur.length = Math.max(0, cur.length - 1);
        if (cur.length === 0) chatQueues.delete(chatId);
      }
    }
  };

  q.tail = q.tail.then(wrapped, wrapped);
  chatQueues.set(chatId, q);
  return { position };
}

function fetchWithTimeout(url: string, ms: number) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(id));
}

async function getLinksForChat(chatId: number) {
  const { rows } = await pool.query(
    `SELECT l.owner_user_id, l.project_id, p.title
     FROM tg_links l
     JOIN projects p ON p.id = l.project_id
     WHERE l.chat_id = $1
     ORDER BY l.created_at DESC`,
    [chatId],
  );
  return rows as { owner_user_id: string; project_id: string; title: string }[];
}

async function getRecentThoughts(ownerUserId: string, projectId: string) {
  const { rows } = await pool.query(
    `SELECT content
     FROM thoughts
     WHERE user_id = $1 AND project_id = $2
     ORDER BY created_at DESC
     LIMIT 12`,
    [ownerUserId, projectId],
  );
  return rows.map((r) => String(r.content || "")).filter(Boolean);
}

async function getAllThoughts(ownerUserId: string, projectId: string) {
  const { rows } = await pool.query(
    `SELECT content FROM thoughts WHERE user_id = $1 AND project_id = $2 ORDER BY created_at ASC`,
    [ownerUserId, projectId],
  );
  return rows.map((r) => String(r.content || "")).filter(Boolean);
}

function parseProjectPreface(raw: string): { title: string; rest: string } | null {
  // Supports:
  // "проект и Название" \n <text>
  // "проект: Название" \n <text>
  const trimmed = raw.trimStart();
  const m = trimmed.match(/^(проект)\s*(и|:)\s*([^\n\r]+)\s*[\n\r]+([\s\S]*)$/i);
  if (!m) return null;
  const title = m[3].trim();
  const rest = (m[4] || "").trim();
  if (!title) return null;
  return { title, rest };
}

function parseLeadingCommand(raw: string): { cmd: string; arg: string } | null {
  const t = raw.trim();
  if (!t.startsWith("/")) return null;
  const firstSpace = t.indexOf(" ");
  const cmd = (firstSpace === -1 ? t : t.slice(0, firstSpace)).trim();
  const arg = (firstSpace === -1 ? "" : t.slice(firstSpace + 1)).trim();
  return { cmd, arg };
}

async function pickProjectByTitle(
  chatId: number,
  title: string,
): Promise<{ ownerUserId: string; projectId: string; title: string } | null> {
  const links = await getLinksForChat(chatId);
  if (links.length === 0) return null;
  const norm = (s: string) => s.trim().toLowerCase();
  const wanted = norm(title);
  const exact = links.find((l) => norm(l.title) === wanted);
  if (exact) return { ownerUserId: exact.owner_user_id, projectId: exact.project_id, title: exact.title };
  const partial = links.find((l) => norm(l.title).includes(wanted) || wanted.includes(norm(l.title)));
  if (partial) return { ownerUserId: partial.owner_user_id, projectId: partial.project_id, title: partial.title };
  return null;
}

async function getCurrentProjectForChat(chatId: number): Promise<{ ownerUserId: string; projectId: string; title: string } | null> {
  // If linked projects exist, pick by active selection if any, else last thought's project, else first link.
  const links = await getLinksForChat(chatId);
  if (links.length > 0) {
    const last = await getLastThoughtForChat(chatId);
    if (last) {
      const found = links.find((l) => l.project_id === last.projectId && l.owner_user_id === last.ownerUserId);
      if (found) return { ownerUserId: found.owner_user_id, projectId: found.project_id, title: found.title };
    }
    const first = links[0];
    return { ownerUserId: first.owner_user_id, projectId: first.project_id, title: first.title };
  }

  // Non-linked mode: use tg_sessions active project for tg:<chatId>
  const { userId } = await ensureTgSession(chatId);
  const pid = (await getActiveProjectId(chatId)) || (await getInboxProjectId(userId));
  const titleRow = await pool.query(`SELECT title FROM projects WHERE id = $1`, [pid]);
  return { ownerUserId: userId, projectId: pid, title: titleRow.rows[0]?.title || pid };
}

async function setLastThoughtForChat(chatId: number, payload: { ownerUserId: string; projectId: string; thoughtId: string }) {
  await setBotState(`tg:last:${chatId}`, JSON.stringify(payload));
}

async function getLastThoughtForChat(chatId: number): Promise<{ ownerUserId: string; projectId: string; thoughtId: string } | null> {
  const raw = await getBotState(`tg:last:${chatId}`);
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as any;
    const ownerUserId = String(obj.ownerUserId || "");
    const projectId = String(obj.projectId || "");
    const thoughtId = String(obj.thoughtId || "");
    if (!ownerUserId || !projectId || !thoughtId) return null;
    return { ownerUserId, projectId, thoughtId };
  } catch {
    return null;
  }
}

function tgApiBase(token: string) {
  return `https://api.telegram.org/bot${token}`;
}

async function tgCall(token: string, method: string, params?: Record<string, any>) {
  const url = `${tgApiBase(token)}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: params ? JSON.stringify(params) : undefined,
  });
  const json = (await res.json()) as any;
  if (!json.ok) throw new Error(`Telegram API error: ${JSON.stringify(json)}`);
  return json.result;
}

async function tgSendMessage(params: {
  token: string;
  chatId: number;
  text: string;
  replyToMessageId?: number;
  parseMode?: "Markdown" | "HTML";
}) {
  const { token, chatId, text, replyToMessageId, parseMode } = params;
  try {
    await tgCall(token, "sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: parseMode,
      reply_to_message_id: replyToMessageId,
      allow_sending_without_reply: true,
    });
  } catch (e) {
    await logTelegramError(e, {
      phase: "sendMessage",
      chat_id: chatId,
      reply_to_message_id: replyToMessageId,
    });
  }
}

async function tgGetUpdates(token: string, offset: number) {
  const url = `${tgApiBase(token)}/getUpdates?offset=${offset}&timeout=30`;
  const res = await fetch(url);
  const json = (await res.json()) as any;
  if (!json.ok) throw new Error(`Telegram getUpdates error: ${JSON.stringify(json)}`);
  return json.result as TgUpdate[];
}

async function getBotState(key: string): Promise<string | null> {
  const { rows } = await pool.query(`SELECT value FROM bot_state WHERE key = $1`, [key]);
  return rows[0]?.value ?? null;
}

async function setBotState(key: string, value: string) {
  await pool.query(
    `INSERT INTO bot_state (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value],
  );
}

async function ensureTgSession(chatId: number) {
  const userId = `tg:${chatId}`;
  await ensureUser(userId);

  await pool.query(
    `INSERT INTO tg_sessions (chat_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (chat_id) DO UPDATE SET updated_at = now()`,
    [chatId, userId],
  );

  // Ensure inbox project exists
  const { rows } = await pool.query(
    `SELECT id FROM projects WHERE user_id = $1 AND title = $2 LIMIT 1`,
    [userId, "Inbox"],
  );
  if (!rows[0]) {
    await pool.query(`INSERT INTO projects (user_id, title) VALUES ($1, $2)`, [userId, "Inbox"]);
  }

  return { userId };
}

async function getActiveProjectId(chatId: number): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT active_project_id FROM tg_sessions WHERE chat_id = $1`,
    [chatId],
  );
  return rows[0]?.active_project_id ?? null;
}

async function setActiveProjectId(chatId: number, projectId: string | null) {
  await pool.query(
    `UPDATE tg_sessions SET active_project_id = $2, updated_at = now() WHERE chat_id = $1`,
    [chatId, projectId],
  );
}

async function getInboxProjectId(userId: string): Promise<string> {
  const { rows } = await pool.query(
    `SELECT id FROM projects WHERE user_id = $1 AND title = $2 LIMIT 1`,
    [userId, "Inbox"],
  );
  return rows[0].id;
}

async function listProjects(userId: string) {
  const { rows } = await pool.query(
    `SELECT id, title FROM projects WHERE user_id = $1 ORDER BY updated_at DESC`,
    [userId],
  );
  return rows as { id: string; title: string }[];
}

async function addThought(params: {
  userId: string;
  projectId: string;
  content: string;
  type: "TEXT" | "VOICE" | "FILE";
  source: string;
  telegramChatId?: number;
  telegramMessageId?: number;
  voiceFileUrl?: string | null;
  voiceMimeType?: string | null;
}) {
  const {
    userId,
    projectId,
    content,
    type,
    source,
    telegramChatId,
    telegramMessageId,
    voiceFileUrl,
    voiceMimeType,
  } = params;

  const inserted = await pool.query(
    `INSERT INTO thoughts
      (user_id, project_id, content, type, source, telegram_chat_id, telegram_message_id, voice_file_url, voice_mime_type)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      userId,
      projectId,
      content,
      type,
      source,
      telegramChatId ?? null,
      telegramMessageId ?? null,
      voiceFileUrl ?? null,
      voiceMimeType ?? null,
    ],
  );
  await pool.query(`UPDATE projects SET updated_at = now() WHERE id = $1`, [projectId]);
  // Return thought id (best effort) by re-selecting latest row for this telegram message
  if (telegramChatId && telegramMessageId) {
    const { rows } = await pool.query(
      `SELECT id FROM thoughts WHERE telegram_chat_id = $1 AND telegram_message_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [telegramChatId, telegramMessageId],
    );
    return rows[0]?.id as string | undefined;
  }
  return undefined;
}

async function handleTextCommand(token: string, chatId: number, text: string, replyToMessageId?: number) {
  const { userId } = await ensureTgSession(chatId);
  const links = await getLinksForChat(chatId);

  if (text === "/start") {
    await tgSendMessage({
      token,
      chatId,
      replyToMessageId,
      text:
        "👋 Привет! Я твой AI-Конспектор.\n\nКоманды:\n/list — список проектов\n/select_<id> — выбрать проект (для Inbox-режима)\n/analyze — анализ текущего проекта\n/arch — архитектура\n/prompts — промпты\n/ask <вопрос> — спросить по проекту\n/id — показать твой userId для браузера\n\nПодсказка: можно начать сообщение с `проект и <Название>` (с новой строки — текст), чтобы направить мысль сразу в нужный проект.",
    });
    return;
  }

  if (text === "/id") {
    await tgSendMessage({
      token,
      chatId,
      replyToMessageId,
      text: `Твой userId для браузера: \`${userId}\`\n(вставь в настройках веб-приложения)`,
      parseMode: "Markdown",
    });
    return;
  }

  if (text === "/list") {
    if (links.length > 0) {
      const lines = links
        .map((l) => `• ${l.title} — /mv_${l.project_id}` + (links.length > 1 ? ` (owner: ${l.owner_user_id})` : ""))
        .join("\n");
      await tgSendMessage({
        token,
        chatId,
        replyToMessageId,
        text: `Этот Telegram привязан к проектам:\n${lines}\n\nЕсли бот ошибся: /mv_<projectId> переместит ПОСЛЕДНЮЮ мысль.`,
      });
      return;
    }

    const projects = await listProjects(userId);
    const lines = projects.map((p) => `• ${p.title} (/select_${p.id})`).join("\n");
    await tgSendMessage({ token, chatId, replyToMessageId, text: lines || "Проектов пока нет." });
    return;
  }

  if (text === "/analyze" || text === "/arch" || text === "/prompts" || text.startsWith("/ask")) {
    const current = await getCurrentProjectForChat(chatId);
    if (!current) {
      await tgSendMessage({ token, chatId, replyToMessageId, text: "Не нашёл текущий проект. Попробуй /list." });
      return;
    }
    const thoughts = await getAllThoughts(current.ownerUserId, current.projectId);
    if (thoughts.length === 0) {
      await tgSendMessage({ token, chatId, replyToMessageId, text: "В проекте пока нет мыслей." });
      return;
    }

    await tgSendMessage({
      token,
      chatId,
      replyToMessageId,
      text: `⏳ Обрабатываю запрос для проекта: *${current.title}*`,
      parseMode: "Markdown",
    });

    try {
      let out = "";
      if (text === "/analyze") out = await analyzeProject(thoughts);
      else if (text === "/arch") out = await generateArchitecture(thoughts);
      else if (text === "/prompts") out = await generatePrompts(thoughts);
      else {
        const q = text.replace("/ask", "").trim();
        if (!q) {
          await tgSendMessage({ token, chatId, replyToMessageId, text: "Формат: /ask <вопрос>" });
          return;
        }
        out = await askProject(thoughts, q);
      }

      await tgSendMessage({
        token,
        chatId,
        replyToMessageId,
        text: out || "Пустой ответ.",
        parseMode: "Markdown",
      });
    } catch (e) {
      await logTelegramError(e, { phase: "commandError", chat_id: chatId, cmd: text });
      await tgSendMessage({ token, chatId, replyToMessageId, text: "❌ Ошибка при выполнении команды." });
    }
    return;
  }

  if (text.startsWith("/select_")) {
    const pid = text.replace("/select_", "");
    // validate belongs to user
    const { rows } = await pool.query(`SELECT id, title FROM projects WHERE id = $1 AND user_id = $2`, [
      pid,
      userId,
    ]);
    if (!rows[0]) {
      await tgSendMessage({ token, chatId, replyToMessageId, text: "Проект не найден." });
      return;
    }
    await setActiveProjectId(chatId, pid);
    await tgSendMessage({
      token,
      chatId,
      replyToMessageId,
      text: `Выбран проект: *${rows[0].title}*`,
      parseMode: "Markdown",
    });
    return;
  }

  if (text.startsWith("/mv_")) {
    const targetProjectId = text.replace("/mv_", "").trim();
    const last = await getLastThoughtForChat(chatId);
    if (!last) {
      await tgSendMessage({ token, chatId, replyToMessageId, text: "Нет последней мысли для переноса." });
      return;
    }
    // allow move only within linked projects for this chat+owner
    const ok = await pool.query(
      `SELECT 1 FROM tg_links WHERE chat_id = $1 AND owner_user_id = $2 AND project_id = $3`,
      [chatId, last.ownerUserId, targetProjectId],
    );
    if (!ok.rows[0]) {
      await tgSendMessage({
        token,
        chatId,
        replyToMessageId,
        text: "Этот projectId не привязан к этому chatId (или другой владелец). Посмотри /list.",
      });
      return;
    }

    // Move the thought if it belongs to the same owner
    const moved = await pool.query(
      `UPDATE thoughts SET project_id = $3 WHERE id = $1 AND user_id = $2 RETURNING id`,
      [last.thoughtId, last.ownerUserId, targetProjectId],
    );
    if (!moved.rows[0]) {
      await tgSendMessage({ token, chatId, replyToMessageId, text: "Не смог переместить (мысль не найдена)." });
      return;
    }
    await pool.query(`UPDATE projects SET updated_at = now() WHERE id = $1`, [targetProjectId]);
    await setLastThoughtForChat(chatId, { ...last, projectId: targetProjectId });

    const title = await pool.query(`SELECT title FROM projects WHERE id = $1`, [targetProjectId]);
    await tgSendMessage({
      token,
      chatId,
      replyToMessageId,
      text: `✅ Переместил последнюю мысль в проект: ${title.rows[0]?.title || targetProjectId}`,
    });
    return;
  }
}

async function handleTelegramMessage(token: string, update: TgUpdate) {
  const message = update.message;
  if (!message) return;

  const chatId = message.chat?.id;
  if (!chatId) return;

  const text: string | undefined = message.text;
  const messageId: number | undefined = message.message_id;

  // Commands
  if (text?.startsWith("/")) {
    await handleTextCommand(token, chatId, text, messageId);
    return;
  }

  const { userId } = await ensureTgSession(chatId);
  const links = await getLinksForChat(chatId);
  const activeProjectId = (await getActiveProjectId(chatId)) || (await getInboxProjectId(userId));

  if (text && text.trim()) {
    // If message starts with "проект и <Название>" route immediately
    const pref = parseProjectPreface(text);
    if (pref) {
      const chosen = await pickProjectByTitle(chatId, pref.title);
      if (chosen && pref.rest) {
        await ensureUser(chosen.ownerUserId);
        const thoughtId = await addThought({
          userId: chosen.ownerUserId,
          projectId: chosen.projectId,
          content: pref.rest,
          type: "TEXT",
          source: "telegram",
          telegramChatId: chatId,
          telegramMessageId: messageId,
        });
        if (thoughtId) await setLastThoughtForChat(chatId, { ownerUserId: chosen.ownerUserId, projectId: chosen.projectId, thoughtId });
        await tgSendMessage({
          token,
          chatId,
          replyToMessageId: messageId,
          text: `✅ Добавил в проект: *${chosen.title}*`,
          parseMode: "Markdown",
        });
        return;
      }
      // If rest begins with a command, execute it
      const cmd = pref.rest ? parseLeadingCommand(pref.rest) : null;
      if (cmd) {
        await handleTextCommand(token, chatId, cmd.cmd + (cmd.arg ? ` ${cmd.arg}` : ""), messageId);
        return;
      }
      // If not matched, fall back to normal routing with full text
    }

    if (links.length > 0) {
      // If multiple linked projects, route to ONE using Gemini + recent context.
      const candidates = await Promise.all(
        links.map(async (l) => ({
          ownerUserId: l.owner_user_id,
          projectId: l.project_id,
          title: l.title,
          recentThoughts: await getRecentThoughts(l.owner_user_id, l.project_id),
        })),
      );
      const decision = await routeLinkedThought({ messageText: text.trim(), candidates });
      const chosen =
        decision.kind === "chosen"
          ? candidates.find((c) => c.ownerUserId === decision.ownerUserId && c.projectId === decision.projectId)
          : null;
      const fallback = candidates[0];
      const target = chosen || fallback;

      await ensureUser(target.ownerUserId);
      const thoughtId = await addThought({
        userId: target.ownerUserId,
        projectId: target.projectId,
        content: text.trim(),
        type: "TEXT",
        source: "telegram",
        telegramChatId: chatId,
        telegramMessageId: messageId,
      });
      if (thoughtId) await setLastThoughtForChat(chatId, { ownerUserId: target.ownerUserId, projectId: target.projectId, thoughtId });

      if (!chosen) {
        await tgSendMessage({
          token,
          chatId,
          replyToMessageId: messageId,
          text: `🤔 Не уверен куда отнести. Положил в: *${target.title}*.\nЕсли не туда — /mv_${target.projectId} (или выбери другой из /list).`,
          parseMode: "Markdown",
        });
      } else {
        await tgSendMessage({
          token,
          chatId,
          replyToMessageId: messageId,
          text: `✅ Добавил в проект: *${target.title}*`,
          parseMode: "Markdown",
        });
      }
      return;
    }

    const thoughtId = await addThought({
      userId,
      projectId: activeProjectId,
      content: text.trim(),
      type: "TEXT",
      source: "telegram",
      telegramChatId: chatId,
      telegramMessageId: messageId,
    });
    if (thoughtId) await setLastThoughtForChat(chatId, { ownerUserId: userId, projectId: activeProjectId, thoughtId });
    await tgSendMessage({ token, chatId, replyToMessageId: messageId, text: "✅ Добавил мысль." });
    return;
  }

  // Voice message: store placeholder + file URL if possible
  const voice = message.voice;
  if (voice?.file_id) {
    try {
      const file = await tgCall(token, "getFile", { file_id: voice.file_id });
      const filePath = file.file_path as string;
      const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;

      let transcript = "";
      try {
        const audioRes = await fetchWithTimeout(fileUrl, 30000);
        const buf = Buffer.from(await audioRes.arrayBuffer());
        // Keep inline payload reasonable; for larger files consider ai.files upload
        if (buf.length <= 8 * 1024 * 1024) {
          transcript = await transcribeAudio({
            audioBase64: buf.toString("base64"),
            mimeType: "audio/ogg",
          });
        } else {
          await logTelegramError(new Error("voice_too_large_inline"), {
            phase: "voiceDownload",
            chat_id: chatId,
            message_id: messageId,
            bytes: buf.length,
          });
        }
      } catch (e) {
        await logTelegramError(e, {
          phase: "voiceTranscription",
          chat_id: chatId,
          message_id: messageId,
          file_url: fileUrl,
        });
        transcript = "";
      }

      if (!transcript) {
        await logTelegramError(new Error("transcription_empty"), {
          phase: "voiceTranscription",
          chat_id: chatId,
          message_id: messageId,
          file_url: fileUrl,
        });
      }

      // If transcript begins with a command - execute it (voice can trigger menu commands)
      const voiceCmd = transcript ? parseLeadingCommand(transcript) : null;
      if (voiceCmd) {
        await handleTextCommand(token, chatId, voiceCmd.cmd + (voiceCmd.arg ? ` ${voiceCmd.arg}` : ""), messageId);
        return;
      }

      // If transcript begins with "проект и <Название>", prefer direct routing
      const voicePref = transcript ? parseProjectPreface(transcript) : null;
      if (voicePref) {
        const chosen = await pickProjectByTitle(chatId, voicePref.title);
        if (chosen) {
          await ensureUser(chosen.ownerUserId);
          const thoughtId = await addThought({
            userId: chosen.ownerUserId,
            projectId: chosen.projectId,
            content: voicePref.rest || transcript || "[VOICE] (не удалось распознать)",
            type: "VOICE",
            source: "telegram",
            telegramChatId: chatId,
            telegramMessageId: messageId,
            voiceFileUrl: fileUrl,
            voiceMimeType: "audio/ogg",
          });
          if (thoughtId) await setLastThoughtForChat(chatId, { ownerUserId: chosen.ownerUserId, projectId: chosen.projectId, thoughtId });
          await tgSendMessage({
            token,
            chatId,
            replyToMessageId: messageId,
            text: `✅ Добавил голосовое в проект: *${chosen.title}*`,
            parseMode: "Markdown",
          });
          return;
        }
      }

      if (links.length > 0) {
        const textForRouting = transcript || "[VOICE]";
        const candidates = await Promise.all(
          links.map(async (l) => ({
            ownerUserId: l.owner_user_id,
            projectId: l.project_id,
            title: l.title,
            recentThoughts: await getRecentThoughts(l.owner_user_id, l.project_id),
          })),
        );
        const decision = await routeLinkedThought({ messageText: textForRouting, candidates });
        const chosen =
          decision.kind === "chosen"
            ? candidates.find((c) => c.ownerUserId === decision.ownerUserId && c.projectId === decision.projectId)
            : null;
        const fallback = candidates[0];
        const target = chosen || fallback;

        await ensureUser(target.ownerUserId);
        const thoughtId = await addThought({
          userId: target.ownerUserId,
          projectId: target.projectId,
          content: transcript ? transcript : "[VOICE] (не удалось распознать)",
          type: "VOICE",
          source: "telegram",
          telegramChatId: chatId,
          telegramMessageId: messageId,
          voiceFileUrl: fileUrl,
          voiceMimeType: "audio/ogg",
        });
        if (thoughtId) await setLastThoughtForChat(chatId, { ownerUserId: target.ownerUserId, projectId: target.projectId, thoughtId });

        if (!chosen) {
          await tgSendMessage({
            token,
            chatId,
            replyToMessageId: messageId,
            text: `🤔 Не уверен куда отнести голосовое. Положил в: *${target.title}*.\nЕсли не туда — /mv_${target.projectId} (или выбери другой из /list).`,
            parseMode: "Markdown",
          });
        } else {
          await tgSendMessage({
            token,
            chatId,
            replyToMessageId: messageId,
            text: transcript ? `✅ Распознал и добавил в проект: *${target.title}*` : `✅ Сохранил голосовое в проект: *${target.title}*`,
            parseMode: "Markdown",
          });
        }
        return;
      }

      const thoughtId = await addThought({
        userId,
        projectId: activeProjectId,
        content: transcript ? transcript : "[VOICE] (не удалось распознать)",
        type: "VOICE",
        source: "telegram",
        telegramChatId: chatId,
        telegramMessageId: messageId,
        voiceFileUrl: fileUrl,
        voiceMimeType: "audio/ogg",
      });
      if (thoughtId) await setLastThoughtForChat(chatId, { ownerUserId: userId, projectId: activeProjectId, thoughtId });
      await tgSendMessage({
        token,
        chatId,
        replyToMessageId: messageId,
        text: transcript ? "✅ Распознал и добавил голосовое." : "✅ Сохранил голосовое.",
      });
    } catch {
      await tgSendMessage({ token, chatId, replyToMessageId: messageId, text: "❌ Не смог сохранить голосовое." });
    }
  }
}

export async function startTelegramPolling(token: string) {
  const stateKey = "telegram_last_update_id";
  // Ensure long polling works even if a webhook was set earlier.
  try {
    await tgCall(token, "setWebhook", { url: "" });
  } catch {
    // ignore
  }
  const prev = await getBotState(stateKey);
  let offset = prev ? Number(prev) : 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const updates = await tgGetUpdates(token, offset + 1);
      if (updates.length > 0) {
        for (const upd of updates) {
          offset = Math.max(offset, upd.update_id);
          const chatId = upd?.message?.chat?.id;
          if (!chatId) continue;

          // Enqueue processing and continue polling immediately.
          const { position } = enqueueChat(chatId, async () => {
            await handleTelegramMessage(token, upd);
          });

          // Optional quick ACK for backpressure (do not await).
          if (position > 1) {
            void tgSendMessage({
              token,
              chatId,
              replyToMessageId: upd?.message?.message_id,
              text: `⏳ Принял сообщение. В очереди: ${position}.`,
            });
          } else if (upd?.message?.voice?.file_id) {
            void tgSendMessage({
              token,
              chatId,
              replyToMessageId: upd?.message?.message_id,
              text: "⏳ Принял голосовое. Распознаю...",
            });
          }
        }
        await setBotState(stateKey, String(offset));
      }
    } catch (e) {
      await logTelegramError(e, { phase: "pollingLoop" });
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

