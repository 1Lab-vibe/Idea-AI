import fs from "node:fs/promises";
import path from "node:path";

type LogKind = "telegram" | "web";

function logsDir() {
  return path.resolve(process.cwd(), "logs");
}

async function appendLine(kind: LogKind, line: string) {
  const dir = logsDir();
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${kind}.log`);
  await fs.appendFile(file, line + "\n", { encoding: "utf8" });
}

export async function ensureLogFiles() {
  const dir = logsDir();
  await fs.mkdir(dir, { recursive: true });
  await Promise.all(
    (["telegram", "web"] as const).map(async (kind) => {
      const file = path.join(dir, `${kind}.log`);
      try {
        await fs.access(file);
      } catch {
        await fs.writeFile(file, "", { encoding: "utf8" });
      }
    }),
  );
}

function nowIso() {
  return new Date().toISOString();
}

function safeString(v: unknown, maxLen = 5000) {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > maxLen ? s.slice(0, maxLen) + "…(truncated)" : s;
}

export async function logTelegramError(error: unknown, context?: Record<string, unknown>) {
  const msg =
    error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { error: safeString(error) };
  await appendLine(
    "telegram",
    safeString({
      ts: nowIso(),
      level: "error",
      ...msg,
      context,
    }),
  );
}

export async function logWebError(payload: {
  level?: string;
  message: string;
  stack?: string;
  url?: string;
  userAgent?: string;
  userId?: string;
  extra?: unknown;
}) {
  await appendLine(
    "web",
    safeString({
      ts: nowIso(),
      level: payload.level || "error",
      message: payload.message,
      stack: payload.stack,
      url: payload.url,
      userAgent: payload.userAgent,
      userId: payload.userId,
      extra: payload.extra,
    }),
  );
}

