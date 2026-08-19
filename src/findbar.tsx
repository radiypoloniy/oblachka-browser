// FindBar (Ctrl+F) — отдельная WebContentsView поверх страницы, сверху по центру контентной
// зоны (см. electron/FindBarManager.ts). Персистентный view: не пересоздаётся на каждый показ
// (в отличие от поповера перевода), поэтому явно сбрасываем поле по сигналу onShow (панель открыта
// заново после close) и НЕ сбрасываем по onRefocus (Ctrl+F повторно, пока панель уже открыта —
// текст остаётся и выделяется, как в браузерах).
// Сам поиск (findInPage/findNext/stopFind, счётчик) не меняется — окно просто дёргает те же
// боевые IPC-каналы через свой мост (window.findbar), см. preload-findbar.ts.
import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { ChevronUp, ChevronDown, X, Sparkles } from 'lucide-react';
import './styles/global.css';
import type { FindResult, SmartFindResult } from '../shared/ipc';
import { installOverlayReveal } from './overlayReveal';

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

// ⚠️ Держать в синхроне с FINDBAR_WIDTH в electron/FindBarManager.ts — там ширина самой
// WebContentsView. Стало шире прежних 360: в панели прибавилась кнопка режима, а статус
// смыслового поиска — слово («не нашлось»), а не «3 / 12».
const BAR_WIDTH = 420;
const BAR_HEIGHT = 48;
// Держать в синхроне с SHADOW_MARGIN в electron/FindBarManager.ts — тот же паддинг инсетит
// панель обратно внутри увеличенной под тень WebContentsView (см. TranslatePopoverManager.ts).
const SHADOW_MARGIN = 20;
const SEARCH_DEBOUNCE = 250;

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
  const toggleSmart = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    void window.findbar.stop();
    setResult(null);
    setSmartFail(null);
    setQuotes([]);
    lastSmartRef.current = '';
    setSmart((v) => !v);
    inputRef.current?.focus();
  };

  const hasResults = quotes.length > 0 || (result !== null && result.count > 0);
  const noMatch = (query.trim() !== '' && result !== null && result.count === 0 && quotes.length === 0) || smartFail !== null;
  // ⚠️ В смысловом режиме счётчик показывает НАЙДЕННЫЕ ФРАГМЕНТЫ, а не совпадения подсвеченной
  // строки: человек спрашивал про места на странице, их и считаем.
  const statusText = smartBusy ? 'ищу…'
    : smartFail ? SMART_FAIL_TEXT[smartFail]
    : quotes.length > 0 ? `${quoteIdx + 1} / ${quotes.length}`
    : (query.trim() && result) ? (result.count === 0 ? 'нет' : `${result.activeMatch} / ${result.count}`)
    : '';

  return (
    // Прозрачный внешний паддинг — место для вытекания CSS box-shadow (см. SHADOW_MARGIN в
    // electron/FindBarManager.ts — сама WebContentsView увеличена на столько же).
    <div style={{ padding: SHADOW_MARGIN, boxSizing: 'border-box' }}>
      <div className="popover-card" style={{
        width: BAR_WIDTH, height: BAR_HEIGHT, boxSizing: 'border-box',
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '5px 6px',
        // ⚠️ МАТЕРИАЛ, а не плита: поповер — временный слой над землёй, и он обязан брать цвет
        // у того, что под ним. Белая непрозрачная карточка в цветном окне читается вырезанной из
        // другой программы — разбор общий, см. glassPlate в styles/island.ts.
        background: 'var(--material)',
        backdropFilter: 'var(--material-blur)',
        WebkitBackdropFilter: 'var(--material-blur)',
        boxShadow: 'var(--shadow-card)',
        borderRadius: 'var(--radius-card)',
        border: '1px solid var(--glass-edge)',
        userSelect: 'none',
        fontFamily: 'var(--font-sans)',
      }}>
        <button
          onClick={toggleSmart}
          title={smart ? 'Искать по смыслу — включено' : 'Искать по смыслу: спросите словами, где это на странице'}
          style={{
            ...btnStyle(false),
            // Акцент — активное состояние режима, ровно по цветовому закону дизайн-системы.
            background: smart ? 'var(--accent-soft)' : 'none',
            color: smart ? 'var(--accent)' : 'var(--text-muted)',
          }}
        >
          <Sparkles size={14} strokeWidth={2} />
        </button>
        <input
          ref={inputRef}
          type="text"
          autoFocus
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={smart ? 'Где на странице про…' : 'Найти на странице…'}
          style={{
            flex: 1, minWidth: 0,
            padding: '4px 8px',
            background: noMatch ? 'rgba(200,50,50,0.12)' : 'var(--surface-sunken)',
            border: '1px solid var(--glass-edge)',
            borderRadius: 'calc(var(--radius-card) / 2)',
            fontSize: 'var(--fs-sm)',
            color: 'var(--text-strong)',
            outline: 'none',
            transition: 'background 0.15s',
          }}
        />
        {statusText && (
          <span style={{
            fontSize: 'var(--fs-xs)',
            color: smartBusy ? 'var(--text-faint)' : noMatch ? 'rgba(200,50,50,0.8)' : 'var(--text-faint)',
            minWidth: 56,
            textAlign: 'center',
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}>
            {statusText}
          </span>
        )}
        <button
          onClick={() => (quotes.length > 0 ? goQuote(-1) : void window.findbar.next(false))}
          disabled={!hasResults}
          title={quotes.length > 0 ? 'Предыдущий фрагмент (Shift+Enter)' : 'Предыдущее (Shift+Enter)'}
          style={btnStyle(!hasResults)}
        >
          <ChevronUp size={14} strokeWidth={2} />
        </button>
        <button
          onClick={() => (quotes.length > 0 ? goQuote(1) : void window.findbar.next(true))}
          disabled={!hasResults}
          title={quotes.length > 0 ? 'Следующий фрагмент (Enter)' : 'Следующее (Enter)'}
          style={btnStyle(!hasResults)}
        >
          <ChevronDown size={14} strokeWidth={2} />
        </button>
        <button onClick={close} title="Закрыть (Esc)" style={btnStyle(false)}>
          <X size={14} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

function btnStyle(disabled: boolean): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 26, height: 26, flexShrink: 0,
    background: 'none', border: 'none',
    borderRadius: 'calc(var(--radius-card) / 2)',
    color: disabled ? 'var(--text-faint)' : 'var(--text-muted)',
    cursor: 'default',
    opacity: disabled ? 0.4 : 1,
    padding: 0,
  };
}

installOverlayReveal();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <FindBar />
  </React.StrictMode>,
);
