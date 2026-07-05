// Нативная вью дропдауна подсказок омнибокса (заход 4/5 переезда с chrome-DOM) — живой список
// + мышиный выбор (заход 3) + клавиатурная подсветка (эта). Омнибокс (Toolbar.tsx) — ЕДИНСТВЕННЫЙ
// владелец selectedIdx и списка; эта вью ничего не решает, только рисует подсветку по номеру,
// присланному через onHighlight. Enter выполняется ЛОКАЛЬНО в омнибоксе — эта вью в выборе по
// Enter не участвует вообще (только мышиный клик, как в заходе 3). Старый chrome-DOM дропдаун
// (Toolbar.tsx) работает параллельно и это не трогает.
// Позиция/размер задаёт main (setBounds, см. electron/SuggestDropdownManager.ts) — эта страница
// просто рисует контент на весь свой вьюпорт, инсетнутый на SHADOW_MARGIN под CSS-тень (тот же
// приём, что у поповера перевода/FindBar). Список внутри скроллится (maxHeight+overflowY) —
// та же логика, что у старого дропдауна (Toolbar.tsx: maxHeight:280), а не растёт вью под контент.
import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Search, Globe } from 'lucide-react';
import './styles/global.css';
import type { SuggestDropdownItem } from '../shared/ipc';

declare global {
  interface Window {
    suggestDropdown: {
      onItems: (cb: (items: SuggestDropdownItem[]) => void) => () => void
      pick: (item: SuggestDropdownItem) => void
      onHighlight: (cb: (idx: number) => void) => () => void
    }
  }
}

// Держать в синхроне с SHADOW_MARGIN в electron/SuggestDropdownManager.ts.
const SHADOW_MARGIN = 16;

function SuggestDropdown() {
  const [items, setItems] = useState<SuggestDropdownItem[]>([]);
  const [hoverIdx, setHoverIdx] = useState(-1);
  // Подсветка от клавиатуры (номер строки, -1 = нет) — приходит от омнибокса, единственного
  // владельца выбора. Приоритет над hover: пока клавиатура «активна» (!== -1), она главнее —
  // мышь возвращает себе приоритет, как только физически наводится на НОВУЮ строку (см.
  // onMouseEnter ниже — сбрасывает keyboardIdx локально, без обращения к омнибоксу).
  const [keyboardIdx, setKeyboardIdx] = useState(-1);

  useEffect(() => window.suggestDropdown.onItems(setItems), []);
  useEffect(() => window.suggestDropdown.onHighlight(setKeyboardIdx), []);

  const activeIdx = keyboardIdx !== -1 ? keyboardIdx : hoverIdx;

  return (
    <div style={{ padding: SHADOW_MARGIN, boxSizing: 'border-box' }}>
      <div style={{
        boxSizing: 'border-box',
        background: 'var(--surface-solid)',
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--shadow-island)',
        border: '1px solid var(--glass-edge)',
        overflow: 'hidden', maxHeight: 280, overflowY: 'auto',
        fontFamily: 'var(--font-sans)',
      }}>
        {items.map((item, idx) => {
          const Icon = item.kind === 'search' ? Search : Globe;
          return (
            <div
              key={`${item.kind}-${item.url}`}
              // onMouseDown (не onClick) — та же семантика, что у старого дропдауна (SuggestRow
              // в Toolbar.tsx): регистрирует выбор ДО возможного blur/потери фокуса у омнибокса.
              onMouseDown={() => window.suggestDropdown.pick(item)}
              onMouseEnter={() => { setHoverIdx(idx); setKeyboardIdx(-1); }}
              onMouseLeave={() => setHoverIdx((i) => (i === idx ? -1 : i))}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px',
                cursor: 'default', minWidth: 0,
                background: activeIdx === idx ? 'var(--surface-sunken)' : 'transparent',
                transition: 'background 0.08s',
              }}
            >
              <span style={{ color: 'var(--text-faint)', flex: 'none', display: 'inline-flex' }}>
                <Icon size={13} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 'var(--fs-sm)', color: 'var(--text-strong)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {item.label}
                </div>
                {item.sub && (
                  <div style={{
                    fontSize: 'var(--fs-xs)', color: 'var(--text-muted)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {item.sub}
                  </div>
                )}
              </div>
              {item.kind === 'tab' && (
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', flex: 'none' }}>
                  вкладка
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SuggestDropdown />
  </React.StrictMode>,
);
