
export enum InputType {
  TEXT = 'TEXT',
  VOICE = 'VOICE',
  FILE = 'FILE'
}

export enum SummaryDetailLevel {
  SHORT = 'Коротко',
  DETAILED = 'Подробно',
  TASKS_ONLY = 'Задачи'
}

export interface Usage {
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
  costUsd: number;
  timestamp: Date;
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  usage?: Usage;
  isBatchItem?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  lastSummary?: string;
}

export interface BillingEntry {
  id: string;
  userId: string;
  conversationId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  timestamp: Date;
}

export interface TelegramConfig {
  token: string;
  isActive: boolean;
  lastUpdateId: number;
}
