// Тестовая нативная вью дропдауна подсказок омнибокса (заход 2/5 переезда с chrome-DOM) —
// статичный список, без клавиатуры, без реальных данных (заходы 3-4). Единственная цель этого
// захода: показ/позиционирование/НЕ-взятие-фокуса — старый chrome-DOM дропдаун (Toolbar.tsx)
// работает параллельно и это НЕ трогает.
// Позиция/размер задаёт main (setBounds, см. electron/SuggestDropdownManager.ts) — эта страница
// просто рисует контент на весь свой вьюпорт, инсетнутый на SHADOW_MARGIN под CSS-тень (тот же
// приём, что у поповера перевода/FindBar).
import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './styles/global.css';

declare global {
  interface Window {
    suggestDropdown: {
      onItems: (cb: (items: string[]) => void) => () => void
    }
  }
}

// Держать в синхроне с SHADOW_MARGIN в electron/SuggestDropdownManager.ts.
const SHADOW_MARGIN = 16;

function SuggestDropdown() {
  const [items, setItems] = useState<string[]>([]);

  useEffect(() => window.suggestDropdown.onItems(setItems), []);

  return (
    <div style={{ padding: SHADOW_MARGIN, boxSizing: 'border-box' }}>
      <div style={{
        boxSizing: 'border-box',
        background: 'var(--surface-solid)',
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--shadow-island)',
        border: '1px solid var(--glass-edge)',
        overflow: 'hidden',
        fontFamily: 'var(--font-sans)',
      }}>
        {items.map((item, idx) => (
          <div key={idx} style={{
            padding: '10px 14px',
            fontSize: 'var(--fs-sm)',
            color: 'var(--text-strong)',
            borderBottom: idx < items.length - 1 ? '1px solid var(--divider)' : 'none',
          }}>
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SuggestDropdown />
  </React.StrictMode>,
);
