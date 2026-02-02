
import React, { useState, useRef, useEffect } from 'react';
import { 
  Send, 
  Loader2, 
  Menu, 
  CreditCard, 
  PlusCircle, 
  Trash2,
  X,
  Settings,
  Zap,
  Layers,
  Bot,
  FileText,
  Clock,
  Edit3,
  Cpu,
  Sparkles,
  RefreshCcw,
  MessageSquare
} from 'lucide-react';
import { Message, Project, SummaryDetailLevel, TelegramConfig, Thought, InputType } from './types';
import { 
  processBotMessage, 
  processBatchAnalysis, 
  generateProjectTitle, 
  classifyThought,
  generateArchitecture,
  generatePrompts
} from './services/geminiService';
import { telegramService } from './services/telegramService';
import { db } from './services/db';
import MarkdownView from './components/MarkdownView';

const App: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showBilling, setShowBilling] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [detailLevel, setDetailLevel] = useState<SummaryDetailLevel>(SummaryDetailLevel.DETAILED);
  const [viewMode, setViewMode] = useState<'stream' | 'chat'>('stream');
  
  const [tgConfig, setTgConfig] = useState<TelegramConfig>(db.getTelegramConfig());

  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const savedProjects = db.getProjects();
    setProjects(savedProjects);
    if (savedProjects.length > 0) {
      handleSelectProject(savedProjects[savedProjects.length - 1].id);
    } else {
      handleNewProject();
    }
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentProjectId, viewMode]);

  // Telegram Intelligent Polling
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
          const chatId = update.message?.chat?.id;
          if (text && chatId) {
            await handleTelegramInput(chatId, text);
          }
        }
        const newConfig = { ...tgConfig, lastUpdateId: maxId };
        setTgConfig(newConfig);
        db.saveTelegramConfig(newConfig);
      }
      if (isMounted) setTimeout(poll, 1500);
    };

    poll();
    return () => { isMounted = false; };
  }, [tgConfig, projects]);

  const handleTelegramInput = async (chatId: number, text: string) => {
    const session = db.getTgSession(chatId);
    const token = tgConfig.token;

    if (text === '/start') {
      await telegramService.sendMessage(token, chatId, "👋 Привет! Я твой AI-Конспектор.\n\nКоманды:\n/list - Список проектов\n/analyze - Анализ текущего проекта\n/arch - Архитектура\n/prompts - Промпты\n/ask [вопрос] - Спросить по проекту");
      return;
    }

    if (text === '/list') {
      const list = projects.map(p => `• ${p.title} (/select_${p.id})`).join('\n');
      await telegramService.sendMessage(token, chatId, list ? `Твои проекты:\n${list}` : "Проектов пока нет.");
      return;
    }

    if (text.startsWith('/select_')) {
      const pid = text.replace('/select_', '');
      const proj = projects.find(p => p.id === pid);
      if (proj) {
        session.activeProjectId = pid;
        db.saveTgSession(chatId, session);
        await telegramService.sendMessage(token, chatId, `Выбран проект: *${proj.title}*`);
      } else {
        await telegramService.sendMessage(token, chatId, "Проект не найден.");
      }
      return;
    }

    if (text === '/analyze' || text === '/arch' || text === '/prompts') {
      const pid = session.activeProjectId;
      if (!pid) {
        await telegramService.sendMessage(token, chatId, "❌ Сначала выбери проект через /list");
        return;
      }
      const project = db.getProject(pid);
      if (!project || project.thoughts.length === 0) {
        await telegramService.sendMessage(token, chatId, "В проекте нет мыслей для анализа.");
        return;
      }
      
      await telegramService.sendMessage(token, chatId, "⏳ Обрабатываю запрос...");
      let result;
      if (text === '/analyze') result = await processBatchAnalysis(project.thoughts.map(t => t.content));
      else if (text === '/arch') result = await generateArchitecture(project.thoughts.map(t => t.content));
      else result = await generatePrompts(project.thoughts.map(t => t.content));

      await telegramService.sendMessage(token, chatId, result.content);
      return;
    }

    if (text.startsWith('/ask ')) {
      const pid = session.activeProjectId;
      if (!pid) {
        await telegramService.sendMessage(token, chatId, "Сначала выбери проект через /list");
        return;
      }
      const question = text.replace('/ask ', '');
      await telegramService.sendMessage(token, chatId, "🤔 Думаю...");
      const history = db.getMessages(pid).map(m => ({ role: m.role, content: m.content }));
      const result = await processBotMessage(question, history);
      await telegramService.sendMessage(token, chatId, result.content);
      return;
    }

    // Автоматическое определение проекта для обычной мысли
    if (!text.startsWith('/')) {
      const classification = await classifyThought(text, projects.map(p => ({ id: p.id, title: p.title })));
      
      if (classification === 'UNCERTAIN') {
        await telegramService.sendMessage(token, chatId, `Я не уверен, к какому проекту относится эта мысль: "${text}"\n\nВыбери проект вручную через /list или пришли /analyze для старта нового.`);
      } else if (classification === 'NEW') {
        const newPid = Date.now().toString();
        const newP: Project = { id: newPid, title: 'Новый (TG)', createdAt: new Date(), updatedAt: new Date(), thoughts: [{ id: '1', content: text, timestamp: new Date(), type: InputType.TEXT }] };
        db.saveProject(newP);
        setProjects(db.getProjects());
        session.activeProjectId = newPid;
        db.saveTgSession(chatId, session);
        await telegramService.sendMessage(token, chatId, `Создал новый проект на основе твоей мысли! (/select_${newPid})`);
      } else {
        const proj = projects.find(p => p.id === classification);
        if (proj) {
          const newThought: Thought = { id: Math.random().toString(36).substr(2, 9), content: text, timestamp: new Date(), type: InputType.TEXT };
          db.addThoughtToProject(classification, newThought);
          setProjects(db.getProjects());
          await telegramService.sendMessage(token, chatId, `✅ Добавил в проект: *${proj.title}*`);
        }
      }
    }
  };

  const handleNewProject = () => {
    const newId = Date.now().toString();
    const newProject: Project = { 
      id: newId, title: 'Новый проект', createdAt: new Date(), updatedAt: new Date(), thoughts: [] 
    };
    db.saveProject(newProject);
    setProjects(prev => [...prev, newProject]);
    setCurrentProjectId(newId);
    setMessages([]);
    setShowHistory(false);
    setViewMode('stream');
  };

  const handleSelectProject = (id: string) => {
    setCurrentProjectId(id);
    setMessages(db.getMessages(id));
    setShowHistory(false);
  };

  const addThought = (content: string) => {
    if (!content.trim()) return;
    const newThought: Thought = {
      id: Math.random().toString(36).substr(2, 9), content, timestamp: new Date(), type: InputType.TEXT
    };
    db.addThoughtToProject(currentProjectId, newThought);
    setProjects(db.getProjects());
    setInputText('');
  };

  const handleRunSpecialAction = async (action: 'analyze' | 'arch' | 'prompts') => {
    const project = db.getProject(currentProjectId);
    if (!project || project.thoughts.length === 0) return;

    setIsProcessing(true);
    try {
      const thoughtTexts = project.thoughts.map(t => t.content);
      let result;
      let isSummary = false;

      if (action === 'analyze') {
        result = await processBatchAnalysis(thoughtTexts, detailLevel);
        isSummary = true;
      } else if (action === 'arch') {
        result = await generateArchitecture(thoughtTexts);
      } else {
        result = await generatePrompts(thoughtTexts);
      }
      
      const assistantMsg: Message = {
        id: Date.now().toString(),
        conversationId: currentProjectId,
        role: 'assistant',
        content: result.content,
        timestamp: new Date(),
        usage: result.usage,
        isSummary
      };

      db.saveMessage(assistantMsg);
      setMessages(prev => [...prev, assistantMsg]);
      
      if (isSummary) {
        let newTitle = project.title;
        const now = new Date();
        const dateStr = `${now.getDate().toString().padStart(2, '0')}.${(now.getMonth() + 1).toString().padStart(2, '0')} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

        if (project.title === 'Новый проект') {
          const generated = await generateProjectTitle(thoughtTexts);
          newTitle = generated;
        } else {
          const baseTitle = project.title.split(' (ред.')[0];
          newTitle = `${baseTitle} (ред. ${dateStr})`;
        }
        project.title = newTitle;
        project.lastSummary = result.content;
        project.updatedAt = now;
        db.saveProject(project);
        setProjects(db.getProjects());
      }
      setViewMode('chat');
    } catch (e) {
      console.error(e);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteThought = (thoughtId: string) => {
    db.deleteThought(currentProjectId, thoughtId);
    setProjects(db.getProjects());
  };

  const handleSubmit = async () => {
    if (!inputText.trim() || isProcessing) return;
    if (inputText.startsWith('/')) {
      if (inputText === '/analyze') { handleRunSpecialAction('analyze'); return; }
      if (inputText === '/arch') { handleRunSpecialAction('arch'); return; }
      if (inputText === '/prompts') { handleRunSpecialAction('prompts'); return; }
      
      setIsProcessing(true);
      const userMsg: Message = { id: Date.now().toString(), conversationId: currentProjectId, role: 'user', content: inputText, timestamp: new Date() };
      db.saveMessage(userMsg);
      setMessages(prev => [...prev, userMsg]);
      setInputText('');

      try {
        const response = await processBotMessage(inputText, messages.map(m => ({ role: m.role, content: m.content })), detailLevel);
        const assistantMsg: Message = {
          id: Date.now().toString(),
          conversationId: currentProjectId,
          role: 'assistant',
          content: response.content,
          timestamp: new Date(),
          usage: response.usage
        };
        db.saveMessage(assistantMsg);
        setMessages(prev => [...prev, assistantMsg]);
        setViewMode('chat');
      } catch (e) { console.error(e); }
      finally { setIsProcessing(false); }
    } else {
      addThought(inputText);
    }
  };

  const currentProject = projects.find(p => p.id === currentProjectId);
  const billingStats = db.getBillingStats();

  return (
    <div className="flex h-screen bg-[#F0F2F5] text-gray-900 font-sans overflow-hidden">
      {/* Sidebar - Projects */}
      <div className={`fixed inset-y-0 left-0 z-40 w-80 bg-white border-r border-gray-200 transform transition-transform duration-300 ease-in-out ${showHistory ? 'translate-x-0' : '-translate-x-full'} md:relative md:translate-x-0`}>
        <div className="flex flex-col h-full">
          <div className="p-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-bold text-lg flex items-center gap-2 text-indigo-600">
              <Bot className="w-6 h-6" /> Потоки
            </h2>
            <button onClick={() => setShowHistory(false)} className="md:hidden"><X /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {projects.slice().reverse().map(p => (
              <button
                key={p.id}
                onClick={() => handleSelectProject(p.id)}
                className={`w-full text-left p-3 rounded-xl transition-all ${currentProjectId === p.id ? 'bg-indigo-50 border border-indigo-100 text-indigo-700 shadow-sm' : 'hover:bg-gray-50 text-gray-600'}`}
              >
                <div className="truncate font-medium">{p.title}</div>
                <div className="flex items-center gap-2 text-[10px] opacity-60 mt-1">
                  <Clock className="w-3 h-3" /> {new Date(p.updatedAt).toLocaleDateString()}
                  <span className="bg-indigo-100 px-1.5 rounded-full text-indigo-600 font-bold">{p.thoughts.length} мыслей</span>
                </div>
              </button>
            ))}
          </div>
          <div className="p-4 border-t border-gray-100 bg-gray-50 flex flex-col gap-2">
            <button onClick={() => setShowSettings(true)} className="w-full py-2 text-sm flex items-center justify-center gap-2 text-gray-500 hover:text-indigo-600 transition-colors">
              <Settings className="w-4 h-4" /> Конфигурация
            </button>
            <button onClick={handleNewProject} className="w-full bg-indigo-600 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 hover:bg-indigo-700 transition-shadow shadow-md">
              <PlusCircle className="w-5 h-5" /> Новый поток
            </button>
          </div>
        </div>
      </div>

      {/* Main Area */}
      <div className="flex-1 flex flex-col relative">
        <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10 shadow-sm">
          <div className="flex items-center gap-3">
            <button onClick={() => setShowHistory(true)} className="md:hidden p-2 hover:bg-gray-100 rounded-lg"><Menu className="w-6 h-6" /></button>
            <div className="overflow-hidden">
              <h1 className="font-bold text-gray-800 truncate max-w-[150px] sm:max-w-[400px]" title={currentProject?.title}>
                {currentProject?.title}
              </h1>
              <div className="flex gap-4 mt-0.5">
                <button 
                  onClick={() => setViewMode('stream')}
                  className={`text-[10px] font-bold uppercase tracking-widest pb-1 border-b-2 transition-all ${viewMode === 'stream' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-400'}`}
                >
                  <Layers className="inline w-3 h-3 mr-1" /> Входящие ({currentProject?.thoughts.length})
                </button>
                <button 
                  onClick={() => setViewMode('chat')}
                  className={`text-[10px] font-bold uppercase tracking-widest pb-1 border-b-2 transition-all ${viewMode === 'chat' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-400'}`}
                >
                  <MessageSquare className="inline w-3 h-3 mr-1" /> Конспекты
                </button>
              </div>
            </div>
          </div>
          <button onClick={() => setShowBilling(true)} className="bg-indigo-50 text-indigo-600 px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-2 border border-indigo-100 shrink-0">
            <CreditCard className="w-4 h-4" /> ${billingStats.totalCost.toFixed(4)}
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#E7EBF0]">
          {viewMode === 'stream' ? (
            <div className="max-w-3xl mx-auto space-y-4 py-6">
              {currentProject?.thoughts.length === 0 ? (
                <div className="text-center py-20 opacity-40">
                  <Edit3 className="w-16 h-16 mx-auto mb-4" />
                  <p className="text-lg font-medium">Поток пуст</p>
                  <p className="text-sm">Записывайте мысли здесь или через Telegram</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
                    <button onClick={() => handleRunSpecialAction('analyze')} disabled={isProcessing} className="bg-indigo-600 text-white p-3 rounded-2xl font-bold text-[10px] uppercase flex items-center justify-center gap-2 shadow-lg hover:scale-105 active:scale-95 transition-all">
                      <Zap className="w-4 h-4" /> Конспект
                    </button>
                    <button onClick={() => handleRunSpecialAction('arch')} disabled={isProcessing} className="bg-indigo-500 text-white p-3 rounded-2xl font-bold text-[10px] uppercase flex items-center justify-center gap-2 shadow-lg hover:scale-105 active:scale-95 transition-all">
                      <Cpu className="w-4 h-4" /> Архитектура
                    </button>
                    <button onClick={() => handleRunSpecialAction('prompts')} disabled={isProcessing} className="bg-indigo-400 text-white p-3 rounded-2xl font-bold text-[10px] uppercase flex items-center justify-center gap-2 shadow-lg hover:scale-105 active:scale-95 transition-all">
                      <Sparkles className="w-4 h-4" /> Промпты
                    </button>
                  </div>
                  {currentProject?.thoughts.map((t) => (
                    <div key={t.id} className="group bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex gap-4 animate-fadeIn">
                      <div className="flex-1">
                        <p className="text-sm text-gray-800 leading-relaxed">{t.content}</p>
                        <p className="text-[10px] text-gray-400 mt-2 font-medium">{new Date(t.timestamp).toLocaleString()}</p>
                      </div>
                      <button onClick={() => handleDeleteThought(t.id)} className="opacity-0 group-hover:opacity-100 p-2 text-red-400 hover:bg-red-50 rounded-lg transition-all">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
          ) : (
            <div className="max-w-4xl mx-auto space-y-4">
              {messages.length === 0 && (
                <div className="text-center py-20 opacity-40">
                  <FileText className="w-16 h-16 mx-auto mb-4" />
                  <p className="text-lg font-medium">История пуста</p>
                  <button onClick={() => setViewMode('stream')} className="text-indigo-600 font-bold text-sm mt-2 underline">Вернитесь к потоку</button>
                </div>
              )}
              {messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[90%] md:max-w-[80%] rounded-2xl p-5 shadow-sm ${msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-800 border border-gray-100'}`}>
                    {msg.isSummary && <div className="text-[8px] font-black uppercase mb-3 bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full inline-block">Итоговый Конспект</div>}
                    <MarkdownView content={msg.content} />
                    <div className={`flex items-center justify-between mt-3 text-[9px] ${msg.role === 'user' ? 'text-indigo-200' : 'text-gray-400'}`}>
                       <span>{new Date(msg.timestamp).toLocaleTimeString()}</span>
                       {msg.usage && <span className="font-mono">${msg.usage.costUsd.toFixed(5)}</span>}
                    </div>
                  </div>
                </div>
              ))}
              {isProcessing && (
                <div className="flex justify-start">
                  <div className="bg-white p-4 rounded-2xl shadow-sm flex items-center gap-3">
                    <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" />
                    <span className="text-xs text-gray-400 font-bold">Обработка...</span>
                  </div>
                </div>
              )}
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Unified Input */}
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
                  placeholder={viewMode === 'stream' ? "Запишите мысль или /analyze..." : "Задайте вопрос по проекту..."}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSubmit())}
                />
              </div>
              <button 
                onClick={handleSubmit} 
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
                <h3 className="text-xl font-bold">Настройки</h3>
              </div>
              <button onClick={() => setShowSettings(false)}><X /></button>
            </div>
            <div className="p-6 space-y-6">
              <div className="bg-indigo-50 p-4 rounded-2xl text-[10px] text-indigo-700 leading-relaxed border border-indigo-100">
                Ключи API подгружаются из .env автоматически.
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase">Telegram Bot Token</label>
                <input type="password" className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none text-sm" placeholder="123456:ABC..." value={tgConfig.token} onChange={(e) => setTgConfig({...tgConfig, token: e.target.value})} />
              </div>
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
                <span className="text-sm font-medium text-gray-700">Telegram мост</span>
                <button onClick={() => setTgConfig({...tgConfig, isActive: !tgConfig.isActive})} className={`w-12 h-6 rounded-full transition-colors relative ${tgConfig.isActive ? 'bg-indigo-600' : 'bg-gray-300'}`}>
                  <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${tgConfig.isActive ? 'left-7' : 'left-1'}`} />
                </button>
              </div>
              <button onClick={() => { db.saveTelegramConfig(tgConfig); setShowSettings(false); }} className="w-full bg-slate-900 text-white font-bold py-4 rounded-xl hover:bg-slate-800 transition-colors">Сохранить</button>
            </div>
          </div>
        </div>
      )}

      {/* Billing Modal */}
      {showBilling && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="p-6 bg-indigo-600 text-white flex justify-between"><h3 className="text-xl font-bold">Биллинг</h3><button onClick={() => setShowBilling(false)}><X /></button></div>
            <div className="p-6 space-y-4">
              <div className="p-4 bg-gray-50 rounded-2xl flex justify-between items-center"><span className="text-sm text-gray-500">Токенов</span><span className="font-bold">{billingStats.totalTokens.toLocaleString()}</span></div>
              <div className="p-4 bg-green-50 rounded-2xl flex justify-between items-center border border-green-100"><span className="text-sm text-green-700">Стоимость</span><span className="font-black text-green-600 text-lg">${billingStats.totalCost.toFixed(5)}</span></div>
              <button onClick={() => { if(confirm('Сбросить базу?')) { db.clearAll(); window.location.reload(); }}} className="w-full text-red-500 py-3 text-xs font-bold hover:bg-red-50 rounded-xl transition-colors"><Trash2 className="inline w-4 h-4 mr-1" /> Сбросить данные</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
