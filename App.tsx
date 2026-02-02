
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
import { Message, Project, SummaryDetailLevel, Thought, InputType } from './types';
import { 
  processBotMessage, 
  processBatchAnalysis, 
  generateProjectTitle, 
  generateArchitecture,
  generatePrompts
} from './services/geminiService';
import { db } from './services/db';
import MarkdownView from './components/MarkdownView';
import {
  apiAddThought,
  apiCreateProject,
  apiUpdateProjectTitle,
  apiDeleteThought,
  apiGetThoughts,
  apiListProjects,
  apiListTelegramLinks,
  apiAddTelegramLink,
  apiRemoveTelegramLink,
  apiCopyThought,
  apiMoveThought,
  getOrCreateUserId,
  setUserId as persistUserId,
} from './services/apiClient';

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
  const [userId, setUserId] = useState<string>(getOrCreateUserId());
  const [projectTitleDraft, setProjectTitleDraft] = useState<string>('');
  const [tgChatIdDraft, setTgChatIdDraft] = useState<string>('');
  const [tgLinks, setTgLinks] = useState<{ chat_id: number; created_at: string }[]>([]);
  const [transferThoughtId, setTransferThoughtId] = useState<string | null>(null);
  const [transferTargetProjectId, setTransferTargetProjectId] = useState<string>('');

  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    // Primary storage: Postgres via API (fallback to localStorage if API unavailable)
    (async () => {
      try {
        const list = await apiListProjects(userId);
        if (cancelled) return;
        if (list.length === 0) {
          const created = await apiCreateProject(userId, 'Новый проект');
          if (cancelled) return;
          setProjects([created]);
          setCurrentProjectId(created.id);
          await handleSelectProject(created.id, [created]);
        } else {
          setProjects(list);
          setCurrentProjectId(list[0].id);
          await handleSelectProject(list[0].id, list);
        }
      } catch (e) {
        console.error("API unavailable, falling back to local storage:", e);
        const savedProjects = db.getProjects();
        setProjects(savedProjects);
        if (savedProjects.length > 0) {
          handleSelectProject(savedProjects[savedProjects.length - 1].id);
        } else {
          handleNewProject();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentProjectId, viewMode]);

  // Initialize settings form only when opening the modal (avoid overwriting while typing due to auto-refresh)
  useEffect(() => {
    if (!showSettings) return;
    const current = projects.find(p => p.id === currentProjectId);
    setProjectTitleDraft(current?.title || '');
    setTgChatIdDraft('');
    (async () => {
      if (!currentProjectId) return;
      try {
        const links = await apiListTelegramLinks(userId, currentProjectId);
        setTgLinks(links);
      } catch {
        setTgLinks([]);
      }
    })();
    // Intentionally do NOT depend on `projects` to prevent draft resets while editing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSettings, currentProjectId, userId]);

  // Auto-refresh thoughts for current project (to sync Telegram -> browser)
  useEffect(() => {
    let isMounted = true;
    const tick = async () => {
      if (!currentProjectId) return;
      try {
        const thoughts = await apiGetThoughts(userId, currentProjectId);
        if (!isMounted) return;
        setProjects((prev) =>
          prev.map((p) =>
            p.id === currentProjectId ? { ...p, thoughts, thoughtCount: thoughts.length } : p,
          ),
        );
      } catch (e) {
        // ignore; API may be down
      }
    };

    const id = setInterval(tick, 2500);
    tick();
    return () => {
      isMounted = false;
      clearInterval(id);
    };
  }, [currentProjectId, userId]);

  const handleNewProject = async () => {
    try {
      const created = await apiCreateProject(userId, 'Новый проект');
      setProjects((prev) => [created, ...prev]);
      setCurrentProjectId(created.id);
      await handleSelectProject(created.id);
    } catch (e) {
      // fallback local
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
    }
  };

  const handleSelectProject = async (id: string, list?: Project[]) => {
    setCurrentProjectId(id);
    setMessages(db.getMessages(id));
    setShowHistory(false);
    try {
      const thoughts = await apiGetThoughts(userId, id);
      setProjects((prev) => {
        const base = list ?? prev;
        return base.map((p) => (p.id === id ? { ...p, thoughts, thoughtCount: thoughts.length } : p));
      });
    } catch {
      // ignore
    }
  };

  const addThought = async (content: string) => {
    if (!content.trim()) return;
    const trimmed = content.trim();
    try {
      await apiAddThought(userId, currentProjectId, trimmed, InputType.TEXT);
      const thoughts = await apiGetThoughts(userId, currentProjectId);
      setProjects((prev) =>
        prev.map((p) =>
          p.id === currentProjectId ? { ...p, thoughts, thoughtCount: thoughts.length } : p,
        ),
      );
    } catch (e) {
      // fallback local
      const newThought: Thought = {
        id: Math.random().toString(36).substr(2, 9), content: trimmed, timestamp: new Date(), type: InputType.TEXT
      };
      db.addThoughtToProject(currentProjectId, newThought);
      setProjects(db.getProjects());
    } finally {
      setInputText('');
    }
  };

  const handleRunSpecialAction = async (action: 'analyze' | 'arch' | 'prompts') => {
    const project = projects.find(p => p.id === currentProjectId);
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
        // keep local cache updated for chat features; authoritative thoughts live in Postgres
        setProjects(prev => prev.map(p => p.id === project.id ? { ...p, title: newTitle, updatedAt: now } : p));
      }
      setViewMode('chat');
    } catch (e) {
      console.error(e);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteThought = async (thoughtId: string) => {
    try {
      await apiDeleteThought(userId, currentProjectId, thoughtId);
      const thoughts = await apiGetThoughts(userId, currentProjectId);
      setProjects((prev) =>
        prev.map((p) =>
          p.id === currentProjectId ? { ...p, thoughts, thoughtCount: thoughts.length } : p,
        ),
      );
    } catch (e) {
      db.deleteThought(currentProjectId, thoughtId);
      setProjects(db.getProjects());
    }
  };

  const handleRenameProject = async () => {
    if (!currentProjectId || !projectTitleDraft.trim()) return;
    try {
      const updated = await apiUpdateProjectTitle(userId, currentProjectId, projectTitleDraft.trim());
      setProjects(prev => prev.map(p => p.id === currentProjectId ? { ...p, title: updated.title, updatedAt: updated.updatedAt } : p));
    } catch (e) {
      // ignore
    }
  };

  const handleAddChatLink = async () => {
    if (!currentProjectId) return;
    const chatId = Number(tgChatIdDraft.trim());
    if (!Number.isFinite(chatId) || chatId <= 0) return;
    await apiAddTelegramLink(userId, currentProjectId, chatId);
    const links = await apiListTelegramLinks(userId, currentProjectId);
    setTgLinks(links);
    setTgChatIdDraft('');
  };

  const handleRemoveChatLink = async (chatId: number) => {
    if (!currentProjectId) return;
    await apiRemoveTelegramLink(userId, currentProjectId, chatId);
    const links = await apiListTelegramLinks(userId, currentProjectId);
    setTgLinks(links);
  };

  const handleCopyMove = async (mode: 'copy' | 'move') => {
    if (!transferThoughtId || !transferTargetProjectId) return;
    if (mode === 'copy') await apiCopyThought(userId, transferThoughtId, transferTargetProjectId);
    else await apiMoveThought(userId, transferThoughtId, transferTargetProjectId);
    const list = await apiListProjects(userId);
    setProjects(list);
    await handleSelectProject(currentProjectId);
    setTransferThoughtId(null);
    setTransferTargetProjectId('');
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
                  <span className="bg-indigo-100 px-1.5 rounded-full text-indigo-600 font-bold">{(p.thoughtCount ?? p.thoughts.length)} мыслей</span>
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
                      <div className="flex gap-2">
                        <button
                          onClick={() => setTransferThoughtId(t.id)}
                          className="opacity-0 group-hover:opacity-100 p-2 text-gray-400 hover:bg-gray-50 rounded-lg transition-all"
                          title="Копировать/переместить"
                        >
                          <RefreshCcw className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDeleteThought(t.id)} className="opacity-0 group-hover:opacity-100 p-2 text-red-400 hover:bg-red-50 rounded-lg transition-all" title="Удалить">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          ) : (
            <div className="max-w-4xl mx-auto space-y-4">
              {currentProject?.thoughts.length ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sticky top-2 z-10">
                  <button
                    onClick={() => handleRunSpecialAction('analyze')}
                    disabled={isProcessing}
                    className="bg-indigo-600 text-white p-3 rounded-2xl font-bold text-[10px] uppercase flex items-center justify-center gap-2 shadow-lg hover:scale-105 active:scale-95 transition-all"
                  >
                    <Zap className="w-4 h-4" /> Конспект
                  </button>
                  <button
                    onClick={() => handleRunSpecialAction('arch')}
                    disabled={isProcessing}
                    className="bg-indigo-500 text-white p-3 rounded-2xl font-bold text-[10px] uppercase flex items-center justify-center gap-2 shadow-lg hover:scale-105 active:scale-95 transition-all"
                  >
                    <Cpu className="w-4 h-4" /> Архитектура
                  </button>
                  <button
                    onClick={() => handleRunSpecialAction('prompts')}
                    disabled={isProcessing}
                    className="bg-indigo-400 text-white p-3 rounded-2xl font-bold text-[10px] uppercase flex items-center justify-center gap-2 shadow-lg hover:scale-105 active:scale-95 transition-all"
                  >
                    <Sparkles className="w-4 h-4" /> Промпты
                  </button>
                </div>
              ) : null}
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
          <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl max-h-[90vh] flex flex-col">
            <div className="p-6 bg-slate-900 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <Bot className="w-8 h-8 text-indigo-400" />
                <h3 className="text-xl font-bold">Настройки</h3>
              </div>
              <button onClick={() => setShowSettings(false)}><X /></button>
            </div>
            <div className="p-6 space-y-6 overflow-y-auto">
              <div className="bg-indigo-50 p-4 rounded-2xl text-[10px] text-indigo-700 leading-relaxed border border-indigo-100">
                Проекты и мысли синхронизируются через сервер + Postgres. Telegram больше не ходит “из браузера”.
                <br />
                Чтобы привязать Telegram к браузеру: в Telegram-боте отправь <b>/id</b> и вставь полученный <b>userId</b> сюда.
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase">User ID</label>
                <input
                  type="text"
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none text-sm"
                  placeholder="tg:123456789 или web:..."
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                />
                <p className="text-[10px] text-gray-400">
                  Пример: <span className="font-mono">tg:123456789</span> (это chatId). Тогда мысли из Telegram будут появляться в браузере.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase">Название проекта</label>
                <input
                  type="text"
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none text-sm"
                  placeholder="Название"
                  value={projectTitleDraft}
                  onChange={(e) => setProjectTitleDraft(e.target.value)}
                />
                <button
                  onClick={handleRenameProject}
                  className="w-full bg-indigo-600 text-white font-bold py-3 rounded-xl hover:bg-indigo-700 transition-colors"
                >
                  Сохранить название
                </button>
              </div>

              <div className="space-y-3">
                <label className="text-xs font-bold text-gray-400 uppercase">Telegram chat IDs для этого проекта</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    className="flex-1 p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none text-sm"
                    placeholder="123456789"
                    value={tgChatIdDraft}
                    onChange={(e) => setTgChatIdDraft(e.target.value)}
                  />
                  <button
                    onClick={handleAddChatLink}
                    className="px-4 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800 transition-colors"
                  >
                    Добавить
                  </button>
                </div>
                <div className="space-y-2 max-h-40 overflow-auto">
                  {tgLinks.length === 0 ? (
                    <div className="text-[10px] text-gray-400">Пока нет привязанных chatId.</div>
                  ) : (
                    tgLinks.map((l) => (
                      <div key={`${l.chat_id}_${l.created_at}`} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
                        <div className="text-sm font-mono text-gray-700">{l.chat_id}</div>
                        <button
                          onClick={() => handleRemoveChatLink(l.chat_id)}
                          className="text-xs font-bold text-red-500 hover:text-red-600"
                        >
                          Удалить
                        </button>
                      </div>
                    ))
                  )}
                </div>
                <div className="text-[10px] text-gray-400">
                  Если один chatId добавлен в несколько проектов, то каждое сообщение из Telegram будет сохранено во все эти проекты.
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-gray-100 bg-white shrink-0">
              <button
                onClick={() => {
                  persistUserId(userId);
                  setShowSettings(false);
                }}
                className="w-full bg-slate-900 text-white font-bold py-4 rounded-xl hover:bg-slate-800 transition-colors"
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Copy/Move Thought Modal */}
      {transferThoughtId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
          <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-6 bg-slate-900 text-white flex items-center justify-between">
              <h3 className="text-xl font-bold">Копировать / Переместить</h3>
              <button onClick={() => { setTransferThoughtId(null); setTransferTargetProjectId(''); }}><X /></button>
            </div>
            <div className="p-6 space-y-4">
              <label className="text-xs font-bold text-gray-400 uppercase">Целевой проект</label>
              <select
                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none text-sm"
                value={transferTargetProjectId}
                onChange={(e) => setTransferTargetProjectId(e.target.value)}
              >
                <option value="">— выбери проект —</option>
                {projects.filter(p => p.id !== currentProjectId).map(p => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
              <div className="flex gap-2">
                <button
                  onClick={() => handleCopyMove('copy')}
                  disabled={!transferTargetProjectId}
                  className="flex-1 bg-indigo-600 text-white font-bold py-3 rounded-xl hover:bg-indigo-700 disabled:bg-gray-300 transition-colors"
                >
                  Копировать
                </button>
                <button
                  onClick={() => handleCopyMove('move')}
                  disabled={!transferTargetProjectId}
                  className="flex-1 bg-slate-900 text-white font-bold py-3 rounded-xl hover:bg-slate-800 disabled:bg-gray-300 transition-colors"
                >
                  Переместить
                </button>
              </div>
              <div className="text-[10px] text-gray-400">
                “Переместить” удалит мысль из текущего проекта. “Копировать” оставит и тут, и там.
              </div>
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
