
import { Conversation, Message, BillingEntry, TelegramConfig } from '../types';

export const db = {
  getConversations: (): Conversation[] => JSON.parse(localStorage.getItem('conversations') || '[]'),
  
  saveConversation: (conv: Conversation) => {
    const convs = db.getConversations();
    const idx = convs.findIndex(c => c.id === conv.id);
    if (idx > -1) convs[idx] = conv;
    else convs.push(conv);
    localStorage.setItem('conversations', JSON.stringify(convs));
  },

  getMessages: (convId: string): Message[] => {
    const allMessages: Message[] = JSON.parse(localStorage.getItem('messages') || '[]');
    return allMessages.filter(m => m.conversationId === convId);
  },

  saveMessage: (msg: Message) => {
    const msgs = JSON.parse(localStorage.getItem('messages') || '[]');
    msgs.push(msg);
    localStorage.setItem('messages', JSON.stringify(msgs));
    if (msg.usage) db.logBilling(msg);
  },

  logBilling: (msg: Message) => {
    const billing: BillingEntry[] = JSON.parse(localStorage.getItem('billing') || '[]');
    billing.push({
      id: Math.random().toString(36).substr(2, 9),
      userId: 'current-user',
      conversationId: msg.conversationId,
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

  getTelegramConfig: (): TelegramConfig => 
    JSON.parse(localStorage.getItem('tg_config') || '{"token": "", "isActive": false, "lastUpdateId": 0}'),

  saveTelegramConfig: (config: TelegramConfig) => 
    localStorage.setItem('tg_config', JSON.stringify(config)),

  getBatch: (convId: string): string[] => 
    JSON.parse(localStorage.getItem(`batch_${convId}`) || '[]'),

  addToBatch: (convId: string, thought: string) => {
    const batch = db.getBatch(convId);
    batch.push(thought);
    localStorage.setItem(`batch_${convId}`, JSON.stringify(batch));
  },

  clearBatch: (convId: string) => localStorage.removeItem(`batch_${convId}`),

  clearAll: () => localStorage.clear()
};
