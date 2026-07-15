// Правая AI-панель — чат с локальным Qwen (Заход 2), беседа привязана к вкладке (Заход 3).
// Дизайн (остров/тень/скругления/отступы/закрытие) не трогается — только контент внутри.
// Позиция/размер/открытие-закрытие по-прежнему в main (AiPanelManager.ts), эта страница просто
// рисует чипс страницы + ленту + поле ввода на весь свой вьюпорт.
// Беседы эфемерные, per-вкладка, БЕЗ персистентности — авторитетное хранилище (messages+history
// для Qwen) живёт в main (AiPanelManager.ts::tabContexts), эта страница только отображает то, что
// приходит через onContext при переключении/навигации/(пере)открытии панели. Свой собственный
// messages-стейт здесь — витрина: пополняется оптимистично при отправке и полностью ЗАМЕНЯЕТСЯ
// целиком при каждом onContext (переключили вкладку → другая лента, не дописывание к старой).
import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import { Sparkles, X, Send, Globe, SearchCheck, Loader2, LayoutGrid, Calculator, RefreshCw, Timer, Pipette } from 'lucide-react';
import './styles/global.css';
import { markdownComponents } from './components/aiMarkdown';

// Форма ChatOutcome из electron/TranslationService.ts — не через shared/ipc.ts (ad-hoc канал,
// как и у поповера, см. preload-aipanel.ts), поэтому просто зеркалим форму локально.
type ChatOutcome =
  | { ok: true; out: string; ms: number; tokPerSec: number; loadMs: number | null }
  | { ok: false; error: string }

interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

// Форма пуша ai-panel:context из AiPanelManager.ts::sendCurrentContext.
interface TabContext {
  tabId: string
  url: string
  title: string
  messages: ChatMessage[]
}

declare global {
  interface Window {
    aiPanel: {
      close: () => void
      sendChat: (text: string) => void
      quickTranslate: () => void
      onChatChunk: (cb: (text: string) => void) => () => void
      onChatResult: (cb: (outcome: ChatOutcome) => void) => () => void
      onContext: (cb: (ctx: TabContext) => void) => () => void
      // Заход D — кнопка фактчека: показывается только когда ключ Gemini подключён.
      onKeyStatus: (cb: (connected: boolean) => void) => () => void
      factCheck: () => void
    }
  }
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

// Кнопки-подсказки над полем ввода (как у Яндекса) — статичный набор, НЕ генерируются под
// страницу (это отдельный дорогой заход, в бэклог). Промпт-тексты — единственное место, легко
// менять формулировки. Клик = отправка сообщения в чат текущей вкладки, как обычное — тот же
// существующий стриминг/per-вкладочный контекст/извлечение текста страницы (заход 4). Результат
// уходит в ПАНЕЛЬ — эти кнопки не трогают текст самой страницы.
// «Перевести» — отдельный kind: направление (src/tgt) неизвестно ДО извлечения текста и детекции
// языка страницы (двунаправленно, как перевод выделения — см. AiPanelManager.ts::resolveDirection/
// buildPrompt), поэтому у неё нет готового prompt здесь — только сигнал quickTranslate() в main.
type QuickAction =
  | { kind: 'prompt'; label: string; prompt: string }
  | { kind: 'translate'; label: string }
const QUICK_ACTIONS: QuickAction[] = [
  { kind: 'translate', label: 'Перевести' },
  { kind: 'prompt', label: 'Объяснить', prompt: 'Объясни простыми словами, о чём эта страница.' },
  { kind: 'prompt', label: 'Сделать саммари', prompt: 'Сделай краткое саммари этой страницы.' },
];

// Хост без www. — компактнее в узкой (360px) панели. Пустой/нераспарсиваемый url (хаб,
// oblako-chrome://) — просто ничего не показываем вторым сегментом чипса.
function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function AiPanel() {
  const [tabId, setTabId] = useState<string | null>(null)
  const [pageTitle, setPageTitle] = useState('')
  const [pageUrl, setPageUrl] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  // Копится по мере генерации (тот же токен-стриминг, что у поповера/AI-действий) — показывается
  // как «печатающееся» сообщение ассистента, пока не придёт финальный result.
  const [streamedText, setStreamedText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Заход D — кнопка фактчека видна только когда ключ Gemini подключён (см. AiKeyStore.ts,
  // пуш через AiPanelManager.ts::sendKeyStatus). factChecking — отдельный флаг ТОЛЬКО для
  // текстовой/визуальной подписи «печатающегося» сообщения (см. рендер ленты ниже): вызов Gemini
  // с Search Grounding идёт заметно дольше локальной модели и без частичного стриминга, обычное
  // «…» выглядело бы как зависание — явный текст снижает риск повторного клика.
  const [factCheckAvailable, setFactCheckAvailable] = useState(false)
  const [factChecking, setFactChecking] = useState(false)
  // Плашка приватности перед вызовом (см. sendFactCheck ниже) — обязательна каждый раз, без «запомнить».
  const [showFactCheckConfirm, setShowFactCheckConfirm] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  // Заход 3 — переключатель AI/Приложения (см. дизайн-систему): локальный, не персистится —
  // «Приложения» пока заглушка без функциональности, помнить выбор между сессиями незачем.
  const [mode, setMode] = useState<'chat' | 'apps'>('chat')

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') window.aiPanel.close(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    // Переключение вкладки / смена её URL / (пере)открытие панели — main присылает АВТОРИТЕТНУЮ
    // ленту этой вкладки целиком. Любая незавершённая генерация «протухшей» вкладки визуально
    // гасится (sending/streamedText/error сбрасываются) — она никуда не делась в main, просто эта
    // страница её больше не показывает, пока пользователь не вернётся на ту вкладку.
    const unsubContext = window.aiPanel.onContext((ctx) => {
      setTabId(ctx.tabId)
      setPageTitle(ctx.title)
      setPageUrl(ctx.url)
      setMessages(ctx.messages)
      setStreamedText('')
      setSending(false)
      setFactChecking(false)
      setError(null)
    })
    const unsubChunk = window.aiPanel.onChatChunk((chunkText) => {
      setStreamedText((prev) => prev + chunkText)
    })
    const unsubResult = window.aiPanel.onChatResult((outcome) => {
      setSending(false)
      setFactChecking(false)
      setStreamedText('')
      if (outcome.ok) {
        setMessages((prev) => [...prev, { role: 'assistant', text: outcome.out }])
        setError(null)
      } else {
        setError(outcome.error)
      }
    })
    const unsubKeyStatus = window.aiPanel.onKeyStatus((connected) => {
      setFactCheckAvailable(connected)
    })
    return () => { unsubContext(); unsubChunk(); unsubResult(); unsubKeyStatus() }
  }, [])

  // Автоскролл вниз при новом тексте — свои сообщения, ответы AI, стриминг по ходу генерации.
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages, streamedText])

  // Общая точка отправки — и текстовое поле, и кнопки-подсказки шлют через неё «как будто
  // пользователь сам написал»: один и тот же путь (оптимистичное сообщение в ленте → sendChat).
  const sendText = (text: string) => {
    if (!text || sending || !tabId) return
    setMessages((prev) => [...prev, { role: 'user', text }])
    setInput('')
    setStreamedText('')
    setError(null)
    setSending(true)
    window.aiPanel.sendChat(text)
  }

  const handleSend = () => sendText(input.trim())

  // «Перевести» — не sendText: промпт (с определённым src/tgt) собирается в main, после извлечения
  // текста страницы и детекции языка. Здесь только оптимистичная метка в ленте + сигнал main.
  const sendQuickTranslate = () => {
    if (sending || !tabId) return
    setMessages((prev) => [...prev, { role: 'user', text: 'Перевести' }])
    setStreamedText('')
    setError(null)
    setSending(true)
    window.aiPanel.quickTranslate()
  }

  // Заход D — фактчек уходит в облако (Google Gemini), а не к локальной модели: плашка
  // приватности обязательна перед КАЖДЫМ вызовом (см. showFactCheckConfirm выше) — реальная
  // отправка происходит только по явному подтверждению.
  const sendFactCheck = () => {
    if (sending || !tabId) return
    setShowFactCheckConfirm(false)
    setMessages((prev) => [...prev, { role: 'user', text: 'Фактчек' }])
    setStreamedText('')
    setError(null)
    setSending(true)
    setFactChecking(true)
    window.aiPanel.factCheck()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const host = hostnameOf(pageUrl)

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
        boxShadow: 'var(--shadow-overlay)',
        fontFamily: 'var(--font-sans)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: 'var(--pad-island)',
          paddingBottom: 0,
          flexShrink: 0,
        }}>
          <ModeToggle mode={mode} onChange={setMode} />
          <div style={{ flex: 1 }} />
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

        {/* Чипс текущей страницы (как у Яндекса) — к чему привязана лента ниже. Смена URL внутри
            вкладки обновит и чипс, и ленту (сброшенную на новый разговор) одним и тем же onContext. */}
        {mode === 'chat' && (<>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          margin: `10px var(--pad-island) 0`,
          padding: '6px 10px',
          background: 'var(--surface-sunken)',
          borderRadius: 'var(--radius-chip)',
          flexShrink: 0,
          minWidth: 0,
        }}>
          <Globe size={12} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
          <span style={{
            fontSize: 'var(--fs-xs)', fontWeight: 500, color: 'var(--text-muted)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
          }}>
            {pageTitle || 'Новая вкладка'}
            {host && <span style={{ color: 'var(--text-faint)' }}> · {host}</span>}
          </span>
        </div>

        {/* Лента сообщений — minHeight:0 обязателен, иначе flex-контейнер не даёт себе схлопнуться
            под overflowY:auto и скролл не работает (стандартная ловушка flex+scroll). */}
        <div ref={listRef} style={{
          flex: 1, minHeight: 0, overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: 10,
          padding: `10px var(--pad-island) var(--pad-island)`,
        }}>
          {messages.length === 0 && !sending && (
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
              Спросите что-нибудь у Qwen про эту страницу. Первый ответ может занять до 30–40 секунд —
              модель загружается.
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
              ) : factChecking ? (
                // Явный индикатор, отличный от «мгновенного» «…» локальных кнопок — Gemini с
                // Search Grounding занимает заметно дольше и не стримит частями, «…» тут читался
                // бы как зависание и мог спровоцировать повторный клик.
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  fontSize: 'var(--fs-sm)', color: 'var(--text-faint)',
                }}>
                  <Loader2 size={13} style={{ animation: 'oblako-spin 1s linear infinite' }} />
                  Анализирую источники…
                </span>
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

        {/* Кнопки-подсказки — только пока беседа пуста (как у Яндекса, над полем ввода). Как только
            пришло первое сообщение, ряд исчезает — тот же messages.length, что гасит плейсхолдер
            в ленте выше. Плашка приватности фактчека занимает то же место — взаимоисключающе с
            рядом кнопок (см. showFactCheckConfirm). */}
        {messages.length === 0 && !sending && (
          showFactCheckConfirm ? (
            <div style={{
              display: 'flex', flexDirection: 'column', gap: 8,
              margin: `0 var(--pad-island) 8px`,
              padding: '10px 12px',
              borderRadius: 'var(--radius-chip)',
              background: 'var(--surface-sunken)',
              flexShrink: 0,
            }}>
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-body)', lineHeight: 'var(--lh-body)' }}>
                Текст страницы и запрос уйдут в облако (Google Gemini) для проверки по реальным
                источникам в интернете.
              </span>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setShowFactCheckConfirm(false)}
                  style={{
                    padding: '5px 12px', borderRadius: 'var(--radius-chip)', border: 'none',
                    background: 'transparent', color: 'var(--text-muted)',
                    fontSize: 'var(--fs-xs)', fontWeight: 500, cursor: 'pointer',
                  }}
                >
                  Отмена
                </button>
                <button
                  onClick={sendFactCheck}
                  style={{
                    padding: '5px 12px', borderRadius: 'var(--radius-chip)', border: 'none',
                    background: 'var(--accent)', color: 'var(--on-accent)',
                    fontSize: 'var(--fs-xs)', fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  Продолжить
                </button>
              </div>
            </div>
          ) : (
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: 6,
              padding: `0 var(--pad-island)`,
              marginBottom: 8,
              flexShrink: 0,
            }}>
              {QUICK_ACTIONS.map((qa) => (
                <button
                  key={qa.label}
                  onClick={() => qa.kind === 'translate' ? sendQuickTranslate() : sendText(qa.prompt)}
                  disabled={!tabId}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 'var(--radius-chip)',
                    border: 'none',
                    // var(--shadow-chip) — та же лёгкая тень, что у чипов/карточек в остальном
                    // хроме (tokens/shadows.css), не подобрана заново: иначе кнопки сливались
                    // с фоном острова (тот же тон var(--surface-sunken)).
                    background: 'var(--surface-sunken)',
                    boxShadow: 'var(--shadow-chip)',
                    color: 'var(--text-body)',
                    fontSize: 'var(--fs-xs)', fontWeight: 500,
                    cursor: tabId ? 'pointer' : 'default',
                    opacity: tabId ? 1 : 0.5,
                  }}
                >
                  {qa.label}
                </button>
              ))}
              {/* Заход D — видна ТОЛЬКО когда ключ Gemini подключён (см. onKeyStatus выше), не
                  disabled-серая: без ключа кнопки нет вообще. Тот же нейтральный стиль, что у
                  остальных подсказок — она такое же одно из равных действий, не отдельная
                  система/облако-роль (заход 3, новая дизайн-система убрала эту роль у violet). */}
              {factCheckAvailable && (
                <button
                  onClick={() => setShowFactCheckConfirm(true)}
                  disabled={!tabId}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '6px 12px',
                    borderRadius: 'var(--radius-chip)',
                    border: 'none',
                    background: 'var(--surface-sunken)',
                    boxShadow: 'var(--shadow-chip)',
                    color: 'var(--text-body)',
                    fontSize: 'var(--fs-xs)', fontWeight: 500,
                    cursor: tabId ? 'pointer' : 'default',
                    opacity: tabId ? 1 : 0.5,
                  }}
                >
                  <SearchCheck size={13} /> Фактчек
                </button>
              )}
            </div>
          )
        )}

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
        </>)}
        {mode === 'apps' && <AppsGrid />}
      </div>
    </div>
  );
}

// ── Режим «Приложения» — заглушка (заход 3, см. Oblako Design System) ──────────────────────────
// Функциональность на потом (калькулятор/конвертер/таймер/цвет.пикер) — сейчас только визуал
// по спеке: сетка плиток + пилюля «Скоро», без onClick.
const APPS: { icon: typeof Calculator; label: string }[] = [
  { icon: Calculator, label: 'Калькулятор' },
  { icon: RefreshCw, label: 'Конвертер' },
  { icon: Timer, label: 'Таймер' },
  { icon: Pipette, label: 'Цвет.пикер' },
];

function AppsGrid() {
  return (
    <div style={{
      flex: 1, minHeight: 0, overflowY: 'auto',
      display: 'flex', flexDirection: 'column',
      padding: `20px var(--pad-island)`,
    }}>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14,
        alignContent: 'start',
      }}>
        {APPS.map(({ icon: Icon, label }) => (
          <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: '100%', aspectRatio: '1 / 1',
              borderRadius: 'var(--radius-card)',
              background: 'var(--surface-sunken)',
              border: '1px solid var(--glass-edge)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon size={22} strokeWidth={1.75} style={{ color: 'var(--text-faint)' }} />
            </div>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{label}</span>
          </div>
        ))}
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ textAlign: 'center' }}>
        <span style={{
          display: 'inline-flex', height: 26, padding: '0 12px', alignItems: 'center',
          background: 'var(--surface-sunken)', borderRadius: 'var(--radius-pill)',
          fontSize: 'var(--fs-xs)', color: 'var(--text-faint)',
        }}>
          Скоро
        </span>
      </div>
    </div>
  );
}

// ── Переключатель режимов AI/Приложения — визуально и структурно клон ModeToggle/ModeButton
// из src/components/Hub.tsx (тот же --radius-pill/--surface-sunken/--shadow-chip рецепт), но
// на свои два варианта — отдельный компонент, не общий с Hub.tsx: aipanel.tsx живёт в изолированной
// WebContentsView со своим бандлом (см. vite.config.ts), общий импорт между entry-points не заведён.
function ModeToggle({ mode, onChange }: { mode: 'chat' | 'apps'; onChange: (m: 'chat' | 'apps') => void }) {
  return (
    <div style={{
      display: 'inline-flex', flex: 'none', padding: 3, gap: 2,
      background: 'var(--surface-sunken)', borderRadius: 'var(--radius-pill)',
      border: '1px solid var(--glass-edge)',
    }}>
      <ModeButton active={mode === 'chat'} onClick={() => onChange('chat')} icon={<Sparkles size={14} />} label="AI" />
      <ModeButton active={mode === 'apps'} onClick={() => onChange('apps')} icon={<LayoutGrid size={14} />} label="Приложения" />
    </div>
  );
}

function ModeButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: JSX.Element; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
        border: 'none', borderRadius: 'var(--radius-pill)', cursor: 'pointer',
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AiPanel />
  </React.StrictMode>,
);
