import React from 'react';
import { Lock, ShieldCheck, ShieldOff, Sparkles, ChevronRight, Camera, Mic, MapPin, Bell, Maximize, Clipboard, History, Pencil, Check, X, Plus, ExternalLink, RotateCcw } from 'lucide-react';
import type { SuggestDropdownItem, OmniboxPanel, PermKey } from '../../../shared/ipc';
import { siteLabel, plural, SitePlate, hostOf } from './siteIcons';
import { CAPS, DISPLAY_CARD, RADIUS } from '../../styles/system';

// Режим панели омнибокса. Вынесено из suggestdropdown.tsx по счёту храповика: строки «Продолжить»
// не влезали в файл из базы, а этот кусок — сам режим, без клавиатуры и без списка набора.

export const PANEL_CSS = `
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

.omni-resume-row {
  display: grid; grid-template-columns: 22px minmax(0,1fr) auto; gap: 12px; align-items: center;
  padding: 8px 16px; cursor: default;
  transition: background var(--dur-fast) ease;
}
.omni-resume-row:hover,
.omni-resume-row[data-active="1"] { background: var(--selected); }
.omni-meta {
  font-family: var(--font-mono); font-size: 10.5px; color: var(--text-faint); white-space: nowrap;
}
.omni-tag {
  font-family: var(--font-mono); font-size: 9.5px; letter-spacing: 0.06em; text-transform: uppercase;
  padding: 2px 6px; border-radius: 4px; border: 1px solid var(--divider-strong); color: var(--text-faint);
}

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

function SiteTile({ item, idx, active, editing, badge, onBadge, onHover, onLeave }: {
  item: SuggestDropdownItem; idx: number; active: boolean;
  editing: boolean; badge?: 'remove' | 'add'; onBadge?: () => void;
  onHover: (e: React.MouseEvent, idx: number) => void; onLeave: (idx: number) => void;
}) {
  return (
    <div
      className="omni-tile omni-rise"
      data-row={idx >= 0 ? idx : undefined}
      data-active={active && !editing ? '1' : '0'}
      style={{ ['--i' as string]: Math.max(idx, 0) }}
      onMouseDown={editing ? undefined : () => window.suggestDropdown.pick(item)}
      onMouseMove={(e) => onHover(e, idx)}
      onMouseLeave={() => onLeave(idx)}
      title={editing ? undefined : item.label}
    >
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
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>
        {item.sub || item.label}
      </span>
    </div>
  );
}

function ResumeRow({ item, idx, active, onHover, onLeave }: {
  item: SuggestDropdownItem; idx: number; active: boolean;
  onHover: (e: React.MouseEvent, idx: number) => void; onLeave: (idx: number) => void;
}) {
  const title = item.sub || item.label;
  return (
    <div
      className="omni-resume-row omni-rise"
      data-row={idx}
      data-active={active ? '1' : '0'}
      style={{ ['--i' as string]: idx }}
      onMouseDown={() => window.suggestDropdown.pick(item)}
      onMouseMove={(e) => onHover(e, idx)}
      onMouseLeave={() => onLeave(idx)}
      title={title}
    >
      <SitePlate url={item.url} size={22} radius={7} />
      <span style={{ minWidth: 0 }}>
        <span style={{
          display: 'block', fontSize: 'var(--fs-sm)', color: 'var(--text-strong)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {title}
        </span>
        <span style={{
          display: 'block', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {hostOf(item.url)}
        </span>
      </span>
      {item.meta && (item.tagged
        ? <span className="omni-tag">{item.meta}</span>
        : <span className="omni-meta">{item.meta}</span>)}
    </div>
  );
}

export function PanelView({ panel, activeIdx, editing, setEditing, onHover, onLeave }: {
  panel: OmniboxPanel; activeIdx: number;
  editing: boolean; setEditing: (v: boolean) => void;
  onHover: (e: React.MouseEvent, idx: number) => void; onLeave: (idx: number) => void;
}) {
  const resume = panel.resume ?? [];
  const related = panel.related ?? [];
  const picked = panel.recommended ?? [];
  const rel0 = resume.length;
  const pickedUrls = new Set(picked.map((p) => p.url));
  const edit = (action: 'add' | 'remove', item: SuggestDropdownItem, title: string) =>
    window.suggestDropdown.editRecommended({ action, url: item.url, title });
  const clearKeys = (e: React.MouseEvent) => onHover(e, -1);
  return (
    <>
      {panel.site && <SiteHeader site={panel.site} url={panel.siteUrl ?? ''} />}
      {resume.length > 0 && (
        <>
          <SectionLabel icon={<RotateCcw size={12} />}>Продолжить</SectionLabel>
          {resume.map((item, i) => (
            <ResumeRow
              key={`${item.kind}-${item.tabId ?? item.url}`}
              item={item} idx={i} active={activeIdx === i}
              onHover={onHover} onLeave={onLeave}
            />
          ))}
        </>
      )}
      {(panel.sites.length > 0 || picked.length > 0) && (
        <div className="omni-folders" style={{ padding: '12px 14px 14px' }}>
          <Folder
            title="Часто"
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
            {panel.sites.map((item) => (
              <SiteTile
                key={item.url} item={item} idx={-1}
                active={false}
                editing={editing}
                badge={pickedUrls.has(item.url) ? 'remove' : 'add'}
                onBadge={() => edit(pickedUrls.has(item.url) ? 'remove' : 'add', item, item.label)}
                onHover={clearKeys} onLeave={onLeave}
              />
            ))}
            {panel.sites.length === 0 && (
              <div style={{
                width: '100%', padding: '10px 8px 12px',
                fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', lineHeight: 1.4,
              }}>
                {editing
                  ? 'Нажмите + на сайте, чтобы закрепить его здесь'
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
                idx={rel0 + i}
                active={activeIdx === rel0 + i}
                onHover={onHover}
                onLeave={onLeave}
              />
            ))}
          </div>
        </>
      )}
      {!panel.site && panel.sites.length === 0 && picked.length === 0 && resume.length === 0 && (
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
