// Нативная вью дропдауна подсказок омнибокса — единственная система (заход 5: старый chrome-DOM
// дропдаун в Toolbar.tsx удалён) — живой список + мышиный выбор + клавиатурная подсветка. Омнибокс
// (Toolbar.tsx) — ЕДИНСТВЕННЫЙ владелец selectedIdx и списка; эта вью ничего не решает, только
// рисует подсветку по номеру, присланному через onHighlight. Enter выполняется ЛОКАЛЬНО в
// омнибоксе — эта вью в выборе по Enter не участвует вообще (только мышиный клик).
// Позиция задаёт main (setBounds, см. electron/SuggestDropdownManager.ts) — эта страница рисует
// контент на весь свой вьюпорт, инсетнутый на SHADOW_MARGIN под CSS-тень (тот же приём, что у
// поповера перевода/FindBar). Заход 5 (кардинальный фикс): ВЫСОТА вью следует за реальной высотой
// карточки (ResizeObserver → reportHeight → SuggestDropdownManager.ts пересчитывает bounds) —
// вью не должна накрывать пустым местом кнопки/контент под собой (pointer-события между разными
// WebContentsView не работают, см. прецедент AI-панели). maxHeight+overflowY — потолок самого
// КОНТЕНТА (длинный список продолжает скроллиться внутри), а не фиксированный размер вью. Порог —
// с запасом под полный SUGGEST_MAX=8 (Toolbar.tsx) плюс герой плюс 2 подписи секций, чтобы обычно
// вообще не приходилось скроллить (живой фидбэк — карточка казалась мельче, чем нужно).
import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Search, Globe } from 'lucide-react';
import './styles/global.css';
import type { SuggestDropdownItem } from '../shared/ipc';
import { installOverlayReveal } from './overlayReveal';

// Фавикон строки — тот же приём, что TileCard в Hub.tsx (`${origin}/favicon.ico` + onError-
// фолбэк на генерик-иконку): никакой новой инфраструктуры/IPC, страница просто пробует
// стандартный путь к иконке сайта сама. search/suggest — не страницы, для них фавикона в
// принципе не существует, там остаётся иконка-лупа, как и раньше.
function originOf(url: string): string | null {
  try { return new URL(url).origin; } catch { return null; }
}

function RowIcon({ item, size }: { item: SuggestDropdownItem; size: number }) {
  const isSearchLike = item.kind === 'search' || item.kind === 'suggest';
  const [ok, setOk] = useState(true);
  const origin = isSearchLike ? null : originOf(item.url);
  if (isSearchLike || !origin || !ok) {
    const Icon = isSearchLike ? Search : Globe;
    return (
      <span style={{
        width: size, height: size, flex: 'none',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-faint)',
      }}>
        <Icon size={Math.round(size * 0.62)} />
      </span>
    );
  }
  return (
    <img
      src={`${origin}/favicon.ico`}
      alt=""
      width={size} height={size}
      style={{ borderRadius: 4, display: 'block', flex: 'none' }}
      onError={() => setOk(false)}
    />
  );
}

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

// Держать в синхроне с SHADOW_MARGIN в electron/SuggestDropdownManager.ts. 40 — с запасом покрывает
// реальный охват тени карточки ниже (offset+blur = 10+28 = 38px), иначе WebContentsView обрезает
// хвост тени по своей границе (тот самый «угловатый прямоугольник» вместо мягкой тени).
const SHADOW_MARGIN = 40;
// ⚠️ Сверху запас ДРУГОЙ и обязан совпадать с GAP/SHADOW_TOP в SuggestDropdownManager.ts. Прозрачные
// поля вокруг карточки ловят мышь всем прямоугольником, поэтому запас в 40 сверху накрывал адресную
// строку целиком — и текст в ней нельзя было выделить мышью вовсе. Подробный разбор — там же.
const SHADOW_TOP = 8;

function SuggestDropdown() {
  const [items, setItems] = useState<SuggestDropdownItem[]>([]);
  const [hoverIdx, setHoverIdx] = useState(-1);
  // Подсветка от клавиатуры (номер строки, -1 = нет) — приходит от омнибокса, единственного
  // владельца выбора. Приоритет над hover: пока клавиатура «активна» (!== -1), она главнее —
  // мышь возвращает себе приоритет ТОЛЬКО при реальном движении курсора (см. handleMouseMove
  // и lastMousePosRef ниже — не onMouseEnter/onMouseLeave, заход 6).
  const [keyboardIdx, setKeyboardIdx] = useState(-1);
  // Заход 6 (фикс подсветки): onMouseEnter/onMouseLeave — ПРОИЗВОДНЫЕ события хит-теста,
  // браузер пересчитывает их заново при любом реflow под НЕПОДВИЖНЫМ курсором (например, вью
  // чуть сдвинулась/переразмерилась после setBounds от suggest-dropdown:height) — то есть могут
  // «спонтанно» сработать без реального движения мыши, гася клавиатурную подсветку мгновенно
  // после ArrowDown/ArrowUp. mousemove же браузер синтезирует ТОЛЬКО из настоящего input-события
  // ОС — на reflow сам по себе никогда не срабатывает. Поэтому передачу приоритета мыши держим
  // на mousemove с явной проверкой изменения координат, а не на enter/leave.
  const lastMousePosRef = useRef<{ x: number; y: number } | null>(null);
  // Заход 5 (кардинальный фикс): реальная высота карточки → main (SuggestDropdownManager.ts)
  // пересчитывает bounds вью ровно под список, а не под фиксированные 280px — устраняет мёртвую
  // хит-тест-зону (пустая площадь вью физически перехватывала клики по кнопкам/контенту под ней,
  // pointer-events здесь бессилен — подтверждено прецедентом AI-панели, только геометрия).
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => window.suggestDropdown.onItems(setItems), []);
  useEffect(() => window.suggestDropdown.onHighlight(setKeyboardIdx), []);

  // maxHeight:460 ниже остаётся потолком КОНТЕНТА (внутренний скролл для длинных списков) —
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

  // Реальное движение курсора (не reflow-синтезированное enter/leave) — единственный сигнал,
  // который отбирает подсветку у клавиатуры обратно мыши. Сверяем координаты, а не полагаемся
  // просто на факт события mousemove — на всякий случай, если браузер когда-либо всё же
  // синтезирует его без изменения позиции.
  const handleRowMouseMove = (e: React.MouseEvent, idx: number) => {
    const { clientX: x, clientY: y } = e;
    const last = lastMousePosRef.current;
    lastMousePosRef.current = { x, y };
    if (last && last.x === x && last.y === y) return;
    setHoverIdx(idx);
    setKeyboardIdx(-1);
  };

  return (
    <div style={{ padding: `${SHADOW_TOP}px ${SHADOW_MARGIN}px ${SHADOW_MARGIN}px`, boxSizing: 'border-box' }}>
      <div ref={cardRef} style={{
        boxSizing: 'border-box',
        background: 'var(--surface-solid)',
        borderRadius: 'var(--radius-card)',
        // --shadow-overlay (не --shadow-island/-pop) — см. рационал в tokens/shadows.css:
        // тяжёлая многослойная тень поверх прозрачной WebContentsView рендерится с жёсткими
        // краями на Windows/Chromium. Тот же токен — в translatepopover.tsx/aipanel.tsx.
        boxShadow: 'var(--shadow-overlay)',
        border: '1px solid var(--glass-edge)',
        overflow: 'hidden', maxHeight: 460, overflowY: 'auto',
        fontFamily: 'var(--font-sans)',
      }}>
        {items.map((item, idx) => {
          // «Герой» — самый релевантный вариант (Toolbar.tsx кладёт его первым в списке, СРАЗУ
          // за ним — «искать в вебе», см. живое сравнение с Яндекс.Браузером). Поисковые пункты
          // (search/suggest) в позиции 0 не бывает представителя истории/вкладки — тогда это
          // сам поиск, увеличенная карточка ему не идёт (нечего в ней показывать крупно).
          const isHero = idx === 0 && item.kind !== 'search' && item.kind !== 'suggest';
          const active = activeIdx === idx;
          // label у нас исторически = URL, sub = заголовок (см. Toolbar.tsx::buildSuggestions) —
          // здесь разворачиваем порядок показа: крупным/жирным — читаемый заголовок (если есть),
          // мелким — сам адрес, как у Chrome/Яндекса. Для search/suggest (sub нет) остаётся как есть.
          const primary = item.sub || item.label;
          const secondary = item.sub ? item.label : undefined;
          return (
            <React.Fragment key={`${item.kind}-${item.url}`}>
              {item.sectionHeader && (
                <div style={{
                  padding: '10px 14px 4px',
                  fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--text-faint)',
                  textTransform: 'uppercase', letterSpacing: '0.03em',
                  // Разделитель ТОЛЬКО если это не самая первая строка списка — иначе полоска
                  // повисла бы над пустым местом ещё до первого реального ряда.
                  borderTop: idx > 0 ? '1px solid var(--glass-edge)' : 'none',
                  marginTop: idx > 0 ? 4 : 0,
                }}>
                  {item.sectionHeader}
                </div>
              )}
            <div
              // onMouseDown (не onClick) — регистрирует выбор ДО потенциального ухода фокуса у
              // омнибокса, а не после (см. закрытие без blur — Toolbar.tsx, заход 5).
              onMouseDown={() => window.suggestDropdown.pick(item)}
              onMouseMove={(e) => handleRowMouseMove(e, idx)}
              onMouseLeave={() => setHoverIdx((i) => (i === idx ? -1 : i))}
              style={{
                display: 'flex', alignItems: 'center', gap: isHero ? 12 : 10,
                padding: isHero ? '12px 14px' : '8px 14px',
                cursor: 'default', minWidth: 0,
                background: active ? 'var(--accent-soft)' : (isHero ? 'var(--surface-sunken)' : 'transparent'),
                borderBottom: isHero ? '1px solid var(--glass-edge)' : 'none',
                transition: 'background 0.08s',
              }}
            >
              <RowIcon item={item} size={isHero ? 30 : 16} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: isHero ? 'var(--fs-md)' : 'var(--fs-sm)',
                  fontWeight: isHero ? 600 : 400,
                  color: 'var(--text-strong)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {primary}
                </div>
                {secondary && (
                  <div style={{
                    fontSize: 'var(--fs-xs)',
                    color: isHero ? 'var(--accent)' : 'var(--text-muted)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {secondary}
                  </div>
                )}
              </div>
              {item.kind === 'tab' && (
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', flex: 'none' }}>
                  вкладка
                </span>
              )}
            </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

installOverlayReveal();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SuggestDropdown />
  </React.StrictMode>,
);
