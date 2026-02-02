
export const telegramService = {
  getUpdates: async (token: string, offset: number) => {
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=30`);
      const data = await response.json();
      return data.ok ? data.result : [];
    } catch (e) {
      console.error("TG Update Error:", e);
      return [];
    }
  },

  sendMessage: async (token: string, chatId: number, text: string) => {
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
      });
    } catch (e) {
      console.error("TG Send Error:", e);
    }
  }
};
