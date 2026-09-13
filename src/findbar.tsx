// FindBar (Ctrl+F) — отдельная WebContentsView поверх страницы, сверху по центру контентной
// зоны (см. electron/FindBarManager.ts). Персистентный view: не пересоздаётся на каждый показ
// (в отличие от поповера перевода), поэтому явно сбрасываем поле по сигналу onShow (панель открыта
// заново после close) и НЕ сбрасываем по onRefocus (Ctrl+F повторно, пока панель уже открыта —
// текст остаётся и выделяется, как в браузерах).
// Сам поиск (findInPage/findNext/stopFind, счётчик) не меняется — окно просто дёргает те же
// боевые IPC-каналы через свой мост (window.findbar), см. preload-findbar.ts.
import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { ChevronUp, ChevronDown, X } from 'lucide-react';
import './styles/global.css';
import type { FindResult, SmartFindResult } from '../shared/ipc';
import { FINDBAR_MIN_HEIGHT, FINDBAR_WIDTH } from '../shared/overlayMetrics';
import { installOverlayReveal } from './overlayReveal';
// ⚠️ Поверхность оверлея — непрозрачная: карточка живёт в своей вью над страницей, где
// backdrop-filter не работает (разбор — --overlay-plate в styles/tokens/colors.css).
import { overlayPlate } from './styles/island';
import { ICON, NUMERIC, RADIUS, TEXT, glyph, motion, sp, well } from './styles/system';

declare global {
  interface Window {
    findbar: {
      search: (query: string, forward: boolean) => Promise<void>
      smart: (query: string) => Promise<SmartFindResult>
      smartShow: (quote: string) => Promise<number>
      next: (forward: boolean) => Promise<void>
      stop: () => Promise<void>
      close: () => void
      onResult: (cb: (r: FindResult) => void) => () => void
      onShow: (cb: (query: string) => void) => () => void
      onRefocus: (cb: () => void) => () => void
    }
  }
}

// Держать в синхроне с SHADOW_MARGIN в electron/FindBarManager.ts — тот же паддинг инсетит
// панель обратно внутри увеличенной под тень WebContentsView (см. TranslatePopoverManager.ts).
const SHADOW_MARGIN = 20;
const SEARCH_DEBOUNCE = 250;
const GLYPH = glyph(ICON.md);

// Что показываем на месте счётчика, пока идёт/провалился смысловой поиск. Отдельного окна с
// ответом нет намеренно: найденное человек видит НА СТРАНИЦЕ подсветкой, к которой её и
// прокрутило, — это и есть ответ, причём в контексте (см. SmartFindResult в shared/ipc.ts).
const SMART_FAIL_TEXT: Record<NonNullable<SmartFindResult['reason']>, string> = {
  'no-model': 'нет модели',
  'no-text': 'пусто',
  'not-found': 'не нашлось',
  busy: 'ищу…',
};

function FindBar() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<FindResult | null>(null);
  // Режим «по смыслу»: вопрос вместо подстроки, ответ ищет локальная модель (см. SmartFind.ts).
  // ⚠️ Липкий — переживает закрытие панели: режим человек выбрал сам, и сбрасывать его на каждый
  // Ctrl+F значило бы заставлять выбирать заново при каждом обращении.
  const [smart, setSmart] = useState(false);
  const [smartBusy, setSmartBusy] = useState(false);
  const [smartFail, setSmartFail] = useState<NonNullable<SmartFindResult['reason']> | null>(null);
  // Найденные фрагменты и тот, что показан сейчас. ⚠️ В смысловом режиме стрелки листают
  // ФРАГМЕНТЫ, а не совпадения одной строки: человек спросил «где про фэнтези» на подборке игр —
  // ему нужны все подходящие места, а не второе вхождение одного и того же слова.
  const [quotes, setQuotes] = useState<string[]>([]);
  const [quoteIdx, setQuoteIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Последний вопрос, на который смысловой поиск уже отвечал: повторный Enter должен листать
  // совпадения, а не гонять модель заново с тем же текстом.
  const lastSmartRef = useRef('');

  useEffect(() => {
    const unsubResult = window.findbar.onResult((r) => setResult(r));
    // ⚠️ query непустой, когда панель открыл код с уже поставленной подсветкой (переход к
    // источнику скопированного). Поиск по нему НЕ запускаем: он уже выполнен, а повторный вызов с
    // тем же запросом означает «следующее совпадение» — человека увезло бы с найденного места.
    // Счётчик в этом случае присылает main отдельным FIND_RESULT.
    const unsubShow = window.findbar.onShow((query) => {
      setQuery(query);
      setResult(null);
      setSmartFail(null);
      setQuotes([]);
      setQuoteIdx(0);
      lastSmartRef.current = '';
      inputRef.current?.focus();
      // Выделяем готовый запрос целиком: следующая же буква заменит его, как при повторном Ctrl+F.
      if (query) inputRef.current?.select();
    });
    const unsubRefocus = window.findbar.onRefocus(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => { unsubResult(); unsubShow(); unsubRefocus(); };
  }, []);

  const close = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    void window.findbar.stop();
    window.findbar.close();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    setSmartFail(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // В смысловом режиме на каждую букву ничего не запускаем: это генерация, а не подстрока.
    // Ищем по Enter — то же правило, по которому фоновые фичи не дёргают модель при наборе.
    if (smart) {
      // Поле опустошили — снимаем подсветку прошлого ответа: она относилась к стёртому вопросу.
      if (!v.trim()) {
        void window.findbar.stop();
        setResult(null);
        setQuotes([]);
        lastSmartRef.current = '';
      }
      return;
    }
    if (!v.trim()) {
      void window.findbar.stop();
      setResult(null);
      return;
    }
    debounceRef.current = setTimeout(() => { void window.findbar.search(v, true); }, SEARCH_DEBOUNCE);
  };

  const runSmart = async () => {
    const q = query.trim();
    if (!q || smartBusy) return;
    setSmartBusy(true);
    setSmartFail(null);
    setResult(null);
    setQuotes([]);
    try {
      const res = await window.findbar.smart(q);
      // Успех рисовать нечем: main уже подсветил первую цитату на странице и прокрутил к ней.
      // Панель запоминает список, чтобы стрелки листали остальные.
      if (res.ok) {
        lastSmartRef.current = q;
        setQuotes(res.quotes ?? []);
        setQuoteIdx(0);
      } else {
        setSmartFail(res.reason ?? 'not-found');
      }
    } catch {
      setSmartFail('no-model');
    } finally {
      setSmartBusy(false);
    }
  };

  // Листание найденных фрагментов. По кругу — как обычный поиск по странице.
  const goQuote = (delta: number) => {
    if (quotes.length === 0) return;
    const next = (quoteIdx + delta + quotes.length) % quotes.length;
    setQuoteIdx(next);
    void window.findbar.smartShow(quotes[next]!);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    // В смысловом режиме Enter — это «спросить», но только на НОВЫЙ вопрос. Если текст с прошлого
    // раза не менялся, человек листает найденное, а не переспрашивает (переспрос стоил бы прогона
    // модели и вернул бы тот же фрагмент).
    if (smart && query.trim() !== lastSmartRef.current) {
      void runSmart();
      return;
    }
    // В смысловом режиме Enter листает НАЙДЕННЫЕ ФРАГМЕНТЫ, а не совпадения одной строки.
    if (smart && quotes.length > 0) {
      goQuote(e.shiftKey ? -1 : 1);
      return;
    }
    void window.findbar.next(!e.shiftKey); // Enter = вниз, Shift+Enter = вверх
  };

  // Смена режима — это смена смысла введённого текста, поэтому прежняя подсветка снимается:
  // «возврат денег» как подстрока и как вопрос дают разные места на странице.
  const setSmartMode = (next: boolean) => {
    if (next === smart) { inputRef.current?.focus(); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    void window.findbar.stop();
    setResult(null);
    setSmartFail(null);
    setQuotes([]);
    lastSmartRef.current = '';
    setSmart(next);
    inputRef.current?.focus();
  };

  const hasResults = quotes.length > 0 || (result !== null && result.count > 0);
  const noMatch = (query.trim() !== '' && result !== null && result.count === 0 && quotes.length === 0) || smartFail !== null;
  const statusText = smartBusy ? 'ищу…'
    : smartFail ? SMART_FAIL_TEXT[smartFail]
    : quotes.length > 0 ? `${quoteIdx + 1} / ${quotes.length}`
    : (query.trim() && result) ? (result.count === 0 ? 'нет' : `${result.activeMatch} / ${result.count}`)
    : '';

  return (
    <FindBarChrome
      inputRef={inputRef}
      query={query}
      smart={smart}
      smartBusy={smartBusy}
      noMatch={noMatch}
      statusText={statusText}
      hasResults={hasResults}
      quotesLen={quotes.length}
      onQuery={handleChange}
      onKeyDown={handleKeyDown}
      onMode={setSmartMode}
      onPrev={() => (quotes.length > 0 ? goQuote(-1) : void window.findbar.next(false))}
      onNext={() => (quotes.length > 0 ? goQuote(1) : void window.findbar.next(true))}
      onClose={close}
    />
  );
}

function FindBarChrome(p: {
  inputRef: React.RefObject<HTMLInputElement>
  query: string
  smart: boolean
  smartBusy: boolean
  noMatch: boolean
  statusText: string
  hasResults: boolean
  quotesLen: number
  onQuery: (e: React.ChangeEvent<HTMLInputElement>) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onMode: (smart: boolean) => void
  onPrev: () => void
  onNext: () => void
  onClose: () => void
}) {
  return (
    // Прозрачный внешний паддинг — место для вытекания CSS box-shadow (см. SHADOW_MARGIN в
    // electron/FindBarManager.ts — сама WebContentsView увеличена на столько же).
    <div style={{ padding: SHADOW_MARGIN, boxSizing: 'border-box' }}>
      <div style={{
        width: FINDBAR_WIDTH, boxSizing: 'border-box', minWidth: 0,
        display: 'flex', alignItems: 'center', gap: sp(2),
        padding: `${sp(2)}px ${sp(2)}px ${sp(2)}px ${sp(2) - 2}px`,
        minHeight: FINDBAR_MIN_HEIGHT,
        ...overlayPlate,
        boxShadow: 'var(--shadow-card)',
        borderRadius: RADIUS.island,
        overflow: 'hidden',
        userSelect: 'none',
        fontFamily: 'var(--font-sans)',
      }}>
        <ModeSeg smart={p.smart} onMode={p.onMode} />
        <input
          ref={p.inputRef}
          type="text"
          autoFocus
          value={p.query}
          onChange={p.onQuery}
          onKeyDown={p.onKeyDown}
          placeholder={p.smart ? 'Где на странице про…' : 'Найти на странице…'}
          style={{
            flex: 1, minWidth: 0, height: 36, padding: `0 ${sp(2)}px`,
            background: 'transparent', border: 'none',
            ...TEXT.section, fontWeight: 500, color: 'var(--text-strong)',
            outline: 'none',
          }}
        />
        {p.statusText ? (
          <span style={{
            ...TEXT.caption, ...NUMERIC, fontFamily: 'var(--font-mono)', fontWeight: 500,
            padding: `${sp(1)}px ${sp(2)}px`, borderRadius: RADIUS.pill, flexShrink: 0,
            background: p.noMatch ? 'transparent' : 'var(--surface-sunken)',
            color: p.smartBusy ? 'var(--text-faint)' : p.noMatch ? 'var(--danger-500)' : 'var(--text-strong)',
          }}>
            {p.statusText}
          </span>
        ) : null}
        <button
          type="button"
          className="findbar-btn"
          onClick={p.onPrev}
          disabled={!p.hasResults}
          title={p.quotesLen > 0 ? 'Предыдущий фрагмент (Shift+Enter)' : 'Предыдущее (Shift+Enter)'}
        >
          <ChevronUp {...GLYPH} />
        </button>
        <button
          type="button"
          className="findbar-btn"
          onClick={p.onNext}
          disabled={!p.hasResults}
          title={p.quotesLen > 0 ? 'Следующий фрагмент (Enter)' : 'Следующее (Enter)'}
        >
          <ChevronDown {...GLYPH} />
        </button>
        <button type="button" className="findbar-btn" onClick={p.onClose} title="Закрыть (Esc)">
          <X {...GLYPH} />
        </button>
      </div>
    </div>
  );
}

function ModeSeg({ smart, onMode }: { smart: boolean; onMode: (smart: boolean) => void }) {
  // Компактнее настроечного SegTrack: кегль подписи и узкие поля, чтобы пилюля не спорила с набором.
  const btn = (on: boolean): React.CSSProperties => ({
    ...TEXT.caption, fontWeight: on ? 600 : 500, border: 'none', cursor: 'default',
    padding: `${sp(1) - 1}px ${sp(2)}px`, borderRadius: RADIUS.pill,
    background: on ? 'var(--accent)' : 'transparent',
    color: on ? 'var(--on-accent)' : 'var(--text-muted)',
    transition: motion.state('background', 'color'),
  });
  return (
    <div role="tablist" aria-label="Режим поиска" style={{
      display: 'flex', gap: 1, padding: 2, flexShrink: 0, ...well(RADIUS.pill),
    }}>
      <button type="button" role="tab" aria-selected={!smart} aria-pressed={!smart} onClick={() => onMode(false)} style={btn(!smart)}>Текст</button>
      <button type="button" role="tab" aria-selected={smart} aria-pressed={smart} onClick={() => onMode(true)} style={btn(smart)}>Смысл</button>
    </div>
  );
}

installOverlayReveal();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <FindBar />
  </React.StrictMode>,
);
