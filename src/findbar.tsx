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
import type { FindResult } from '../shared/ipc';

declare global {
  interface Window {
    findbar: {
      search: (query: string, forward: boolean) => Promise<void>
      next: (forward: boolean) => Promise<void>
      stop: () => Promise<void>
      close: () => void
      onResult: (cb: (r: FindResult) => void) => () => void
      onShow: (cb: () => void) => () => void
      onRefocus: (cb: () => void) => () => void
    }
  }
}

const BAR_WIDTH = 360;
const BAR_HEIGHT = 48;
// Держать в синхроне с SHADOW_MARGIN в electron/FindBarManager.ts — тот же паддинг инсетит
// панель обратно внутри увеличенной под тень WebContentsView (см. TranslatePopoverManager.ts).
const SHADOW_MARGIN = 20;
const SEARCH_DEBOUNCE = 250;

function FindBar() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<FindResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsubResult = window.findbar.onResult((r) => setResult(r));
    const unsubShow = window.findbar.onShow(() => {
      setQuery('');
      setResult(null);
      inputRef.current?.focus();
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
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!v.trim()) {
      void window.findbar.stop();
      setResult(null);
      return;
    }
    debounceRef.current = setTimeout(() => { void window.findbar.search(v, true); }, SEARCH_DEBOUNCE);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      void window.findbar.next(!e.shiftKey); // Enter = вниз, Shift+Enter = вверх
    }
  };

  const hasResults = result !== null && result.count > 0;
  const noMatch = query.trim() !== '' && result !== null && result.count === 0;

  return (
    // Прозрачный внешний паддинг — место для вытекания CSS box-shadow (см. SHADOW_MARGIN в
    // electron/FindBarManager.ts — сама WebContentsView увеличена на столько же).
    <div style={{ padding: SHADOW_MARGIN, boxSizing: 'border-box' }}>
      <div style={{
        width: BAR_WIDTH, height: BAR_HEIGHT, boxSizing: 'border-box',
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '5px 6px',
        background: 'var(--surface-solid)',
        boxShadow: 'var(--shadow-card)',
        borderRadius: 'var(--radius-card)',
        border: '1px solid var(--glass-edge)',
        userSelect: 'none',
        fontFamily: 'var(--font-sans)',
      }}>
        <input
          ref={inputRef}
          type="text"
          autoFocus
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Найти на странице…"
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
        {query.trim() && result && (
          <span style={{
            fontSize: 'var(--fs-xs)',
            color: noMatch ? 'rgba(200,50,50,0.8)' : 'var(--text-faint)',
            minWidth: 48,
            textAlign: 'center',
            flexShrink: 0,
          }}>
            {noMatch ? 'нет' : `${result.activeMatch} / ${result.count}`}
          </span>
        )}
        <button
          onClick={() => void window.findbar.next(false)}
          disabled={!hasResults}
          title="Предыдущее (Shift+Enter)"
          style={btnStyle(!hasResults)}
        >
          <ChevronUp size={14} strokeWidth={2} />
        </button>
        <button
          onClick={() => void window.findbar.next(true)}
          disabled={!hasResults}
          title="Следующее (Enter)"
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <FindBar />
  </React.StrictMode>,
);
