// Нативная вью дропдауна омнибокса — ДВА режима в одной вью:
//
//  • режим СПИСКА (`items`) — человек что-то набрал: живой список + мышиный выбор + клавиатурная
//    подсветка. Ровно то, что было здесь всегда.
//  • режим ПАНЕЛИ (`panel`, заход 11) — человек щёлкнул в НЕТРОНУТУЮ строку и ещё ничего не
//    набрал: шапка текущего сайта, плитки часто посещаемых и «вы это уже читали».
//
// Омнибокс (Toolbar.tsx) — ЕДИНСТВЕННЫЙ владелец selectedIdx и содержимого; эта вью ничего не
// решает, только рисует присланное и подсвечивает по номеру из onHighlight. Enter выполняется
// ЛОКАЛЬНО в омнибоксе — вью в выборе по Enter не участвует вообще (только мышиный клик).
// ⚠️ Номера строк ПЛОСКИЕ и в режиме панели: сначала плитки, следом карточки «уже читали» — ровно
// тот же массив, что омнибокс держит в suggestions. Вью выводит номер из длины panel.sites и
// второго источника истины не заводит.
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
import { Lock, ShieldCheck, ShieldOff, Sparkles, ChevronRight, Camera, Mic, MapPin, Bell, Maximize, Clipboard, History, Pencil, Check, X, Plus, ExternalLink } from 'lucide-react';
import './styles/global.css';
import type { SuggestDropdownItem, OmniboxPanel, OmniboxRecommendEdit, PermKey } from '../shared/ipc';
import { siteLabel, plural, RowIcon, SitePlate } from './components/suggest/siteIcons';
import { installOverlayReveal } from './overlayReveal';
import { CAPS, DISPLAY_CARD, DISPLAY_ROW, RADIUS } from './styles/system';
// ⚠️ Поверхность оверлея — непрозрачная: карточка живёт в своей вью над страницей, где
// backdrop-filter не работает (разбор — --overlay-plate в styles/tokens/colors.css).
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

// ── Движение ──────────────────────────────────────────────────────────────────────────────────
// Карточка целиком проявляется через installOverlayReveal (общий приём всех оверлеев). Здесь —
// ВНУТРЕННЕЕ движение панели: плитки и карточки выезжают по очереди, а не возникают пластом.
// Задержка на элемент маленькая (18 мс): при восьми плитках это 144 мс на всю волну — читается
// как одно движение, а не как медленная анимация по одной.
// ⚠️ «Вы это уже читали» приезжает ПОЗЖЕ плиток (отдельный запрос к истории), то есть монтируется
// вторым рендером — своя волна ему достаётся автоматически, а уже нарисованные плитки при этом
// не перезапускаются: ключи у них стабильные, элементы не пересоздаются.
//
// ⚠️ КОЛОНОК ФИКСИРОВАННОЕ ЧИСЛО НА КАЖДОЙ ШИРИНЕ, а не auto-fit с 1fr. Прошлый заход растягивал
// дорожки по всей строке: на широком окне восемь значков расползались по двум тысячам пикселей, а
// единственная карточка «уже читали» превращалась в серую полосу во весь экран. Медиазапросы
// считают ВЬЮПОРТ вью, то есть ширину карточки плюс 2×SHADOW_MARGIN.
const PANEL_CSS = `
@keyframes omni-rise {
  from { opacity: 0; transform: translateY(6px) scale(0.97); }
  to   { opacity: 1; transform: none; }
}
/* ⚠️ fill-mode именно BACKWARDS, а не both. both удерживает конечный кадр анимации (transform:
   none) НАВСЕГДА, а анимационные значения в каскаде сильнее обычных объявлений — то есть подъём
   плитки под курсором не сработал бы никогда. backwards даёт ровно то, ради чего нужен fill:
   держит НАЧАЛЬНЫЙ кадр всё время задержки, чтобы плитка не мигала до своей очереди, — и
   отпускает элемент, как только волна прошла. */
.omni-rise {
  animation: omni-rise var(--dur-base) var(--ease-out, var(--ease-out)) backwards;
  animation-delay: calc(var(--i, 0) * 18ms);
}

/* Папки рядом, когда есть место, и стопкой, когда нет. Внутри папки — всегда четыре колонки:
   восемь сайтов ложатся ровным блоком 4×2, как в Табло.

   ⚠️ У ПАПКИ ЕСТЬ ПОТОЛОК ШИРИНЫ, и это не вкусовщина. Дропдаун повторяет ширину омнибокса и
   доходит до 1040 px; папка, растянутая на всю эту ширину, растягивала вместе с собой и четыре
   колонки — клетка раздувалась до полутора сотен пикселей при значке в 40, и блок читался как
   восемь иконок, раскиданных по цветному прямоугольнику («расстояние между иконками слишком
   большое»). Потолок держит клетку около 80 px, а лишняя ширина уходит в поля: контейнер тянется
   на всю колонку, содержимое — никогда. */
.omni-folders { display: grid; grid-template-columns: 1fr; gap: 0; }
/* ⚠️ ПОЛКА, А НЕ РАСТЯГИВАЕМАЯ СЕТКА. Клетка фиксированной ширины и значки идут слева — тогда
   расстояние между ними ОДНО И ТО ЖЕ при любой ширине окна. Прежняя сетка repeat(4, 1fr)
   растягивалась вместе с дропдауном (тот повторяет ширину омнибокса и доходит до 1040 px), клетка
   раздувалась до полутора сотен пикселей при значке в 44, и восемь иконок читались как раскиданные
   по цветному прямоугольнику. */
.omni-tiles { display: flex; flex-wrap: wrap; gap: 2px; }
.omni-tiles > * { width: 76px; }

.omni-cards { display: grid; grid-template-columns: 1fr; gap: 8px; }
@media (min-width: 560px)  { .omni-cards { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 820px)  { .omni-cards { grid-template-columns: repeat(3, 1fr); } }
@media (min-width: 1060px) { .omni-cards { grid-template-columns: repeat(4, 1fr); } }

/* Плитка: подсветка заливает ВСЮ клетку, а не только значок — клетка и есть цель клика, и
   попадать в неё мышью нужно всей площадью, а не 40 пикселями посередине. Подсветка на
   ПОКРАШЕННОМ фоне папки — это подмешанная белизна, а не отдельный серый: серый на тонированном
   фоне читается как грязь. */
.omni-tile {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 8px 2px 7px; border-radius: 10px; cursor: default; min-width: 0;
  background: transparent; position: relative;
  transition: background var(--dur-fast) ease;
}
.omni-plate { transition: transform var(--dur-fast) var(--ease-out, var(--ease-out)), box-shadow var(--dur-fast) ease; }
.omni-tile:hover { background: color-mix(in srgb, var(--surface) 60%, transparent); }
.omni-tile:hover .omni-plate { transform: translateY(-2px) scale(1.05); box-shadow: 0 6px 14px rgba(0,0,0,0.14); }
/* ⚠️ --selected, а НЕ --accent-soft. Мягкая доля акцента даёт к панели контраст 1,17 — её
   почти не видно, и в настройках её по этой причине уже заменили (см. selected() в system.ts).
   Здесь цена выше всего: по выдаче ходят СТРЕЛКАМИ, и невидимая подсветка означает, что человек
   не знает, что он сейчас выберет по Enter. */
.omni-tile[data-active="1"] { background: var(--selected); }
.omni-tile[data-active="1"] .omni-plate { box-shadow: 0 0 0 2px var(--accent); }
.omni-tile[data-active="1"] .omni-label { color: var(--text-strong); }

/* Значок правки поверх плашки. Появляется ТОЛЬКО в режиме карандаша — в обычном состоянии панель
   не должна быть усеяна крестиками. */
.omni-badge {
  position: absolute; top: 4px; right: 8px;
  width: 18px; height: 18px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--surface); box-shadow: var(--shadow-card); color: var(--text-muted);
  border: none; padding: 0; cursor: default;
  animation: omni-rise var(--dur-fast) var(--ease-out, var(--ease-out)) backwards;
}
.omni-badge:hover { color: var(--text-strong); }

/* ⚠️ ЗАЛИВКИ У НАБОРА БОЛЬШЕ НЕТ. Заливка в системе — язык акцента, и значит она ровно одно:
   «выбрано». Набор не выбран, он просто существует, поэтому разделять наборы — работа линии и
   заголовка, а два покрашенных прямоугольника были решением задачи, которой нет. */
.omni-folder { padding: 4px 2px 2px; }
.omni-folder + .omni-folder {
  margin-top: 10px; padding-top: 12px; border-top: 1px solid var(--divider);
}
.omni-folder-head {
  display: flex; align-items: center; gap: 8px; padding: 0 8px 6px;
  /* ⚠️ МОНОШИРИННЫЙ капс — тот же рецепт CAPS, что во всём остальном продукте. Раньше здесь была
     основная гарнитура в uppercase: единственный вид капители, набранный не тем шрифтом, и на
     фоне заголовков настроек и подписей плиток он читался как чужой. */
  font-family: var(--font-mono); font-size: 10.5px; font-weight: 500; color: var(--text-muted);
  text-transform: uppercase; letter-spacing: 0.15em;
}
.omni-pencil {
  margin-left: auto; display: inline-flex; align-items: center; gap: 4px;
  border: none; background: transparent; color: var(--text-faint);
  border-radius: 999px; padding: 3px 7px; cursor: default;
  font: inherit; font-size: var(--fs-xs); text-transform: none; letter-spacing: 0;
  transition: background var(--dur-fast) ease, color var(--dur-fast) ease;
}
.omni-pencil:hover { background: color-mix(in srgb, var(--surface) 70%, transparent); color: var(--text-body); }
.omni-pencil[data-on="1"] { background: var(--selected); color: var(--text-strong); }

.omni-card {
  display: flex; flex-direction: column; gap: 6px; min-width: 0;
  padding: 10px 12px; border-radius: 12px; cursor: default;
  border: 1px solid var(--glass-edge); background: var(--surface-sunken);
  transition: background var(--dur-fast) ease, transform var(--dur-fast) var(--ease-out, var(--ease-out)), box-shadow var(--dur-fast) ease;
}
.omni-card:hover { transform: translateY(-2px); box-shadow: 0 6px 14px rgba(0,0,0,0.10); }
.omni-card[data-active="1"] { background: var(--selected); border-color: var(--divider-strong); }

.omni-head { transition: background var(--dur-fast) ease; }
.omni-head:hover { background: var(--surface-sunken); }
.omni-head:hover .omni-chev { transform: translateX(2px); }
.omni-chev { transition: transform var(--dur-fast) var(--ease-out, var(--ease-out)); }

@media (prefers-reduced-motion: reduce) {
  .omni-rise { animation: none; }
  .omni-plate, .omni-card, .omni-chev { transition: none; }
  .omni-tile:hover .omni-plate, .omni-card:hover { transform: none; }
}
`;

const PERM_ICON: Record<PermKey, typeof Camera> = {
  'camera': Camera,
  'microphone': Mic,
  'camera+microphone': Camera,
  'external-app': ExternalLink,
  'geolocation': MapPin,
  'notifications': Bell,
  'fullscreen': Maximize,
  'clipboard-read': Clipboard,
  'clipboard-sanitized-write': Clipboard,
};

// Отбивка секции — тонкая, прописными, с воздухом сверху. Разделители ИНСЕТНЫЕ (не в край
// карточки): край режет карточку пополам, инсет читается как пауза между блоками — приём macOS.
function SectionLabel({ children, icon, divider }: {
  children: React.ReactNode; icon?: React.ReactNode; divider?: boolean;
}) {
  return (
    <div style={{ padding: divider ? '4px 16px 0' : 0 }}>
      {divider && <div style={{ height: 1, background: 'var(--glass-edge)' }} />}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: divider ? '12px 0 8px' : '14px 16px 8px',
        ...CAPS, color: 'var(--text-muted)',
      }}>
        {icon}{children}
      </div>
    </div>
  );
}

// Маленькая пилюля-показатель в шапке — тот же язык, что у пилюль тулбара.
function Pill({ children, tone }: { children: React.ReactNode; tone?: 'muted' | 'accent' }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, flex: 'none',
      height: 24, padding: '0 9px', borderRadius: RADIUS.pill,
      background: tone === 'accent' ? 'var(--accent-soft)' : 'var(--surface-sunken)',
      color: tone === 'accent' ? 'var(--accent)' : 'var(--text-muted)',
      fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  );
}

// ── Шапка: текущий сайт ───────────────────────────────────────────────────────────────────────
// Сводка того же, что показывает поповер замочка, и НИЧЕГО больше: значок сайта, имя, щит со
// счётчиком, значки уже выданных разрешений, фраза «изменилось с прошлого раза». Клик уводит в сам
// поповер — управление разрешениями остаётся в одном месте, иначе два экрана пришлось бы вечно
// держать в синхроне.
function SiteHeader({ site, url }: { site: NonNullable<OmniboxPanel['site']>; url: string }) {
  return (
    <div
      className="omni-head omni-rise"
      onMouseDown={() => window.suggestDropdown.openSiteInfo()}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 14px 12px 16px', cursor: 'default', minWidth: 0,
        borderBottom: '1px solid var(--glass-edge)',
      }}
    >
      <SitePlate url={url} size={34} radius={10} />
      <div style={{ minWidth: 0, flex: 1 }}>
        {/* ⚠️ Домен дисплейной 17-м — так же, как в поповере замочка. Эти два экрана показывают
            ОДНУ и ту же сводку одного и того же сайта (клик по шапке уводит в поповер), и
            расходиться в наборе им нельзя. */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5,
          ...DISPLAY_CARD,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {site.secure && <Lock size={12} style={{ flex: 'none', color: 'var(--text-faint)' }} />}
          {site.host}
        </div>
        {site.changed && (
          // Искра в акценте — единственное цветное пятно в шапке, и оно стоит там, где есть что
          // сказать. Отдельной пилюли «обновилось» рядом с самой фразой не заводим: это было бы
          // два раза об одном.
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5, marginTop: 2,
            fontSize: 'var(--fs-xs)', color: 'var(--text-muted)',
            overflow: 'hidden', whiteSpace: 'nowrap',
          }}>
            <Sparkles size={11} style={{ flex: 'none', color: 'var(--accent)' }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{site.changed}</span>
          </div>
        )}
      </div>
      {/* Показатели справа — пилюлями, а не строчкой текста: они разной природы (щит, разрешения),
          и в общей строке слипались бы в одну серую фразу. */}
      <Pill>
        {site.adblockOff
          ? <><ShieldOff size={12} /> без защиты</>
          : <><ShieldCheck size={12} style={{ color: 'var(--dot-local)' }} />
              {site.blocked} {plural(site.blocked, 'запрос', 'запроса', 'запросов')}</>}
      </Pill>
      {site.perms.length > 0 && (
        <Pill>
          {site.perms.map((p) => {
            const Icon = PERM_ICON[p];
            return <Icon key={p} size={12} />;
          })}
        </Pill>
      )}
      <ChevronRight className="omni-chev" size={16} style={{ flex: 'none', color: 'var(--text-faint)' }} />
    </div>
  );
}

// ── Плитка сайта в папке ──────────────────────────────────────────────────────────────────────
function SiteTile({ item, idx, active, editing, badge, onBadge, onHover, onLeave }: {
  item: SuggestDropdownItem; idx: number; active: boolean;
  editing: boolean; badge?: 'remove' | 'add'; onBadge?: () => void;
  onHover: (e: React.MouseEvent, idx: number) => void; onLeave: (idx: number) => void;
}) {
  return (
    <div
      className="omni-tile omni-rise"
      data-row={idx}
      data-active={active && !editing ? '1' : '0'}
      style={{ ['--i' as string]: idx }}
      // onMouseDown (не onClick) — регистрирует выбор ДО потенциального ухода фокуса у омнибокса.
      // ⚠️ В режиме правки плитка НЕ ведёт на сайт: человек сейчас собирает набор, и уход на
      // страницу посреди этого — потеря всей работы (панель закроется).
      onMouseDown={editing ? undefined : () => window.suggestDropdown.pick(item)}
      onMouseMove={(e) => onHover(e, idx)}
      onMouseLeave={() => onLeave(idx)}
      title={editing ? undefined : item.label}
    >
      {/* Значок крупнее прежних 40: в клетке с потолком ширины он держит блок плотным, а не
          плавает в её середине. */}
      <SitePlate url={item.url} size={44} radius={12} />
      <span className="omni-label" style={{
        maxWidth: '100%', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {siteLabel(item.url)}
      </span>
      {editing && badge && (
        <button
          className="omni-badge"
          title={badge === 'remove' ? 'Убрать из набора' : 'Добавить в набор'}
          onMouseDown={(e) => { e.stopPropagation(); onBadge?.(); }}
        >
          {badge === 'remove' ? <X size={11} /> : <Plus size={11} />}
        </button>
      )}
    </div>
  );
}

// ── Полка набора ──────────────────────────────────────────────────────────────────────────────
// Заголовок и ряд значков. Раньше это был ПОКРАШЕННЫЙ контейнер — цвет на фоне группы объяснял,
// что за набор. От цвета отказались: он говорил «выбрано» там, где ничего не выбрано (разбор — у
// .omni-folder в стилях выше), а набор различает заголовок.
function Folder({ title, action, children }: {
  title: string; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="omni-folder omni-rise">
      <div className="omni-folder-head">
        {title}
        {action}
      </div>
      <div className="omni-tiles">{children}</div>
    </section>
  );
}

// ── Карточка «вы это уже читали» ──────────────────────────────────────────────────────────────
function RelatedCard({ item, idx, active, onHover, onLeave }: {
  item: SuggestDropdownItem; idx: number; active: boolean;
  onHover: (e: React.MouseEvent, idx: number) => void; onLeave: (idx: number) => void;
}) {
  return (
    <div
      className="omni-card omni-rise"
      data-row={idx}
      data-active={active ? '1' : '0'}
      style={{ ['--i' as string]: idx }}
      onMouseDown={() => window.suggestDropdown.pick(item)}
      onMouseMove={(e) => onHover(e, idx)}
      onMouseLeave={() => onLeave(idx)}
      title={item.sub || item.label}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
        <SitePlate url={item.url} size={18} radius={6} />
        <span style={{
          fontSize: 'var(--fs-xs)', color: 'var(--text-faint)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {siteLabel(item.url)}
        </span>
      </div>
      <span style={{
        fontSize: 'var(--fs-sm)', color: 'var(--text-strong)', lineHeight: 1.35,
        // Две строки заголовка и не больше: карточки в ряду обязаны быть одной высоты, иначе ряд
        // рассыпается на лесенку.
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>
        {item.sub || item.label}
      </span>
    </div>
  );
}

// ── Режим панели ──────────────────────────────────────────────────────────────────────────────
function PanelView({ panel, activeIdx, editing, setEditing, onHover, onLeave }: {
  panel: OmniboxPanel; activeIdx: number;
  editing: boolean; setEditing: (v: boolean) => void;
  onHover: (e: React.MouseEvent, idx: number) => void; onLeave: (idx: number) => void;
}) {
  const related = panel.related ?? [];
  const picked = panel.recommended ?? [];
  const pickedUrls = new Set(picked.map((p) => p.url));
  const edit = (action: 'add' | 'remove', item: SuggestDropdownItem, title: string) =>
    window.suggestDropdown.editRecommended({ action, url: item.url, title });
  return (
    <>
      {panel.site && <SiteHeader site={panel.site} url={panel.siteUrl ?? ''} />}
      {(panel.sites.length > 0 || picked.length > 0) && (
        <div className="omni-folders" style={{ padding: '12px 14px 14px' }}>
          {panel.sites.length > 0 && (
            <Folder title="Часто посещаемые">
              {panel.sites.map((item, i) => (
                <SiteTile
                  key={item.url} item={item} idx={i}
                  active={activeIdx === i}
                  editing={editing}
                  // Уже в наборе — переносить нечего, значка не рисуем вовсе.
                  badge={pickedUrls.has(item.url) ? undefined : 'add'}
                  onBadge={() => edit('add', item, item.label)}
                  onHover={onHover} onLeave={onLeave}
                />
              ))}
            </Folder>
          )}
          <Folder
            title="Рекомендуемые"
            action={
              <button
                className="omni-pencil" data-on={editing ? '1' : '0'}
                title={editing ? 'Закончить правку' : 'Изменить набор'}
                onMouseDown={(e) => { e.stopPropagation(); setEditing(!editing); }}
              >
                {editing ? <><Check size={12} /> Готово</> : <Pencil size={12} />}
              </button>
            }
          >
            {picked.map((item, i) => (
              <SiteTile
                key={item.url} item={item} idx={panel.sites.length + i}
                active={activeIdx === panel.sites.length + i}
                editing={editing}
                badge="remove"
                onBadge={() => edit('remove', item, item.label)}
                onHover={onHover} onLeave={onLeave}
              />
            ))}
            {/* Опустошённый набор — не пустая дыра, а подсказка, как его наполнить обратно. */}
            {picked.length === 0 && (
              <div style={{
                width: '100%', padding: '10px 8px 12px',
                fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', lineHeight: 1.4,
              }}>
                {editing
                  ? 'Нажмите + на сайте слева, чтобы добавить его сюда'
                  : 'Набор пуст — карандаш соберёт его заново'}
              </div>
            )}
          </Folder>
        </div>
      )}
      {related.length > 0 && (
        <>
          <SectionLabel divider icon={<Sparkles size={12} style={{ color: 'var(--dot-local)' }} />}>
            Вы это уже читали
          </SectionLabel>
          <div className="omni-cards" style={{ padding: '0 16px 16px' }}>
            {related.map((item, i) => (
              <RelatedCard
                key={item.url}
                item={item}
                idx={panel.sites.length + picked.length + i}
                active={activeIdx === panel.sites.length + picked.length + i}
                onHover={onHover}
                onLeave={onLeave}
              />
            ))}
          </div>
        </>
      )}
      {/* Пустая история, пустой набор и нет открытого сайта — честная строка вместо пустой карточки. */}
      {!panel.site && panel.sites.length === 0 && picked.length === 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px',
          fontSize: 'var(--fs-sm)', color: 'var(--text-muted)',
        }}>
          <History size={15} style={{ color: 'var(--text-faint)' }} />
          Начните вводить адрес или запрос
        </div>
      )}
    </>
  );
}

// ── Режим списка ──────────────────────────────────────────────────────────────────────────────
function ListView({ items, activeIdx, onHover, onLeave }: {
  items: SuggestDropdownItem[]; activeIdx: number;
  onHover: (e: React.MouseEvent, idx: number) => void; onLeave: (idx: number) => void;
}) {
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
                  вкладка
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
    <SuggestDropdown />
  </React.StrictMode>,
);
