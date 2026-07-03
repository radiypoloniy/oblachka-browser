// Правая AI-панель — Заход 2: рабочий чат с локальным Qwen поверх готового каркаса-острова
// (Заход 1). Дизайн (остров/тень/скругления/отступы/закрытие) не трогается — только контент
// внутри вместо пустой заглушки. Позиция/размер/открытие-закрытие по-прежнему в main
// (AiPanelManager.ts), эта страница просто рисует ленту + поле ввода на весь свой вьюпорт.
// Одна беседа на сессию браузера, без персистентности — история живёт в main (TranslationService.ts,
// module-level chatHistory) и здесь дублируется только для отрисовки; закрытие браузера теряет обе
// копии одинаково (задел под будущий чат-по-странице — не реализован в этом заходе).
import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import { Sparkles, X, Send } from 'lucide-react';
import './styles/global.css';
import { markdownComponents } from './components/aiMarkdown';

// Форма ChatOutcome из electron/TranslationService.ts — не через shared/ipc.ts (ad-hoc канал,
// как и у поповера, см. preload-aipanel.ts), поэтому просто зеркалим форму локально.
type ChatOutcome =
  | { ok: true; out: string; ms: number; tokPerSec: number; loadMs: number | null }
  | { ok: false; error: string }

declare global {
  interface Window {
    aiPanel: {
      close: () => void
      sendChat: (text: string) => void
      onChatChunk: (cb: (text: string) => void) => () => void
      onChatResult: (cb: (outcome: ChatOutcome) => void) => () => void
    }
  }
}

interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

// Воздух вокруг острова на все стороны — держать в синхроне с GUTTER в
// electron/AiPanelManager.ts (тот выделяет под него ровно столько же места в bounds
// WebContentsView, отсчитывая от тулбара/правого края/низа окна). Тот же паддинг заодно
// и зона под CSS box-shadow — WebContentsView обрезает всё, что рисуется за границей.
const GUTTER = 20;

// Сырые отступы сверху/снизу от границ вьюпорта равны (оба GUTTER) — но у тулбара нет своего
// фона (см. Toolbar.tsx: div без background, флаш-прозрачный поверх холста), а его кнопки/омнибокс
// центрированы внутри строки высотой 56px с ~12px пустого места сверху/снизу вокруг иконок
// (padding:7 вокруг 18px-иконки). Глаз меряет зазор от ВИДИМЫХ иконок, а не от невидимой границы
// div'а — поэтому верхний зазор читается больше нижнего при равных сырых отступах. Компенсируем
// оптически, сдвигая карточку вниз в её же фиксированном диапазоне (сам диапазон — от тулбара до
// низа окна — не меняется, см. AiPanelManager.ts): но не на все 12px тулбарной «пустоты» — часть
// её всё ещё читается как часть тулбара, не как зазор.
const VERTICAL_OPTICAL_SHIFT = 6;

function AiPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  // Копится по мере генерации (тот же токен-стриминг, что у поповера/AI-действий) — показывается
  // как «печатающееся» сообщение ассистента, пока не придёт финальный result.
  const [streamedText, setStreamedText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') window.aiPanel.close(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const unsubChunk = window.aiPanel.onChatChunk((chunkText) => {
      setStreamedText((prev) => prev + chunkText)
    })
    const unsubResult = window.aiPanel.onChatResult((outcome) => {
      setSending(false)
      setStreamedText('')
      if (outcome.ok) {
        setMessages((prev) => [...prev, { role: 'assistant', text: outcome.out }])
        setError(null)
      } else {
        setError(outcome.error)
      }
    })
    return () => { unsubChunk(); unsubResult() }
  }, [])

  // Автоскролл вниз при новом тексте — свои сообщения, ответы AI, стриминг по ходу генерации.
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages, streamedText])

  const handleSend = () => {
    const text = input.trim()
    if (!text || sending) return
    setMessages((prev) => [...prev, { role: 'user', text }])
    setInput('')
    setStreamedText('')
    setError(null)
    setSending(true)
    window.aiPanel.sendChat(text)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div style={{
      paddingTop: GUTTER - VERTICAL_OPTICAL_SHIFT,
      paddingBottom: GUTTER + VERTICAL_OPTICAL_SHIFT,
      paddingLeft: GUTTER,
      paddingRight: GUTTER,
      boxSizing: 'border-box', width: '100%', height: '100vh',
    }}>
      <div style={{
        width: '100%', height: '100%', boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--surface-solid)',
        // var(--radius-island) — заметно круглее var(--radius-card): остров, а не карточка.
        borderRadius: 'var(--radius-island)',
        boxShadow: '0 10px 28px rgba(40,30,80,0.16)',
        fontFamily: 'var(--font-sans)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: 'var(--pad-island)',
          flexShrink: 0,
        }}>
          <Sparkles size={18} style={{ color: 'var(--accent)' }} />
          <span style={{ flex: 1, fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text-strong)' }}>
            AI
          </span>
          <button
            onClick={() => window.aiPanel.close()}
            title="Закрыть (Esc)"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 30, height: 30, flexShrink: 0,
              background: 'var(--surface-sunken)', border: 'none', borderRadius: '50%',
              color: 'var(--text-muted)', cursor: 'pointer', padding: 0,
            }}
          >
            <X size={15} strokeWidth={2} />
          </button>
        </div>

        {/* Лента сообщений — minHeight:0 обязателен, иначе flex-контейнер не даёт себе схлопнуться
            под overflowY:auto и скролл не работает (стандартная ловушка flex+scroll). */}
        <div ref={listRef} style={{
          flex: 1, minHeight: 0, overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: 10,
          padding: `0 var(--pad-island) var(--pad-island)`,
        }}>
          {messages.length === 0 && !sending && (
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
              Спросите что-нибудь у Qwen. Первый ответ может занять до 30–40 секунд — модель загружается.
            </span>
          )}

          {messages.map((m, i) => (
            <div key={i} style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '82%',
              padding: '8px 12px',
              borderRadius: 14,
              background: m.role === 'user' ? 'var(--accent)' : 'var(--surface-sunken)',
              color: m.role === 'user' ? 'var(--text-on-accent)' : 'var(--text-strong)',
            }}>
              {m.role === 'assistant' ? (
                <ReactMarkdown components={markdownComponents}>{m.text}</ReactMarkdown>
              ) : (
                <span style={{
                  fontSize: 'var(--fs-md)', lineHeight: 'var(--lh-body)',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {m.text}
                </span>
              )}
            </div>
          ))}

          {/* «Печатающееся» сообщение ассистента — тот же markdown-рендер до и после финализации
              (react-markdown нормально переживает промежуточный незакрытый синтаксис), что и
              в поповере. */}
          {sending && (
            <div style={{
              alignSelf: 'flex-start', maxWidth: '82%',
              padding: '8px 12px', borderRadius: 14,
              background: 'var(--surface-sunken)', color: 'var(--text-strong)',
            }}>
              {streamedText.length > 0 ? (
                <ReactMarkdown components={markdownComponents}>{streamedText}</ReactMarkdown>
              ) : (
                <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>…</span>
              )}
            </div>
          )}

          {error && (
            <span style={{ fontSize: 'var(--fs-sm)', color: 'rgba(200,50,50,0.85)' }}>
              Ошибка: {error}
            </span>
          )}
        </div>

        {/* Поле ввода — Enter отправляет, Shift+Enter переносит строку. Кнопка отправки —
            единственный акцентный (--accent) элемент здесь, как и просит цветовой закон
            (send — одно из немногих мест, где акцент уместен). */}
        <div style={{
          display: 'flex', alignItems: 'flex-end', gap: 8,
          padding: 'var(--pad-island)',
          flexShrink: 0,
        }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Написать сообщение…"
            rows={1}
            style={{
              flex: 1, resize: 'none', maxHeight: 96,
              border: 'none', outline: 'none',
              background: 'var(--surface-sunken)', borderRadius: 'var(--radius-chip)',
              padding: '8px 12px', fontSize: 'var(--fs-md)', fontFamily: 'var(--font-sans)',
              color: 'var(--text-strong)',
            }}
          />
          <button
            onClick={handleSend}
            disabled={sending || !input.trim()}
            title="Отправить"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 34, height: 34, flexShrink: 0,
              background: 'var(--accent)', border: 'none', borderRadius: '50%',
              color: 'var(--text-on-accent)',
              cursor: sending || !input.trim() ? 'default' : 'pointer',
              opacity: sending || !input.trim() ? 0.45 : 1,
              padding: 0,
            }}
          >
            <Send size={15} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AiPanel />
  </React.StrictMode>,
);
