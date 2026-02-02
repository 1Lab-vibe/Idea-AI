
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

export interface Thought {
  id: string;
  content: string;
  timestamp: Date;
  type: InputType;
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  usage?: Usage;
  isSummary?: boolean;
}

export interface Project {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  thoughts: Thought[];
  lastSummary?: string;
}

export interface BillingEntry {
  id: string;
  userId: string;
  projectId: string;
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
