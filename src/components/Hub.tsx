import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  LayoutGrid, MessageSquarePlus, Send, ArrowLeft, Trash2,
  BookOpen, Lightbulb, Globe, Code2, Bookmark, Utensils, type LucideIcon,
} from 'lucide-react';
import { getTopSites } from '../../shared/frecency';
import type { TileSite } from '../../shared/frecency';
import type { HubChatMessage, HubChatSessionMeta, HubMode } from '../../shared/ipc';
import { markdownComponents } from './aiMarkdown';
import { glassPlate } from '../styles/island';
import DesktopScreen from './desktop/DesktopScreen';
import Notebook from './Notebook';
import GraphCanvas from './GraphCanvas';
import { getSelectedSourceContext, subscribeNotebookSwitch } from '../newtab/notebook';

interface HubProps {
  tabId: string;
  onSubmit: (input: string) => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  // Роль окна: в лёгком окне новая вкладка остаётся плитками — большие режимы (блокнот, граф)
  // обслуживаются службами полного окна.
  isLightWindow?: boolean;
}

// Режим хаба глобальный (живёт в SettingsManager главного процесса), но приезжает сюда
// асинхронным IPC — а Hub размонтируется при уходе с хаба и монтируется заново на КАЖДОЕ
// открытие новой вкладки. Пока ответ в пути, стартовое значение useState рисовалось как
// настоящее: в AI-режиме пользователь на кадр видел минимал-вкладку и только потом блокнот.
// Чром — один долгоживущий рендерер на всё окно, поэтому прочитанный режим переживает смену
// вкладок в обычной модульной переменной: со второго открытия он известен уже к первому кадру.
let cachedHubMode: HubMode | null = null;

export default function Hub({ tabId, onSubmit, onOpenSettings, isLightWindow = false }: HubProps) {
  const [tiles, setTiles] = useState<TileSite[]>([]);
  // null — режим в этом запуске ещё ни разу не отвечал (единственный такой маунт за процесс).
  // Тогда не рисуем ничего: пустой кадр честнее заведомо неверного экрана.
  const [mode, setMode] = useState<HubMode | null>(cachedHubMode);

  useEffect(() => {
    window.oblako.getHistory().then((entries) => {
      setTiles(getTopSites(entries, 8));
    }).catch(() => { /* история недоступна — плитки пустые */ });
  }, []);

  // Персистентный режим Hub (плитки/AI) — тот же приём, что и капсула поисковика в Toolbar.tsx
  // (getSearchEngine/setSearchEngine): источник истины в main (SettingsManager), здесь только
  // читаем и пишем.
  useEffect(() => {
    let mounted = true;
    // Зовём на КАЖДОМ маунте, даже когда режим уже лежит в кэше. Геттер не чистый: этим же
    // вызовом main отличает реальное открытие хаба от восстановления сессии и запускает
    // ленивый прогрев модели (см. SETTINGS_GET_HUB_MODE в main.ts). Срезать вызов ради кэша
    // значило бы тихо выключить прогрев в режиме on-demand.
    window.oblako.getHubMode().then((m) => {
      cachedHubMode = m;
      if (mounted) setMode(m);
    });
    return () => { mounted = false; };
  }, []);

  const pickMode = (m: HubMode) => {
    cachedHubMode = m;
    setMode(m);
    void window.oblako.setHubMode(m);
  };

  // Все хуки выше — ранний выход только после них.
  if (mode === null) return null;
  // ⚠️ Лёгкое окно всегда на плитках, каким бы ни был сохранённый режим: и блокнот, и холст
  // графа обслуживаются службами полного окна (см. WindowRegistry.ts), здесь они показывали бы
  // чужие данные. Настройку при этом не переписываем — полное окно откроется как и раньше.
  const effectiveMode: HubMode = isLightWindow ? 'tiles' : mode;

  return (
    // position:absolute/inset:0 — тот же приём, что у TabError.tsx: родитель (contentRef в
    // App.tsx) сам НЕ display:flex, поэтому flex:1 здесь ничего не даёт (частая ловушка —
    // именно из-за неё раньше не работал внутренний скролл ленты чата: без реальной границы
    // высоты у Hub не было от чего схлопнуться overflowY:auto у транскрипта, контент просто
    // вылезал за пределы contentRef и обрезался самым внешним overflow:hidden в App.tsx).
    // Рабочий стол (mode==='tiles') сам рисует полноэкранный фон и сетку,
    // поэтому её ветка — без внешнего padding/flex-обёртки (иначе фон не дотянулся бы до краёв).
    // AI-режим сохраняет прежнюю обёртку с отступами.
    effectiveMode === 'tiles'
      ? <DesktopScreen
          onSubmit={onSubmit}
          onOpenAi={() => pickMode('ai')}
          onOpenGraph={() => pickMode('graph')}
          tiles={tiles}
          isLightWindow={isLightWindow}
          onOpenApp={(appId) => { void window.oblako.openPanelApp(appId); }}
        />
      : effectiveMode === 'graph'
      ? <GraphCanvas onBack={() => pickMode('tiles')} />
      : (
        // Большой AI-экран как блокнот (NotebookLM-подобный): 3 колонки, центр — существующий чат.
        <Notebook onBack={() => pickMode('tiles')}>
          <AiChatView tabId={tabId} onModeChange={pickMode} onOpenSettings={onOpenSettings} />
        </Notebook>
      )
  );
}

// Экспортирован — переиспользуется в HistoryBookmarks.tsx (переключатель История ⇄ Закладки),
// та же капсула-кнопка, что и здесь у «Обзор/AI». Сам ModeToggle выше — нет, он завязан на
// HubMode (два конкретных значения), под другие пары значений не подходит без переписывания.
export function ModeButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: JSX.Element; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
        border: 'none', borderRadius: 'var(--radius-pill)', cursor: 'default',
        fontSize: 'var(--fs-xs)', fontWeight: 600,
        background: active ? 'var(--surface-solid)' : 'transparent',
        boxShadow: active ? 'var(--shadow-chip)' : 'none',
        color: active ? 'var(--accent)' : 'var(--text-muted)',
      }}
    >
      {icon}{label}
    </button>
  );
}

// ── Режим «Обзор» — плитки популярных сайтов ────────────────────────────────────

// ── Режим «AI» — чат с локальной моделью (см. electron/HubChatManager.ts) ──────

// Заглушки быстрых подсказок (на будущее — меню промптов на манер AI-хаба).
// Просто подставляют текст в поле ввода, реального меню/персонализации пока нет.
const QUICK_PROMPTS: { icon: LucideIcon; text: string }[] = [
  { icon: BookOpen, text: 'Объясни квантовые компьютеры простыми словами' },
  { icon: Lightbulb, text: 'Идеи для стартапа в сфере экологии' },
  { icon: Globe, text: 'Как выучить новый язык быстрее?' },
  { icon: Code2, text: 'Помоги написать код на Python' },
  { icon: Bookmark, text: 'Что почитать из классики?' },
  { icon: Utensils, text: 'Как правильно питаться?' },
];

function AiChatView({ tabId, onModeChange, onOpenSettings }: {
  tabId: string; onModeChange: (m: HubMode) => void; onOpenSettings: () => void;
}) {
  const [sessions, setSessions] = useState<HubChatSessionMeta[]>([]);
  const [messages, setMessages] = useState<HubChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Web-grounding (SearXNG) — та же капсула/поведение, что в aipanel.tsx, но СВОЙ локальный стейт:
  // хаб и AI-панель — разные процессы (Hub рисуется в общем chrome-webContents, панель — в своей
  // WebContentsView), общей памяти между ними нет физически. Статус конфига читаем напрямую через
  // window.oblako (Hub уже в том же renderer, что Settings.tsx — не нужен отдельный preload-мост,
  // как у панели). Консент — каждый раз при OFF→ON, без «запомнить» (тот же принцип, что в панели).
  const [webGroundingActive, setWebGroundingActive] = useState(false);
  const [searxngConfigured, setSearxngConfigured] = useState(false);
  const [showWebGroundingConfirm, setShowWebGroundingConfirm] = useState(false);
  const [webSearching, setWebSearching] = useState(false);

  const refreshSessions = () => {
    window.oblako.listHubChatSessions().then(setSessions).catch(() => { /* без персистентности — список пуст */ });
  };

  const deleteSession = (id: number, e: React.MouseEvent) => {
    e.stopPropagation(); // не открывать чат при клике на «удалить»
    void window.oblako.deleteHubChatSession(id).then(refreshSessions);
  };

  useEffect(refreshSessions, []);

  useEffect(() => {
    let mounted = true;
    window.oblako.getSearxngStatus().then((v) => { if (mounted) setSearxngConfigured(v); });
    const unsub = window.oblako.onSearxngStatusChanged((v) => { if (mounted) setSearxngConfigured(v); });
    return () => { mounted = false; unsub(); };
  }, []);

  // Стриминг ответа — чанки и финальный результат маршрутизируются по tabId (main шлёт их всем
  // Hub-вкладкам разом через chromeView.webContents, т.к. Hub — не отдельная WebContentsView).
  useEffect(() => {
    const unsubChunk = window.oblako.onHubChatChunk((payload) => {
      if (payload.tabId !== tabId) return;
      setWebSearching(false);
      setStreamText((prev) => prev + payload.text);
    });
    const unsubResult = window.oblako.onHubChatResult((payload) => {
      if (payload.tabId !== tabId) return;
      setStreaming(false);
      setWebSearching(false);
      setStreamText('');
      if (payload.outcome.ok) {
        const out = payload.outcome.out;
        setMessages((prev) => [...prev, { role: 'assistant', text: out, createdAt: Date.now() }]);
        setSessionId(payload.sessionId);
        setError(null);
        refreshSessions();
      } else {
        setError(payload.outcome.error);
      }
    });
    return () => { unsubChunk(); unsubResult(); };
  }, [tabId]);

  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streamText]);

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    setMessages((prev) => [...prev, { role: 'user', text: trimmed, createdAt: Date.now() }]);
    setInput('');
    setStreaming(true);
    setStreamText('');
    setError(null);
    setWebSearching(webGroundingActive);
    // Заземление на источники блокнота: если web-поиск выключен, подмешиваем текст выбранных
    // источников (см. src/newtab/notebook.ts::getSelectedSourceContext). Web-grounding имеет приоритет.
    const sourcesContext = webGroundingActive ? undefined : (getSelectedSourceContext() ?? undefined);
    window.oblako.sendHubChatMessage(tabId, trimmed, webGroundingActive, sourcesContext);
  };

  // Глобус — тот же контур, что в aipanel.tsx: не настроено → в настройки, ничего не включаем;
  // выключен → плашка согласия (каждый раз, без «запомнить»); включён → гасим молча.
  const handleGlobeClick = () => {
    if (!searxngConfigured) { onOpenSettings(); return; }
    if (webGroundingActive) { setWebGroundingActive(false); return; }
    setShowWebGroundingConfirm(true);
  };
  const confirmWebGrounding = () => {
    setShowWebGroundingConfirm(false);
    setWebGroundingActive(true);
  };

  const newChat = () => {
    void window.oblako.newHubChatSession(tabId);
    setMessages([]);
    setSessionId(null);
    setStreamText('');
    setStreaming(false);
    setError(null);
    textareaRef.current?.focus();
  };

  // ⚠️ Смена блокнота ОБЯЗАНА начинать новую беседу. Иначе ответы по прошлой теме остаются
  // висеть под новыми источниками и читаются как ответы по ним — а это худший вид вранья,
  // потому что выглядит правдоподобно (см. src/newtab/notebook.ts::subscribeNotebookSwitch).
  useEffect(() => subscribeNotebookSwitch(() => { newChat(); }), []);

  const openSession = (id: number) => {
    if (streaming || id === sessionId) return;
    void window.oblako.resumeHubChatSession(tabId, id).then((msgs) => {
      setMessages(msgs);
      setSessionId(id);
      setStreamText('');
      setError(null);
    });
  };

  const pickPrompt = (text: string) => {
    setInput(text);
    textareaRef.current?.focus();
  };

  const hasConversation = messages.length > 0 || streaming;

  // Верхняя панель: заголовок / «назад к списку» + кнопка «Обзор» (замена ползунка режимов).
  const topBar = (
    <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
      {hasConversation ? (
        <button
          onClick={newChat}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px',
            border: 'none', borderRadius: 'var(--radius-pill)', cursor: 'default',
            fontSize: 'var(--fs-xs)', fontWeight: 600, background: 'transparent', color: 'var(--text-muted)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-strong)'; e.currentTarget.style.background = 'var(--surface-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent'; }}
        >
          <ArrowLeft size={14} /> Назад к списку
        </button>
      ) : (
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text-strong)' }}>Спросите что угодно</div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>Отвечает локальная модель, без интернета</div>
        </div>
      )}
      {hasConversation && <div style={{ flex: 1 }} />}
      <button
        onClick={() => onModeChange('tiles')}
        title="К обзору"
        style={{
          flex: 'none', display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px',
          border: 'none', borderRadius: 'var(--radius-pill)', cursor: 'default',
          fontSize: 'var(--fs-xs)', fontWeight: 600, background: 'var(--surface-sunken)', color: 'var(--text-body)',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface-sunken)'; }}
      >
        <LayoutGrid size={14} /> Обзор
      </button>
    </div>
  );

  const promptsBlock = (
    <div style={{ flex: 'none', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
      {QUICK_PROMPTS.map((p) => (
        <QuickPromptChip key={p.text} icon={p.icon} text={p.text} onClick={() => pickPrompt(p.text)} />
      ))}
    </div>
  );

  // Недавние запросы — под вводом (в потоке), у каждого кнопка удаления. Скроллится вся панель
  // целиком (см. корневой контейнер empty-state ниже), а не отдельная область списка.
  const recentChats = sessions.length > 0 && (
    <div style={{ flex: 'none' }}>
      <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--text-faint)', marginBottom: 8 }}>
        Недавние запросы
      </div>
      <div style={{
        background: 'var(--surface-solid)', borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--shadow-card)', border: '1px solid var(--glass-edge)', overflow: 'hidden',
      }}>
        {sessions.map((s, i) => (
          <div
            key={s.id}
            onClick={() => openSession(s.id)}
            style={{
              display: 'flex', width: '100%', alignItems: 'center', gap: 8,
              padding: '10px 14px', cursor: 'default',
              borderTop: i === 0 ? 'none' : '1px solid var(--glass-edge)',
              color: 'var(--text-body)', fontSize: 'var(--fs-sm)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {s.title || 'Без названия'}
            </span>
            <span style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-xs)', flex: 'none' }}>
              {formatSessionTime(s.updatedAt)}
            </span>
            <button
              onClick={(e) => deleteSession(s.id, e)}
              title="Удалить чат"
              style={{
                flex: 'none', border: 'none', background: 'transparent', cursor: 'default',
                padding: 4, borderRadius: 'var(--radius-sm)', color: 'var(--text-faint)', display: 'inline-flex',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--danger-500)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-faint)'; }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );

  const errorBlock = error && (
    <div style={{ flex: 'none', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', padding: '0 4px' }}>
      Ошибка: {error}
    </div>
  );

  // Плашка согласия на web-grounding — та же механика/текст, что в aipanel.tsx.
  const consentBlock = showWebGroundingConfirm && (
    <div style={{
      flex: 'none', display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px',
      borderRadius: 'var(--radius-chip)', background: 'var(--surface-sunken)',
    }}>
      <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-body)', lineHeight: 'var(--lh-body)' }}>
        Запросы поиска будут отправлены на твой поисковый сервер через VPN.
      </span>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button onClick={() => setShowWebGroundingConfirm(false)} style={{ padding: '5px 12px', borderRadius: 'var(--radius-chip)', border: 'none', background: 'transparent', color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', fontWeight: 500, cursor: 'pointer' }}>Отмена</button>
        <button onClick={confirmWebGrounding} style={{ padding: '5px 12px', borderRadius: 'var(--radius-chip)', border: 'none', background: 'var(--accent)', color: 'var(--on-accent)', fontSize: 'var(--fs-xs)', fontWeight: 600, cursor: 'pointer' }}>Продолжить</button>
      </div>
    </div>
  );

  const inputRow = (
    <div style={{
      flex: 'none', display: 'flex', alignItems: 'flex-end', gap: 8, padding: '12px 14px',
      background: 'var(--surface-solid)', borderRadius: 'var(--radius-island)',
      boxShadow: 'var(--shadow-card)', border: '1px solid var(--glass-edge)',
    }}>
      <button
        onClick={handleGlobeClick}
        title={!searxngConfigured ? 'Веб-поиск не настроен — открыть настройки' : webGroundingActive ? 'Веб-поиск включён — нажмите, чтобы выключить' : 'Включить веб-поиск (SearXNG)'}
        style={{
          flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36,
          background: webGroundingActive ? 'var(--accent-soft)' : 'transparent',
          border: webGroundingActive ? '1.5px solid var(--accent)' : '1.5px solid transparent',
          borderRadius: '50%', color: webGroundingActive ? 'var(--accent)' : 'var(--text-faint)', cursor: 'pointer', padding: 0,
        }}
      >
        <Globe size={16} strokeWidth={2} />
      </button>
      <textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
        placeholder="Напишите сообщение…"
        rows={1}
        style={{
          flex: 1, resize: 'none', border: 'none', outline: 'none', background: 'transparent',
          color: 'var(--text-strong)', fontSize: 'var(--fs-md)', fontFamily: 'inherit',
          maxHeight: 140, minHeight: 24, padding: '6px 8px',
        }}
      />
      <button
        onClick={newChat}
        title="Новый чат"
        style={{ flex: 'none', border: 'none', background: 'transparent', cursor: 'default', padding: 8, borderRadius: 'var(--radius-sm)', display: 'inline-flex', color: 'var(--text-faint)' }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-body)'; e.currentTarget.style.background = 'var(--surface-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-faint)'; e.currentTarget.style.background = 'transparent'; }}
      >
        <MessageSquarePlus size={17} />
      </button>
      <button
        onClick={() => send(input)}
        disabled={streaming || !input.trim()}
        title="Отправить"
        style={{
          flex: 'none', border: 'none', borderRadius: '50%', cursor: 'default', width: 36, height: 36,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: input.trim() && !streaming ? 'var(--accent)' : 'var(--surface-sunken)',
          color: input.trim() && !streaming ? 'var(--on-accent)' : 'var(--text-faint)',
        }}
      >
        <Send size={15} />
      </button>
    </div>
  );

  // Диалог: стандартный чат — прокручивается лента, ввод закреплён снизу.
  if (hasConversation) {
    return (
      <div style={{ flex: 1, width: '100%', maxWidth: 760, display: 'flex', flexDirection: 'column', minHeight: 0, gap: 12 }}>
        {topBar}
        <div ref={transcriptRef} className="oblako-hide-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 2px' }}>
          {messages.map((m, i) => <MessageBubble key={i} message={m} />)}
          {streaming && (
            <MessageBubble
              message={{ role: 'assistant', text: streamText, createdAt: Date.now() }}
              pending
              placeholderText={webSearching ? 'Ищу в интернете…' : '…'}
            />
          )}
        </div>
        {errorBlock}
        {consentBlock}
        {inputRow}
      </div>
    );
  }

  // Пустой экран: прокручивается ВСЯ панель целиком. «Первый экран» (minHeight:100%) заполняет
  // видимую высоту, спейсер прижимает СТРОКУ ВВОДА к его низу — на первом экране виден ввод внизу.
  // Список недавних чатов идёт НИЖЕ первого экрана (под сгибом) — большая часть доступна прокруткой.
  return (
    <div className="oblako-hide-scrollbar" style={{ flex: 1, width: '100%', maxWidth: 760, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '2px' }}>
      <div style={{ flex: 'none', minHeight: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {topBar}
        {promptsBlock}
        <div style={{ flex: 1, minHeight: 12 }} />
        {errorBlock}
        {consentBlock}
        {inputRow}
      </div>
      {recentChats && <div style={{ flex: 'none', marginTop: 16 }}>{recentChats}</div>}
    </div>
  );
}

function QuickPromptChip({ icon: Icon, text, onClick }: { icon: LucideIcon; text: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px',
        ...glassPlate({ surface: 'surface-island', shadow: null }),
        borderRadius: 'var(--radius-pill)',
        color: 'var(--text-body)', fontSize: 'var(--fs-sm)', cursor: 'default',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface-island)'; }}
    >
      <Icon size={14} style={{ color: 'var(--text-faint)', flex: 'none' }} />
      {text}
    </button>
  );
}

// Тот же паттерн, что у Claude/ChatGPT: реплика ПОЛЬЗОВАТЕЛЯ — пузырь с заметной подложкой,
// ответ МОДЕЛИ — без подложки вообще, обычным текстом во всю ширину (markdown-разметка —
// markdownComponents, общий рендер с боковой AI-панелью, см. components/aiMarkdown.tsx).
// Пузырь — var(--surface-sunken) (тема-зависимый: тёмная уже сплошная, светлая полупрозрачная)
// + бордер var(--divider) — на текущем почти-белом --app-bg одной полупрозрачной заливки
// недостаточно, граница гарантирует видимость пузыря в обеих темах без хардкода цвета.
function MessageBubble({ message, pending, placeholderText = '…' }: {
  message: HubChatMessage; pending?: boolean; placeholderText?: string;
}) {
  if (message.role === 'user') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{
          maxWidth: '80%', padding: '8px 14px', borderRadius: 'var(--radius-card)',
          fontSize: 'var(--fs-md)', lineHeight: 'var(--lh-body)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          color: 'var(--text-strong)', background: 'var(--surface-sunken)',
          border: '1px solid var(--divider)',
        }}>
          {message.text}
        </div>
      </div>
    );
  }

  const showPlaceholder = pending && message.text.trim() === '';
  return (
    <div style={{ width: '100%', opacity: showPlaceholder ? 0.6 : 1 }}>
      {showPlaceholder
        ? <span style={{ fontSize: 'var(--fs-md)', color: 'var(--text-faint)' }}>{placeholderText}</span>
        : <ReactMarkdown components={markdownComponents}>{message.text}</ReactMarkdown>}
    </div>
  );
}

// Компактная метка времени для списка сессий — сегодня: часы:минуты, иначе: число и месяц
// (тот же принцип, что в History.tsx, но без полной группировки по дням — списку тут короче).
function formatSessionTime(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
