import { useEffect, useRef, useState } from 'react';
import { Clock, Sparkles, LayoutGrid, Plus, Send } from 'lucide-react';
import { getTopSites } from '../../shared/frecency';
import type { TileSite } from '../../shared/frecency';
import type { HubChatMessage, HubChatSessionMeta, HubMode } from '../../shared/ipc';

interface HubProps {
  tabId: string;
  onSubmit: (input: string) => void;
  onOpenHistory: () => void;
}

export default function Hub({ tabId, onSubmit, onOpenHistory }: HubProps) {
  const [tiles, setTiles] = useState<TileSite[]>([]);
  const [mode, setMode] = useState<HubMode>('tiles');

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
    window.oblako.getHubMode().then((m) => { if (mounted) setMode(m); });
    return () => { mounted = false; };
  }, []);

  const pickMode = (m: HubMode) => {
    setMode(m);
    void window.oblako.setHubMode(m);
  };

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: mode === 'tiles' ? 'center' : 'flex-start',
      padding: '32px 48px', overflowY: mode === 'tiles' ? 'auto' : 'hidden',
      gap: 24, minHeight: 0,
    }}>
      <ModeToggle mode={mode} onChange={pickMode} />

      {mode === 'tiles'
        ? <TilesView tiles={tiles} onSubmit={onSubmit} onOpenHistory={onOpenHistory} />
        : <AiChatView tabId={tabId} />}
    </div>
  );
}

// ── Переключатель режимов ────────────────────────────────────────────────────

function ModeToggle({ mode, onChange }: { mode: HubMode; onChange: (m: HubMode) => void }) {
  return (
    <div style={{
      display: 'inline-flex', flex: 'none', padding: 3, gap: 2,
      background: 'var(--surface-sunken)', borderRadius: 'var(--radius-card)',
      border: '1px solid var(--glass-edge)',
    }}>
      <ModeButton active={mode === 'tiles'} onClick={() => onChange('tiles')} icon={<LayoutGrid size={14} />} label="Обзор" />
      <ModeButton active={mode === 'ai'} onClick={() => onChange('ai')} icon={<Sparkles size={14} />} label="AI" />
    </div>
  );
}

function ModeButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: JSX.Element; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
        border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'default',
        fontSize: 'var(--fs-xs)', fontWeight: 600,
        background: active ? 'var(--accent-soft)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text-muted)',
      }}
    >
      {icon}{label}
    </button>
  );
}

// ── Режим «Обзор» — плитки популярных сайтов (без изменений) ───────────────────

function TilesView({ tiles, onSubmit, onOpenHistory }: {
  tiles: TileSite[]; onSubmit: (input: string) => void; onOpenHistory: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 32 }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{
          margin: '0 0 6px', fontSize: 'var(--fs-3xl)', fontWeight: 700,
          letterSpacing: 'var(--ls-tight)', color: 'var(--text-strong)',
        }}>
          Чем займёмся, <span style={{ color: 'var(--accent)' }}>Антон</span>?
        </h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 'var(--fs-md)' }}>
          Введите адрес или запрос в строке выше
        </p>
      </div>

      {tiles.length > 0 && (
        <div style={{ width: '100%', maxWidth: 680 }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 12,
          }}>
            {tiles.map((site) => (
              <TileCard key={site.origin} site={site} onClick={() => onSubmit(site.url)} />
            ))}
          </div>

          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <button
              onClick={onOpenHistory}
              style={{
                background: 'none', border: 'none', cursor: 'default',
                color: 'var(--text-faint)', fontSize: 'var(--fs-xs)',
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '4px 8px', borderRadius: 'var(--radius-sm)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-faint)')}
            >
              <Clock size={12} /> Вся история
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TileCard({ site, onClick }: { site: TileSite; onClick: () => void }) {
  const [faviconOk, setFaviconOk] = useState(true);
  const faviconSrc = `${site.origin}/favicon.ico`;
  // Первая буква домена для фолбэка
  const letter = site.origin.replace(/^https?:\/\//, '').charAt(0).toUpperCase();
  // Человекочитаемый домен (без схемы)
  const domain = site.origin.replace(/^https?:\/\//, '');

  return (
    <button
      onClick={onClick}
      title={site.title || domain}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        padding: '14px 10px',
        background: 'var(--surface-island)',
        backdropFilter: 'var(--glass-filter)',
        WebkitBackdropFilter: 'var(--glass-filter)',
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--shadow-card)',
        border: '1px solid var(--glass-edge)',
        cursor: 'default',
        minWidth: 0,
        transition: 'box-shadow 0.15s, transform 0.1s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = 'var(--shadow-island)';
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = 'var(--shadow-card)';
        e.currentTarget.style.transform = '';
      }}
    >
      {faviconOk ? (
        <img
          src={faviconSrc}
          alt=""
          width={24} height={24}
          style={{ borderRadius: 4, display: 'block' }}
          onError={() => setFaviconOk(false)}
        />
      ) : (
        <div style={{
          width: 24, height: 24, borderRadius: 6,
          background: 'var(--accent-soft)',
          color: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 700,
        }}>
          {letter}
        </div>
      )}
      <span style={{
        fontSize: 'var(--fs-xs)', color: 'var(--text-muted)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        width: '100%', textAlign: 'center',
      }}>
        {domain}
      </span>
    </button>
  );
}

// ── Режим «AI» — чат с локальной моделью (см. electron/HubChatManager.ts) ──────

function AiChatView({ tabId }: { tabId: string }) {
  const [sessions, setSessions] = useState<HubChatSessionMeta[]>([]);
  const [messages, setMessages] = useState<HubChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const refreshSessions = () => {
    window.oblako.listHubChatSessions().then(setSessions).catch(() => { /* без персистентности — список пуст */ });
  };

  useEffect(refreshSessions, []);

  // Стриминг ответа — чанки и финальный результат маршрутизируются по tabId (main шлёт их всем
  // Hub-вкладкам разом через chromeView.webContents, т.к. Hub — не отдельная WebContentsView).
  useEffect(() => {
    const unsubChunk = window.oblako.onHubChatChunk((payload) => {
      if (payload.tabId !== tabId) return;
      setStreamText((prev) => prev + payload.text);
    });
    const unsubResult = window.oblako.onHubChatResult((payload) => {
      if (payload.tabId !== tabId) return;
      setStreaming(false);
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

  const send = () => {
    const text = input.trim();
    if (!text || streaming) return;
    setMessages((prev) => [...prev, { role: 'user', text, createdAt: Date.now() }]);
    setInput('');
    setStreaming(true);
    setStreamText('');
    setError(null);
    window.oblako.sendHubChatMessage(tabId, text);
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

  const openSession = (id: number) => {
    if (streaming || id === sessionId) return;
    void window.oblako.resumeHubChatSession(tabId, id).then((msgs) => {
      setMessages(msgs);
      setSessionId(id);
      setStreamText('');
      setError(null);
    });
  };

  const hasConversation = messages.length > 0 || streaming;

  return (
    <div style={{
      flex: 1, width: '100%', maxWidth: 680, display: 'flex', flexDirection: 'column',
      minHeight: 0, gap: 12,
    }}>
      {hasConversation ? (
        <div ref={transcriptRef} style={{
          flex: 1, minHeight: 0, overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 2px',
        }}>
          {messages.map((m, i) => <MessageBubble key={i} message={m} />)}
          {streaming && (
            <MessageBubble message={{ role: 'assistant', text: streamText || '…', createdAt: Date.now() }} pending />
          )}
        </div>
      ) : (
        <div style={{
          flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 6, textAlign: 'center',
        }}>
          <h2 style={{ margin: 0, fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text-strong)' }}>
            Спросите что угодно
          </h2>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>
            Отвечает локальная модель, без интернета
          </p>
        </div>
      )}

      {error && (
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', padding: '0 4px' }}>
          Ошибка: {error}
        </div>
      )}

      <div style={{
        flex: 'none', display: 'flex', alignItems: 'flex-end', gap: 6, padding: 8,
        background: 'var(--surface-island)',
        backdropFilter: 'var(--glass-filter)', WebkitBackdropFilter: 'var(--glass-filter)',
        borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)',
        border: '1px solid var(--glass-edge)',
      }}>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          placeholder="Напишите сообщение…"
          rows={1}
          style={{
            flex: 1, resize: 'none', border: 'none', outline: 'none', background: 'transparent',
            color: 'var(--text-strong)', fontSize: 'var(--fs-sm)', fontFamily: 'inherit',
            maxHeight: 140, minHeight: 22, padding: '5px 6px',
          }}
        />
        <button
          onClick={newChat}
          title="Новый чат"
          style={{
            flex: 'none', border: 'none', background: 'transparent', cursor: 'default', padding: 7,
            borderRadius: 'var(--radius-sm)', display: 'inline-flex', color: 'var(--text-faint)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-body)'; e.currentTarget.style.background = 'var(--surface-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-faint)'; e.currentTarget.style.background = 'transparent'; }}
        >
          <Plus size={16} />
        </button>
        <button
          onClick={send}
          disabled={streaming || !input.trim()}
          title="Отправить"
          style={{
            flex: 'none', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'default', padding: 8,
            display: 'inline-flex',
            background: input.trim() && !streaming ? 'var(--accent)' : 'var(--surface-sunken)',
            color: input.trim() && !streaming ? 'var(--on-accent)' : 'var(--text-faint)',
          }}
        >
          <Send size={15} />
        </button>
      </div>

      {sessions.length > 0 && (
        <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 150, overflowY: 'auto' }}>
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => openSession(s.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', textAlign: 'left',
                border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'default',
                background: s.id === sessionId ? 'var(--surface-sunken)' : 'transparent',
                color: s.id === sessionId ? 'var(--text-strong)' : 'var(--text-muted)',
                fontSize: 'var(--fs-xs)',
              }}
              onMouseEnter={(e) => { if (s.id !== sessionId) e.currentTarget.style.background = 'var(--surface-hover)'; }}
              onMouseLeave={(e) => { if (s.id !== sessionId) e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.title || 'Без названия'}
              </span>
              <span style={{ color: 'var(--text-faint)', flex: 'none' }}>{formatSessionTime(s.updatedAt)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MessageBubble({ message, pending }: { message: HubChatMessage; pending?: boolean }) {
  const isUser = message.role === 'user';
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      <div style={{
        maxWidth: '85%', padding: '8px 12px', borderRadius: 'var(--radius-card)',
        fontSize: 'var(--fs-sm)', lineHeight: 'var(--lh-body)', whiteSpace: 'pre-wrap',
        color: isUser ? 'var(--text-strong)' : 'var(--text-body)',
        background: isUser ? 'var(--accent-soft)' : 'var(--surface-island)',
        border: isUser ? 'none' : '1px solid var(--glass-edge)',
        opacity: pending ? 0.85 : 1,
      }}>
        {message.text}
      </div>
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
