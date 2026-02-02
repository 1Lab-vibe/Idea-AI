
import { Project, Message, BillingEntry, TelegramConfig, Thought } from '../types';

export const db = {
  getProjects: (): Project[] => JSON.parse(localStorage.getItem('projects') || '[]'),
  
  saveProject: (project: Project) => {
    const projects = db.getProjects();
    const idx = projects.findIndex(p => p.id === project.id);
    if (idx > -1) projects[idx] = project;
    else projects.push(project);
    localStorage.setItem('projects', JSON.stringify(projects));
  },

  getProject: (id: string): Project | undefined => {
    return db.getProjects().find(p => p.id === id);
  },

  getMessages: (projectId: string): Message[] => {
    const allMessages: Message[] = JSON.parse(localStorage.getItem('messages') || '[]');
    return allMessages.filter(m => m.conversationId === projectId);
  },

  saveMessage: (msg: Message) => {
    const msgs = JSON.parse(localStorage.getItem('messages') || '[]');
    msgs.push(msg);
    localStorage.setItem('messages', JSON.stringify(msgs));
    if (msg.usage) db.logBilling(msg);
  },

  addThoughtToProject: (projectId: string, thought: Thought) => {
    const project = db.getProject(projectId);
    if (project) {
      project.thoughts.push(thought);
      project.updatedAt = new Date();
      db.saveProject(project);
    }
  },

  deleteThought: (projectId: string, thoughtId: string) => {
    const project = db.getProject(projectId);
    if (project) {
      project.thoughts = project.thoughts.filter(t => t.id !== thoughtId);
      db.saveProject(project);
    }
  },

  logBilling: (msg: Message) => {
    const billing: BillingEntry[] = JSON.parse(localStorage.getItem('billing') || '[]');
    billing.push({
      id: Math.random().toString(36).substr(2, 9),
      userId: 'current-user',
      projectId: msg.conversationId,
      promptTokens: msg.usage?.promptTokens || 0,
      completionTokens: msg.usage?.candidatesTokens || 0,
      totalTokens: msg.usage?.totalTokens || 0,
      costUsd: msg.usage?.costUsd || 0,
      timestamp: new Date()
    });
    localStorage.setItem('billing', JSON.stringify(billing));
  },

  getBillingStats: () => {
    const billing: BillingEntry[] = JSON.parse(localStorage.getItem('billing') || '[]');
    return {
      totalTokens: billing.reduce((sum, b) => sum + b.totalTokens, 0),
      totalCost: billing.reduce((sum, b) => sum + b.costUsd, 0),
      count: billing.length
    };
  },

  getTelegramConfig: (): TelegramConfig => {
    const saved = localStorage.getItem('tg_config');
    const defaultConfig: TelegramConfig = {
      token: (process.env as any).TELEGRAM_BOT_TOKEN || "",
      isActive: !!(process.env as any).TELEGRAM_BOT_TOKEN,
      lastUpdateId: 0
    };
    return saved ? JSON.parse(saved) : defaultConfig;
  },

  saveTelegramConfig: (config: TelegramConfig) => 
    localStorage.setItem('tg_config', JSON.stringify(config)),

  // Сессии Telegram для хранения текущего выбранного проекта в чате
  getTgSession: (chatId: number) => 
    JSON.parse(localStorage.getItem(`tg_session_${chatId}`) || '{"activeProjectId": "", "lastMessage": ""}'),
  
  saveTgSession: (chatId: number, session: any) => 
    localStorage.setItem(`tg_session_${chatId}`, JSON.stringify(session)),

  clearAll: () => localStorage.clear()
};
