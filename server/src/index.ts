import express from "express";
import cors from "cors";
import { getEnv } from "./env.js";
import { createApiRouter } from "./api.js";
import { startTelegramPolling } from "./telegram.js";
import { waitForDbReady } from "./db.js";
import { migrate } from "./migrate.js";
import { ensureLogFiles, logWebError } from "./logger.js";
import { z } from "zod";

const env = getEnv();

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

ensureLogFiles().catch(() => {});

app.post("/api/log/web", async (req, res) => {
  const Body = z.object({
    level: z.string().optional(),
    message: z.string().min(1),
    stack: z.string().optional(),
    url: z.string().optional(),
    userAgent: z.string().optional(),
    userId: z.string().optional(),
    extra: z.unknown().optional(),
  });
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false });
  try {
    await logWebError(parsed.data);
  } catch {
    // ignore
  }
  res.json({ ok: true });
});

app.use("/api", createApiRouter());

app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on :${env.PORT}`);
});

if (env.TELEGRAM_BOT_TOKEN) {
  // eslint-disable-next-line no-console
  console.log("Starting Telegram polling...");
  waitForDbReady()
    .then(async () => {
      await migrate();
      await startTelegramPolling(env.TELEGRAM_BOT_TOKEN!);
    })
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error("DB not ready, Telegram polling disabled:", e);
    });
} else {
  // eslint-disable-next-line no-console
  console.log("TELEGRAM_BOT_TOKEN not set; Telegram polling disabled.");
}

