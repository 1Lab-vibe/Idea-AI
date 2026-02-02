
import React, { useState, useRef, useEffect } from 'react';
import { 
  Send, 
  Loader2, 
  Menu, 
  History, 
  CreditCard, 
  PlusCircle, 
  Trash2,
  X,
  Settings,
  Zap,
  Layers,
  Bot
} from 'lucide-react';
import { Message, Conversation, SummaryDetailLevel, TelegramConfig } from './types';
import { processBotMessage, processBatchAnalysis } from './services/geminiService';
import { telegramService } from './services/telegramService';
import { db } from './services/db';
import MarkdownView from './components/MarkdownView';

const App: React.FC = () => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showBilling, setShowBilling] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [detailLevel, setDetailLevel] = useState<SummaryDetailLevel>(SummaryDetailLevel.DETAILED);
  
  // Batch State
  const [batch, setBatch] = useState<string[]>([]);
  
  // Telegram State
  const [tgConfig, setTgConfig] = useState<TelegramConfig>(db.getTelegramConfig());

  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const savedConvs = db.getConversations();
    setConversations(savedConvs);
    if (savedConvs.length > 0) {
      handleSelectConversation(savedConvs[savedConvs.length - 1].id);
    } else {
      handleNewConversation();
    }
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, batch]);

  // Telegram Polling Effect
  useEffect(() => {
    if (!tgConfig.isActive || !tgConfig.token) return;

    let isMounted = true;
    const poll = async () => {
      const updates = await telegramService.getUpdates(tgConfig.token, tgConfig.lastUpdateId + 1);
      if (!isMounted) return;

      if (updates.length > 0) {
        let maxId = tgConfig.lastUpdateId;
        for (const update of updates) {
          maxId = Math.max(maxId, update.update_id);
          const text = update.message?.text;
          if (text) {
            // Logic to handle message from TG
            if (text === '/analyze') {
              handleAnalyzeBatch();
            } else {
              handleIncomingMessage(text);
            }
          }
        }
        const newConfig = { ...tgConfig, lastUpdateId: maxId };
        setTgConfig(newConfig);
        db.saveTelegramConfig(newConfig);
      }
      if (isMounted) setTimeout(poll, 1000);
    };

    poll();
    return () => { isMounted = false; };
  }, [tgConfig]);

  const handleNewConversation = () => {
    const newId = Date.now().toString();
    const newConv: Conversation = { id: newId, title: 'Новый конспект', createdAt: new Date(), updatedAt: new Date() };
    db.saveConversation(newConv);
    setConversations(prev => [...prev, newConv]);
    setCurrentConvId(newId);
    setMessages([]);
    setBatch([]);
    setShowHistory(false);
  };

  const handleSelectConversation = (id: string) => {
    setCurrentConvId(id);
    setMessages(db.getMessages(id));
    setBatch(db.getBatch(id));
    setShowHistory(false);
  };

  const handleIncomingMessage = (text: string) => {
    if (!text.trim()) return;
    
    // Commands should not be batched
    if (text.startsWith('/')) {
      if (text === '/analyze') {
        handleAnalyzeBatch();
        return;
      }
      handleSubmit(text);
      return;
    }

    // Normal message -> Add to Batch
    const userMsg: Message = {
      id: Date.now().toString(),
      conversationId: currentConvId,
      role: 'user',
      content: text,
      timestamp: new Date(),
      isBatchItem: true
    };
    db.saveMessage(userMsg);
    db.addToBatch(currentConvId, text);
    setMessages(prev => [...prev, userMsg]);
    setBatch(prev => [...prev, text]);
    setInputText('');
  };

  const handleAnalyzeBatch = async () => {
    const currentBatch = db.getBatch(currentConvId);
    if (currentBatch.length === 0) return;

    setIsProcessing(true);
    try {
      const response = await processBatchAnalysis(currentBatch, detailLevel);
      
      const assistantMsg: Message = {
        id: Date.now().toString(),
        conversationId: currentConvId,
        role: 'assistant',
        content: response.content,
        timestamp: new Date(),
        usage: response.usage
      };

      db.saveMessage(assistantMsg);
      setMessages(prev => [...prev, assistantMsg]);
      db.clearBatch(currentConvId);
      setBatch([]);
      
      // Notify Telegram if token exists
      if (tgConfig.token && tgConfig.isActive) {
        // Here we'd ideally have the chatId of the user
        // telegramService.sendMessage(tgConfig.token, chatId, "Конспект готов!");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSubmit = async (text: string = inputText) => {
    if (!text.trim() || isProcessing) return;

    if (text.startsWith('/') || batch.length === 0) {
      // Immediate processing for commands or single questions
      setIsProcessing(true);
      const userMsg: Message = { id: Date.now().toString(), conversationId: currentConvId, role: 'user', content: text, timestamp: new Date() };
      db.saveMessage(userMsg);
      setMessages(prev => [...prev, userMsg]);
      setInputText('');

      try {
        const response = await processBotMessage(text, messages.map(m => ({ role: m.role, content: m.content })), detailLevel);
        const assistantMsg: Message = {
          id: Date.now().toString(),
          conversationId: currentConvId,
          role: 'assistant',
          content: response.content,
          timestamp: new Date(),
          usage: response.usage
        };
        db.saveMessage(assistantMsg);
        setMessages(prev => [...prev, assistantMsg]);
      } catch (e) { console.error(e); }
      finally { setIsProcessing(false); }
    } else {
      handleIncomingMessage(text);
    }
  };

  const billingStats = db.getBillingStats();

  return (
    <div className="flex h-screen bg-[#F0F2F5] text-gray-900 font-sans overflow-hidden">
      
      {/* Sidebar */}
      <div className={`fixed inset-y-0 left-0 z-40 w-80 bg-white border-r border-gray-200 transform transition-transform duration-300 ease-in-out ${showHistory ? 'translate-x-0' : '-translate-x-full'} md:relative md:translate-x-0`}>
        <div className="flex flex-col h-full">
          <div className="p-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-bold text-lg flex items-center gap-2 text-indigo-600">
              <Bot className="w-6 h-6" /> Конспектор
            </h2>
            <button onClick={() => setShowHistory(false)} className="md:hidden"><X /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {conversations.slice().reverse().map(conv => (
              <button
                key={conv.id}
                onClick={() => handleSelectConversation(conv.id)}
                className={`w-full text-left p-3 rounded-xl transition-all ${currentConvId === conv.id ? 'bg-indigo-50 border border-indigo-100 text-indigo-700 shadow-sm' : 'hover:bg-gray-50 text-gray-600'}`}
              >
                <div className="truncate font-medium">{conv.title}</div>
                <div className="text-[10px] opacity-60 mt-1">{new Date(conv.createdAt).toLocaleDateString()}</div>
              </button>
            ))}
          </div>
          <div className="p-4 border-t border-gray-100 bg-gray-50 flex flex-col gap-2">
            <button onClick={() => setShowSettings(true)} className="w-full py-2 text-sm flex items-center justify-center gap-2 text-gray-500 hover:text-indigo-600 transition-colors">
              <Settings className="w-4 h-4" /> Настройки Telegram
            </button>
            <button onClick={handleNewConversation} className="w-full bg-indigo-600 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 hover:bg-indigo-700 transition-shadow shadow-md">
              <PlusCircle className="w-5 h-5" /> Новый чат
            </button>
          </div>
        </div>
      </div>

      {/* Main Area */}
      <div className="flex-1 flex flex-col relative">
        <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10 shadow-sm">
          <div className="flex items-center gap-3">
            <button onClick={() => setShowHistory(true)} className="md:hidden p-2 hover:bg-gray-100 rounded-lg"><Menu className="w-6 h-6" /></button>
            <div>
              <h1 className="font-bold text-gray-800">Интеллект-помощник</h1>
              <p className="text-[10px] text-green-500 font-bold uppercase tracking-widest flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span> {tgConfig.isActive ? 'Telegram Bridge Active' : 'Local Mode'}
              </p>
            </div>
          </div>
          <button onClick={() => setShowBilling(true)} className="bg-indigo-50 text-indigo-600 px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 border border-indigo-100">
            <CreditCard className="w-4 h-4" /> ${billingStats.totalCost.toFixed(4)}
          </button>
        </header>

        {/* Batch Info Banner */}
        {batch.length > 0 && (
          <div className="bg-indigo-600 text-white px-4 py-2 flex items-center justify-between shadow-lg animate-slideDown">
            <div className="flex items-center gap-2 text-sm">
              <Layers className="w-4 h-4" />
              <span>Накоплено мыслей: <strong>{batch.length}</strong></span>
            </div>
            <button 
              onClick={handleAnalyzeBatch}
              disabled={isProcessing}
              className="bg-white text-indigo-600 px-4 py-1.5 rounded-lg text-xs font-black uppercase tracking-tighter hover:bg-indigo-50 flex items-center gap-2 disabled:opacity-50"
            >
              <Zap className="w-4 h-4 fill-indigo-600" /> Анализировать всё
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#E7EBF0]">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[90%] md:max-w-[70%] rounded-2xl p-4 shadow-sm ${msg.role === 'user' ? (msg.isBatchItem ? 'bg-amber-100 text-amber-900 border border-amber-200' : 'bg-indigo-600 text-white') : 'bg-white text-gray-800 border border-gray-100'}`}>
                {msg.isBatchItem && <div className="text-[8px] font-bold uppercase mb-1 opacity-50 flex items-center gap-1"><Layers className="w-2 h-2" /> Мысль в очереди</div>}
                {msg.content.includes('# ') ? <MarkdownView content={msg.content} /> : <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>}
                <div className={`flex items-center justify-between mt-2 text-[9px] ${msg.role === 'user' && !msg.isBatchItem ? 'text-indigo-200' : 'text-gray-400'}`}>
                   <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                   {msg.usage && <span className="font-mono">${msg.usage.costUsd.toFixed(5)}</span>}
                </div>
              </div>
            </div>
          ))}
          {isProcessing && (
            <div className="flex justify-start">
              <div className="bg-white p-4 rounded-2xl shadow-sm flex items-center gap-3">
                <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" />
                <span className="text-xs text-gray-400 font-bold">Нейросеть думает...</span>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 bg-white border-t border-gray-200">
          <div className="max-w-4xl mx-auto space-y-3">
            <div className="flex gap-2">
              {Object.values(SummaryDetailLevel).map(lvl => (
                <button key={lvl} onClick={() => setDetailLevel(lvl)} className={`px-3 py-1 rounded-full text-[10px] font-bold border transition-all ${detailLevel === lvl ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-gray-50 border-gray-200 text-gray-500'}`}>{lvl}</button>
              ))}
            </div>
            <div className="flex items-end gap-2">
              <div className="flex-1 relative bg-slate-900 rounded-2xl border border-slate-700 shadow-inner">
                <textarea
                  className="w-full max-h-40 min-h-[50px] p-4 text-sm bg-transparent text-slate-100 placeholder-slate-500 outline-none resize-none"
                  placeholder={batch.length > 0 ? "Добавьте еще мысль или /analyze..." : "Напишите мысли или команду..."}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSubmit())}
                />
              </div>
              <button 
                onClick={() => handleSubmit()} 
                disabled={!inputText.trim() || isProcessing}
                className="p-4 bg-indigo-600 text-white rounded-2xl hover:bg-indigo-700 transition-all shadow-lg hover:scale-105 active:scale-95 disabled:bg-gray-300 disabled:scale-100"
              >
                <Send className="w-6 h-6" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
          <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-6 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Bot className="w-8 h-8 text-indigo-400" />
                <h3 className="text-xl font-bold">Telegram Bridge</h3>
              </div>
              <button onClick={() => setShowSettings(false)}><X /></button>
            </div>
            <div className="p-6 space-y-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase">Bot API Token</label>
                <input 
                  type="password"
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                  placeholder="123456:ABC-DEF..."
                  value={tgConfig.token}
                  onChange={(e) => setTgConfig({...tgConfig, token: e.target.value})}
                />
              </div>
              <div className="flex items-center justify-between p-4 bg-indigo-50 rounded-2xl border border-indigo-100">
                <span className="text-sm font-medium text-indigo-900">Активность моста</span>
                <button 
                  onClick={() => setTgConfig({...tgConfig, isActive: !tgConfig.isActive})}
                  className={`w-12 h-6 rounded-full transition-colors relative ${tgConfig.isActive ? 'bg-indigo-600' : 'bg-gray-300'}`}
                >
                  <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${tgConfig.isActive ? 'left-7' : 'left-1'}`} />
                </button>
              </div>
              <button 
                onClick={() => { db.saveTelegramConfig(tgConfig); setShowSettings(false); }}
                className="w-full bg-slate-900 text-white font-bold py-4 rounded-xl hover:bg-slate-800 transition-colors"
              >
                Сохранить настройки
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Billing Modal */}
      {showBilling && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="p-6 bg-indigo-600 text-white flex justify-between">
              <h3 className="text-xl font-bold">Финансы</h3>
              <button onClick={() => setShowBilling(false)}><X /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="p-4 bg-gray-50 rounded-2xl flex justify-between items-center">
                <span className="text-sm text-gray-500">Токенов потрачено</span>
                <span className="font-bold">{billingStats.totalTokens.toLocaleString()}</span>
              </div>
              <div className="p-4 bg-green-50 rounded-2xl flex justify-between items-center border border-green-100">
                <span className="text-sm text-green-700">Итого стоимость (USD)</span>
                <span className="font-black text-green-600 text-lg">${billingStats.totalCost.toFixed(5)}</span>
              </div>
              <button onClick={() => { if(confirm('Сбросить базу?')) { db.clearAll(); window.location.reload(); }}} className="w-full text-red-500 py-3 text-xs font-bold hover:bg-red-50 rounded-xl"><Trash2 className="inline w-4 h-4 mr-1" /> Очистить всё</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
