// Нативная вью дропдауна подсказок омнибокса — единственная система (заход 5: старый chrome-DOM
// дропдаун в Toolbar.tsx удалён) — живой список + мышиный выбор + клавиатурная подсветка. Омнибокс
// (Toolbar.tsx) — ЕДИНСТВЕННЫЙ владелец selectedIdx и списка; эта вью ничего не решает, только
// рисует подсветку по номеру, присланному через onHighlight. Enter выполняется ЛОКАЛЬНО в
// омнибоксе — эта вью в выборе по Enter не участвует вообще (только мышиный клик).
// Позиция задаёт main (setBounds, см. electron/SuggestDropdownManager.ts) — эта страница рисует
// контент на весь свой вьюпорт, инсетнутый на SHADOW_MARGIN под CSS-тень (тот же приём, что у
// поповера перевода/FindBar). Заход 5 (кардинальный фикс): ВЫСОТА вью следует за реальной высотой
// карточки (ResizeObserver → reportHeight → SuggestDropdownManager.ts пересчитывает bounds) —
// вью не должна накрывать пустым местом кнопки/контент под собой (pointer-events между разными
// WebContentsView не работает, см. прецедент AI-панели). maxHeight:280+overflowY — потолок самого
// КОНТЕНТА (длинный список продолжает скроллиться внутри), а не фиксированный размер вью.
import React, { useEffect, useRef, useState } from 'react';
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
      reportHeight: (px: number) => void
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
  // Заход 5 (кардинальный фикс): реальная высота карточки → main (SuggestDropdownManager.ts)
  // пересчитывает bounds вью ровно под список, а не под фиксированные 280px — устраняет мёртвую
  // хит-тест-зону (пустая площадь вью физически перехватывала клики по кнопкам/контенту под ней,
  // pointer-events здесь бессилен — подтверждено прецедентом AI-панели, только геометрия).
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => window.suggestDropdown.onItems(setItems), []);
  useEffect(() => window.suggestDropdown.onHighlight(setKeyboardIdx), []);

  // maxHeight:280 ниже остаётся потолком КОНТЕНТА (внутренний скролл для длинных списков) —
  // измеряем реальный (уже упёршийся в этот потолок при необходимости) offsetHeight карточки.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const report = () => window.suggestDropdown.reportHeight(el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [items]);

  const activeIdx = keyboardIdx !== -1 ? keyboardIdx : hoverIdx;

  return (
    <div style={{ padding: SHADOW_MARGIN, boxSizing: 'border-box' }}>
      <div ref={cardRef} style={{
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
              // onMouseDown (не onClick) — регистрирует выбор ДО потенциального ухода фокуса у
              // омнибокса, а не после (см. закрытие без blur — Toolbar.tsx, заход 5).
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
