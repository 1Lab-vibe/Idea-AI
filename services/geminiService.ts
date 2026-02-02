
import { GoogleGenAI } from "@google/genai";
import { SummaryDetailLevel, Usage } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

const COST_PER_1K_TOKENS = 0.000075;

const BOT_SYSTEM_INSTRUCTION = `
Ты — AI-бот «Конспектор мыслей». 
Твоя задача — профессионально структурировать набор мыслей пользователя.
Пользователь может прислать ОДНУ мысль или ОЧЕРЕДЬ из нескольких мыслей.

ПРАВИЛА:
1. Если пришла очередь мыслей, объедини их логически.
2. Отвечай в стиле Telegram-бота: структурированно, с Markdown.
3. Обязательно выдели Главное, Задачи и Выводы.
`;

const calculateUsage = (response: any): Usage => {
  const metadata = response.usageMetadata || { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 };
  return {
    promptTokens: metadata.promptTokenCount,
    candidatesTokens: metadata.candidatesTokenCount,
    totalTokens: metadata.totalTokenCount,
    costUsd: (metadata.totalTokenCount / 1000) * COST_PER_1K_TOKENS,
    timestamp: new Date()
  };
};

export const generateProjectTitle = async (thoughts: string[]): Promise<string> => {
  const model = 'gemini-3-flash-preview';
  const content = thoughts.join('\n').slice(0, 1000);
  const prompt = `На основе этих мыслей придумай ОЧЕНЬ короткое название проекта (2-3 слова). 
  Ответь ТОЛЬКО названием, без кавычек и лишних слов.\n\nМысли:\n${content}`;

  try {
    const result = await ai.models.generateContent({
      model,
      contents: prompt,
      config: { temperature: 0.5 }
    });
    return result.text?.trim() || "Без названия";
  } catch (e) {
    return "Новый поток";
  }
};

export const classifyThought = async (thought: string, projects: { id: string, title: string }[]): Promise<string | 'UNCERTAIN' | 'NEW'> => {
  if (projects.length === 0) return 'NEW';
  
  const model = 'gemini-3-flash-preview';
  const projectList = projects.map(p => `ID: ${p.id}, Название: ${p.title}`).join('\n');
  const prompt = `
    У пользователя есть список проектов:
    ${projectList}

    Пришла новая мысль: "${thought}"

    Определи, к какому проекту относится эта мысль. 
    Ответь ТОЛЬКО ID проекта. 
    Если мысль не подходит ни к одному проекту явно, ответь UNCERTAIN.
    Если это явно запрос на создание нового направления, ответь NEW.
  `;

  try {
    const result = await ai.models.generateContent({ model, contents: prompt });
    const text = result.text?.trim() || 'UNCERTAIN';
    return text;
  } catch (e) {
    return 'UNCERTAIN';
  }
};

export const generateArchitecture = async (thoughts: string[]) => {
  const model = 'gemini-3-pro-preview'; // Используем Pro для архитектуры
  const content = thoughts.join('\n\n---\n\n');
  const prompt = `Ты — эксперт бизнес-аналитик и AI-архитектор бизнес-процессов.
Действуй постепенно:
1) Проанализируй промт/мысли.
2) На выходе должен получиться понятный "готовый продукт" (сформулируй продукт, ценность, ЦА, ключевые user stories).
3) После анализа и определения продукта — распиши полную структуру и архитектуру создания такого продукта:
   - раздели на 5 этапов (каждый этап может иметь подэтапы)
   - оформи как структурированный текст с логическими и процессными взаимосвязями (что от чего зависит, что чем питается)
   - обязательно учти: Front-end, Back-end, Integrations, Prompts, Data (модели/схемы/хранилища)

Мысли:\n${content}`;

  const response = await ai.models.generateContent({ model, contents: prompt });
  return { content: response.text || "", usage: calculateUsage(response) };
};

export const generatePrompts = async (thoughts: string[]) => {
  const model = 'gemini-3-flash-preview';
  const content = thoughts.join('\n\n---\n\n');
  const prompt = `Ты — профессиональный промпт-инженер.
Задача: по этим мыслям сформировать промпты для реализации продукта по этапам.

Сначала кратко (3-6 пунктов) сформулируй "что за продукт" (если нужно — уточни допущения).
Затем выдай промпты для 5 этапов реализации (по одному большому блоку на этап), так чтобы ими можно было пользоваться в AI Studio или Cursor для написания приложения/скрипта.

Для КАЖДОГО этапа:
- Цель этапа
- Входные данные/зависимости
- Выходные артефакты (файлы/модули/эндпойнты/таблицы/интеграции)
- Подэтапы (чеклист)
- Подробный PROMPT (в кавычках или отдельным блоком), который можно копипастить в AI.
Обязательно покрывай: Front-end, Back-end, Integrations, Prompts, Data.

Мысли:\n${content}`;

  const response = await ai.models.generateContent({ model, contents: prompt });
  return { content: response.text || "", usage: calculateUsage(response) };
};

export const processBatchAnalysis = async (
  thoughts: string[],
  detailLevel: SummaryDetailLevel = SummaryDetailLevel.DETAILED
) => {
  const model = 'gemini-3-flash-preview';
  const localTime = new Date().toLocaleString('ru-RU');
  
  const combinedThoughts = thoughts.map((t, i) => `Мысль №${i + 1}: ${t}`).join('\n\n---\n\n');
  
  const prompt = `
    Текущее время: ${localTime}
    Уровень детализации: ${detailLevel}
    
    ПРОАНАЛИЗИРУЙ СЛЕДУЮЩИЙ НАБОР МЫСЛЕЙ:
    ${combinedThoughts}
  `;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      systemInstruction: BOT_SYSTEM_INSTRUCTION,
      temperature: 0.3,
    }
  });

  return {
    content: response.text || "",
    usage: calculateUsage(response)
  };
};

export const processBotMessage = async (
  message: string,
  history: { role: string, content: string }[],
  detailLevel: SummaryDetailLevel = SummaryDetailLevel.DETAILED
) => {
  const model = 'gemini-3-flash-preview';
  const chat = ai.chats.create({
    model,
    config: {
      systemInstruction: BOT_SYSTEM_INSTRUCTION,
      temperature: 0.3,
    }
  });

  const prompt = message.startsWith('/') 
    ? `Команда: ${message}` 
    : `Вопрос/Мысль: ${message} (Детализация: ${detailLevel})`;

  const result = await chat.sendMessage({ message: prompt });
  
  return {
    content: result.text || "",
    usage: calculateUsage(result)
  };
};
