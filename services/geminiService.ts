
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
