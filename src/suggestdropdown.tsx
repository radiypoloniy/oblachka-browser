// Нативная вью дропдауна омнибокса — ДВА режима в одной вью:
//
//  • режим СПИСКА (`items`) — человек что-то набрал: живой список + мышиный выбор + клавиатурная
//    подсветка. Ровно то, что было здесь всегда.
//  • режим ПАНЕЛИ (`panel`, заход 11) — человек щёлкнул в НЕТРОНУТУЮ строку и ещё ничего не
//    набрал: шапка текущего сайта, строки «Продолжить», плитки и «вы это уже читали».
//
// Омнибокс (Toolbar.tsx) — ЕДИНСТВЕННЫЙ владелец selectedIdx и содержимого; эта вью ничего не
// решает, только рисует присланное и подсвечивает по номеру из onHighlight. Enter выполняется
// ЛОКАЛЬНО в омнибоксе — вью в выборе по Enter не участвует вообще (только мышиный клик).
// ⚠️ Номера строк ПЛОСКИЕ и в режиме панели: сначала «Продолжить», следом карточки
// «уже читали» — ровно тот же массив, что омнибокс держит в suggestions. Плитки в него не
// входят. Вью выводит номер из длин panel.resume / panel.related и второго источника
// истины не заводит.
//
// Позиция задаёт main (setBounds, см. electron/SuggestDropdownManager.ts) — эта страница рисует
// контент на весь свой вьюпорт, инсетнутый на SHADOW_MARGIN под CSS-тень (тот же приём, что у
// поповера перевода/FindBar). ВЫСОТА вью следует за реальной высотой карточки (ResizeObserver →
// reportHeight → SuggestDropdownManager.ts пересчитывает bounds) — вью не должна накрывать пустым
// местом кнопки/контент под собой (pointer-события между разными WebContentsView не работают, см.
// прецедент AI-панели). MAX_HEIGHT — потолок самого КОНТЕНТА (длинный список продолжает
// скроллиться внутри), а не фиксированный размер вью.
import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { StandaloneLanguageProvider, useLanguage } from './i18n';
import './styles/global.css';
import type { SuggestDropdownItem, OmniboxPanel, OmniboxRecommendEdit } from '../shared/ipc';
import { RowIcon } from './components/suggest/siteIcons';
import { PanelView, PANEL_CSS } from './components/suggest/PanelView';
import { installOverlayReveal } from './overlayReveal';
import { DISPLAY_ROW } from './styles/system';
import { overlayPlate } from './styles/island';

declare global {
  interface Window {
    suggestDropdown: {
      onItems: (cb: (items: SuggestDropdownItem[]) => void) => () => void
      onPanel: (cb: (panel: OmniboxPanel) => void) => () => void
      pick: (item: SuggestDropdownItem) => void
      openSiteInfo: () => void
      editRecommended: (edit: OmniboxRecommendEdit) => void
      onHighlight: (cb: (idx: number) => void) => () => void
      reportHeight: (px: number) => void
      favicon: (host: string) => Promise<string | null>
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
// Потолок высоты КОНТЕНТА. ⚠️ Это не косметика: карточка — прямоугольник, который физически ловит
// мышь на всю свою площадь, поэтому чем она выше, тем больше страницы под ней недоступно. 520 —
// панель целиком (шапка + строка плиток + ряд карточек) без внутреннего скролла на обычной ширине;
// всё, что длиннее, скроллится внутри, а не растёт вью.
const MAX_HEIGHT = 520;

// ── Режим списка ──────────────────────────────────────────────────────────────────────────────
function ListView({ items, activeIdx, onHover, onLeave }: {
  items: SuggestDropdownItem[]; activeIdx: number;
  onHover: (e: React.MouseEvent, idx: number) => void; onLeave: (idx: number) => void;
}) {
  const { t } = useLanguage();
  return (
    <>
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
              data-row={idx} data-active={active ? '1' : '0'}
              // onMouseDown (не onClick) — регистрирует выбор ДО потенциального ухода фокуса у
              // омнибокса, а не после (см. закрытие без blur — Toolbar.tsx, заход 5).
              onMouseDown={() => window.suggestDropdown.pick(item)}
              onMouseMove={(e) => onHover(e, idx)}
              onMouseLeave={() => onLeave(idx)}
              style={{
                display: 'flex', alignItems: 'center', gap: isHero ? 12 : 10,
                padding: isHero ? '12px 14px' : '8px 14px',
                cursor: 'default', minWidth: 0,
                background: active ? 'var(--selected)' : (isHero ? 'var(--surface-sunken)' : 'transparent'),
                borderBottom: isHero ? '1px solid var(--glass-edge)' : 'none',
                transition: 'background 0.08s',
              }}
            >
              <RowIcon item={item} size={isHero ? 30 : 16} />
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* ⚠️ Герой — ДИСПЛЕЙНОЙ гарнитурой, остальные строки нет. Это ровно тот случай,
                    ради которого её держат: одно «лицо» выдачи в крупном кегле. В плотный набор
                    остальных строк она не заходит — там её мелкий кегль теряет читаемость. */}
                <div style={{
                  ...(isHero ? DISPLAY_ROW : { fontSize: 'var(--fs-sm)', fontWeight: 400 }),
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
                  {t('вкладка')}
                </span>
              )}
            </div>
          </React.Fragment>
        );
      })}
    </>
  );
}

function SuggestDropdown() {
  // Что показано сейчас. Один источник на оба режима: пришло последним — то и нарисовано, второго
  // состояния «а список всё ещё лежит рядом» не заводим (иначе однажды нарисуем не то, что просили).
  const [view, setView] = useState<
    | { kind: 'items'; items: SuggestDropdownItem[] }
    | { kind: 'panel'; panel: OmniboxPanel }
  >({ kind: 'items', items: [] });
  const [hoverIdx, setHoverIdx] = useState(-1);
  // Режим карандаша — состояние САМОЙ вью, а не часть присланной панели: он переживает дорисовку
  // («уже читали» приезжает вторым пакетом) и не требует лишнего круга через main.
  const [editing, setEditing] = useState(false);
  // Подсветка от клавиатуры (номер строки, -1 = нет) — приходит от омнибокса, единственного
  // владельца выбора. Приоритет над hover: пока клавиатура «активна» (!== -1), она главнее —
  // мышь возвращает себе приоритет ТОЛЬКО при реальном движении курсора (см. handleRowMouseMove
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

  useEffect(() => window.suggestDropdown.onItems((items) => setView({ kind: 'items', items })), []);
  useEffect(() => window.suggestDropdown.onPanel((panel) => setView({ kind: 'panel', panel })), []);
  useEffect(() => window.suggestDropdown.onHighlight(setKeyboardIdx), []);

  // ⚠️ Панель прячется скрытием ОКНА, компонент при этом жив (см. шапку overlayReveal.ts), поэтому
  // режим правки надо гасить руками — иначе он встретит человека в следующий раз, хотя тот про
  // него давно забыл. Скрытая вью честно сообщает document.hidden.
  useEffect(() => {
    const onVis = () => { if (document.hidden) setEditing(false); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // MAX_HEIGHT остаётся потолком КОНТЕНТА (внутренний скролл для длинного списка) — измеряем
  // реальный (уже упёршийся в этот потолок при необходимости) offsetHeight карточки.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const report = () => window.suggestDropdown.reportHeight(el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [view]);

  // ⚠️ Список длиннее MAX_HEIGHT прокручивается ВНУТРИ карточки, и без этого клавиатурная
  // подсветка уезжала за нижний край: строка честно подсвечена, но её не видно — со стороны это
  // выглядит как «стрелки перестали работать». Помогало наведение мышью, потому что оно ставит
  // подсветку на ВИДИМУЮ строку. Живая жалоба 01.09.2026.
  //
  // ⚠️ Только для клавиатуры. Прокрутка вслед за мышью утаскивала бы список из-под курсора: строка
  // под указателем уехала бы вверх, а на её место встала соседняя — и следующий щелчок ушёл бы не
  // туда, куда человек целился.
  //
  // ⚠️ 'nearest' и без плавности: доводит строку до ближайшего края, а не центрирует (центрирование
  // дёргало бы весь список на каждое нажатие), и успевает за быстрым удержанием стрелки.
  useEffect(() => {
    if (keyboardIdx < 0) return;
    cardRef.current?.querySelector(`[data-row="${keyboardIdx}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [keyboardIdx]);

  const activeIdx = keyboardIdx !== -1 ? keyboardIdx : hoverIdx;
  const dropHover = (idx: number) => setHoverIdx((i) => (i === idx ? -1 : i));

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
      <style>{PANEL_CSS}</style>
      <div ref={cardRef} style={{
        boxSizing: 'border-box',
        // ⚠️ Поверхность оверлея (непрозрачная), а не материал: карточка живёт в своей вью над
        // страницей, где backdrop-filter не работает вовсе. Разбор — --overlay-plate в colors.css.
        ...overlayPlate,
        borderRadius: 'var(--radius-card)',
        // --shadow-overlay (не --shadow-island/-pop) — см. рационал в tokens/shadows.css:
        // тяжёлая многослойная тень поверх прозрачной WebContentsView рендерится с жёсткими
        // краями на Windows/Chromium. Тот же токен — в translatepopover.tsx/aipanel.tsx.
        boxShadow: 'var(--shadow-overlay)',
        border: '1px solid var(--glass-edge)',
        overflow: 'hidden', maxHeight: MAX_HEIGHT, overflowY: 'auto',
        fontFamily: 'var(--font-sans)',
      }}>
        {view.kind === 'panel' ? (
          <PanelView
            panel={view.panel} activeIdx={activeIdx}
            editing={editing} setEditing={setEditing}
            onHover={handleRowMouseMove} onLeave={dropHover}
          />
        ) : (
          <ListView items={view.items} activeIdx={activeIdx} onHover={handleRowMouseMove} onLeave={dropHover} />
        )}
      </div>
    </div>
  );
}

installOverlayReveal();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <StandaloneLanguageProvider><SuggestDropdown /></StandaloneLanguageProvider>
  </React.StrictMode>,
);
