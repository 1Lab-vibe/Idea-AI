import { GoogleGenAI } from "@google/genai";
import { getEnv } from "./env.js";

const env = getEnv();

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY || "" });

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms),
    ),
  ]);
}

export async function transcribeAudio(params: { audioBase64: string; mimeType: string }) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");

  const { audioBase64, mimeType } = params;

  const response = await withTimeout(
    ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: "Транскрибируй это голосовое сообщение на русском. Верни только текст (без пояснений).",
            },
            {
              inlineData: {
                mimeType,
                data: audioBase64,
              },
            },
          ],
        },
      ],
      config: {
        temperature: 0.0,
      },
    }),
    60000,
    "transcribeAudio",
  );

  return (response.text || "").trim();
}

export type LinkedProjectCandidate = {
  ownerUserId: string;
  projectId: string;
  title: string;
  recentThoughts: string[];
};

export type RouteDecision =
  | { kind: "chosen"; ownerUserId: string; projectId: string; confidence: number }
  | { kind: "uncertain" };

export async function routeLinkedThought(params: {
  messageText: string;
  candidates: LinkedProjectCandidate[];
}): Promise<RouteDecision> {
  if (!env.GEMINI_API_KEY) return { kind: "uncertain" };

  const { messageText, candidates } = params;
  if (candidates.length === 0) return { kind: "uncertain" };
  if (candidates.length === 1) {
    return {
      kind: "chosen",
      ownerUserId: candidates[0].ownerUserId,
      projectId: candidates[0].projectId,
      confidence: 1,
    };
  }

  const payload = candidates.map((c) => ({
    ownerUserId: c.ownerUserId,
    projectId: c.projectId,
    title: c.title,
    recentThoughts: c.recentThoughts.slice(0, 12),
  }));

  const prompt = [
    "Ты — маршрутизатор входящих мыслей в проекты пользователя.",
    "Нужно выбрать ОДИН наиболее подходящий проект из списка кандидатов.",
    "Учитывай: смысл сообщения, тематику проектов, и недавние мысли в каждом проекте.",
    "",
    "Ответь СТРОГО JSON-объектом без пояснений, в формате:",
    '{"ownerUserId":"<ownerUserId>","projectId":"<projectId>","confidence":0.0}',
    "",
    "Если не уверен (confidence < 0.65) — вместо этого ответь:",
    '{"uncertain":true}',
    "",
    "Сообщение:",
    messageText,
    "",
    "Кандидаты (JSON):",
    JSON.stringify(payload),
  ].join("\n");

  const response = await withTimeout(
    ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { temperature: 0.0 },
    }),
    45000,
    "routeLinkedThought",
  );

  const text = (response.text || "").trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { kind: "uncertain" };

  try {
    const obj = JSON.parse(match[0]) as any;
    if (obj?.uncertain) return { kind: "uncertain" };
    const ownerUserId = String(obj.ownerUserId || "");
    const projectId = String(obj.projectId || "");
    const confidence = Number(obj.confidence);
    if (!ownerUserId || !projectId || !Number.isFinite(confidence)) return { kind: "uncertain" };

    const exists = candidates.some((c) => c.ownerUserId === ownerUserId && c.projectId === projectId);
    if (!exists) return { kind: "uncertain" };
    if (confidence < 0.65) return { kind: "uncertain" };

    return { kind: "chosen", ownerUserId, projectId, confidence };
  } catch {
    return { kind: "uncertain" };
  }
}

const BOT_SYSTEM_INSTRUCTION = `
Ты — AI-бот «Конспектор мыслей».
Твоя задача — профессионально структурировать и развивать проекты пользователя.
Отвечай в стиле Telegram-бота: структурированно, с Markdown.
`;

function clampText(s: string, maxChars: number) {
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars) + "\n…(обрезано)";
}

function projectContext(thoughts: string[]) {
  const joined = thoughts.map((t, i) => `Мысль #${i + 1}: ${t}`).join("\n\n");
  return clampText(joined, 12000);
}

export async function analyzeProject(thoughts: string[]) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");
  const ctx = projectContext(thoughts);
  const prompt = `
Проанализируй набор мыслей и сделай конспект.
Структура:
- Главное
- Задачи
- Риски/вопросы
- Следующие шаги

Мысли:
${ctx}
`;
  const response = await withTimeout(
    ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { systemInstruction: BOT_SYSTEM_INSTRUCTION, temperature: 0.3 },
    }),
    90000,
    "analyzeProject",
  );
  return (response.text || "").trim();
}

export async function generateArchitecture(thoughts: string[]) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");
  const ctx = projectContext(thoughts);
  const prompt = `
Проанализируй эти мысли и составь верхнеуровневую АРХИТЕКТУРУ проекта.
Используй блоки:
- Основные модули
- Потоки данных
- Стек технологий (предполагаемый)
- План реализации (MVP)

Мысли:
${ctx}
`;
  const response = await withTimeout(
    ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { systemInstruction: BOT_SYSTEM_INSTRUCTION, temperature: 0.3 },
    }),
    120000,
    "generateArchitecture",
  );
  return (response.text || "").trim();
}

export async function generatePrompts(thoughts: string[]) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");
  const ctx = projectContext(thoughts);
  const prompt = `
На основе этих мыслей создай 5 продвинутых системных промптов (Prompt Engineering),
которые пользователь может использовать в других AI для развития этого проекта.
Напиши краткое пояснение к каждому промпту.

Мысли:
${ctx}
`;
  const response = await withTimeout(
    ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { systemInstruction: BOT_SYSTEM_INSTRUCTION, temperature: 0.3 },
    }),
    90000,
    "generatePrompts",
  );
  return (response.text || "").trim();
}

export async function askProject(thoughts: string[], question: string) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");
  const ctx = projectContext(thoughts);
  const prompt = `
Контекст проекта (мысли):
${ctx}

Вопрос пользователя:
${question}

Ответь кратко, по делу, Markdown. Если контекста не хватает — задай 1 уточняющий вопрос.
`;
  const response = await withTimeout(
    ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { systemInstruction: BOT_SYSTEM_INSTRUCTION, temperature: 0.3 },
    }),
    90000,
    "askProject",
  );
  return (response.text || "").trim();
}

