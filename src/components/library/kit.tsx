import type React from 'react';
import { Trash2 } from 'lucide-react';
import { CAPS, DISPLAY_CARD, DISPLAY_ROW, RADIUS, TEXT, motion, pad, sp } from '../../styles/system';

// ── Набор библиотеки ─────────────────────────────────────────────────────────
//
// ⚠️ ЗАЧЕМ. Большое меню — это ОДНА вкладка, внутри которой живут История, Закладки, Загрузки,
// Отслеживание и поиск «Везде». До этого захода каждый из пяти был самостоятельным островом со
// своей шапкой, своим заголовком (История — ролью TEXT.title, Отслеживание — своим fs-lg/700,
// у поиска заголовка не было вовсе), своим полем поиска и СВОЕЙ кнопкой «закрыть» — хотя крестик
// закрывает вкладку, а не раздел. Переход между разделами читался как переход между
// приложениями.
//
// ⚠️ Набор НЕ импортируется из settings/kit: там свои правила (страница настроек), и главное —
// settings/kit тянет за собой весь модуль настроек. Здесь ровно то, что нужно библиотеке:
// плитка факта, подпись группы, строка данных и боковая навигация.

/** Тон раздела библиотеки. ⚠️ Закреплён навсегда — узнаваемость и есть смысл затеи. */
export type LibraryTone = 'sky' | 'mustard' | 'tea' | 'tangerine' | 'lime';

/**
 * Плакатный цвет раздела и краска на нём.
 *
 * ⚠️ Пара обязательна и не вкусовая: на мандарине, горчице, лайме и небе контраст чернил выше
 * 7:1, а белого ниже 3:1; на чае наоборот. Взять «белый, потому что на цвете всегда белый» —
 * значит сделать горчичный раздел нечитаемым (тот же разбор, что у SECTION_TONE в настройках).
 */
export const TONE_INK: Record<LibraryTone, string> = {
  sky: 'var(--on-poster-dark)',
  mustard: 'var(--on-poster-dark)',
  lime: 'var(--on-poster-dark)',
  tangerine: 'var(--on-poster-dark)',
  tea: 'var(--on-poster-light)',
};

/** Сводка раздела для шапки. Раздел сам знает свои числа — шапка их только показывает. */
export interface LibrarySummary {
  /** Число, ради которого раздел открывают. Не название раздела. */
  hero: React.ReactNode;
  /** Что это число значит. */
  heroLabel: React.ReactNode;
  /** Четыре плитки сводки. Пусто — плиток нет (поиск «Везде»). */
  facts?: LibraryFact[];
}

export interface LibraryFact {
  label: string;
  hint: string;
  /** ⚠️ «—», а не 0, пока число не пришло: ноль это ответ, а не ожидание. */
  value: string;
  active?: boolean;
}

/**
 * Плитка факта.
 *
 * ⚠️ Заливка ЧЕРНИЛАМИ, а не тоном шапки: включённых плиток на экране до четырёх, и четыре
 * цветные заливки под цветной шапкой дают ту самую пестроту, от которой уходили. Тон остаётся
 * у шапки — одна цветная плоскость на экран.
 */
export function Fact({ label, hint, value, active }: LibraryFact) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: sp(1), minWidth: 0, overflow: 'hidden',
      padding: pad(3), borderRadius: RADIUS.box, minHeight: 92,
      background: active ? 'var(--text-strong)' : 'var(--surface-sunken)',
      color: active ? 'var(--app-bg)' : 'var(--text-body)',
      transition: motion.state('background', 'color'),
    }}>
      <span style={{
        ...TEXT.body, fontWeight: 600, color: 'inherit',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{label}</span>
      <span style={{
        ...TEXT.caption, color: 'inherit', opacity: 0.62, lineHeight: 1.25,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{hint}</span>
      <span style={{
        ...DISPLAY_CARD, marginTop: 'auto', color: 'inherit',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{value}</span>
    </div>
  );
}

export function FactGrid({ facts }: { facts: LibraryFact[] }) {
  if (facts.length === 0) return null;
  return (
    <div style={{
      display: 'grid', gap: sp(2), marginBottom: sp(4),
      // ⚠️ minmax(0, …) обязателен: `1fr` это `minmax(auto, 1fr)`, и подсказка без переносов
      // распирала бы колонку по своему содержимому (поймано живьём на плитках поповера щита).
      gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 168px), 1fr))',
    }}>
      {facts.map((f) => <Fact key={f.label} {...f} />)}
    </div>
  );
}

/** Подпись группы: моноширинный капс слева, число справа. Тот же приём, что в загрузках. */
export function GroupCap({ title, note }: { title: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: sp(2), padding: `${sp(3)}px ${sp(4)}px ${sp(1)}px`,
    }}>
      <span style={{ ...CAPS }}>{title}</span>
      {note !== undefined && (
        <span style={{ ...TEXT.caption, color: 'var(--text-faint)', marginLeft: 'auto' }}>{note}</span>
      )}
    </div>
  );
}

/** Коробка списка: рамка и волосяные разделители держат группу, а не заливка. */
export function Rows({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      border: '1px solid var(--divider)', borderRadius: RADIUS.content,
      background: 'var(--surface)', overflow: 'hidden',
    }}>{children}</div>
  );
}

/**
 * Строка данных — ОДИН рецепт на все разделы библиотеки.
 *
 * ⚠️ До этого их было пять: строка истории, строка закладки, строка загрузки, строка поиска и
 * карточка товара. Все они показывают одно и то же — сохранённую вещь со значком, именем и
 * адресом, — и разъезжались по кеглю, отступам и порядку колонок.
 *
 * ⚠️ Адрес стоит ПОД именем, а не справа от него. Раньше домен занимал место в одной строке с
 * заголовком и отъедал у него ширину: длинные заголовки обрезались вдвое раньше, чем нужно, при
 * том что домен и так виден на значке сайта.
 */
export function Row({ lead, icon, title, subtitle, meta, actions, selected, onClick, title2 }: {
  /** Узкая колонка слева: время, размер. Место держится всегда — иначе список «дышит». */
  lead?: React.ReactNode;
  icon?: React.ReactNode;
  title: React.ReactNode;
  /** Адрес или другая машинная строка — моноширинным. */
  subtitle?: React.ReactNode;
  /** Правая колонка: имя папки, вид находки, состояние. */
  meta?: React.ReactNode;
  /** Кнопки. Показываются всегда: «по наведению» в длинном списке — это игра в прятки. */
  actions?: React.ReactNode;
  selected?: boolean;
  onClick?: () => void;
  /** Подсказка при наведении — обычно полный адрес. */
  title2?: string;
}) {
  return (
    <div
      onClick={onClick}
      title={title2}
      style={{
        display: 'flex', alignItems: 'center', gap: sp(3), padding: pad(2, 4),
        minHeight: 46, cursor: onClick ? 'default' : undefined,
        background: selected ? 'var(--selected)' : 'transparent',
        boxShadow: 'inset 0 -1px 0 var(--divider)',
        transition: motion.hover('background'),
      }}
      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = 'var(--surface-hover)'; }}
      onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = 'transparent'; }}
    >
      {lead !== undefined && (
        <span style={{
          flex: 'none', width: 44, ...TEXT.caption, fontFamily: 'var(--font-mono)',
          color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums',
        }}>{lead}</span>
      )}
      {icon}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          ...DISPLAY_ROW, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{title}</div>
        {subtitle !== undefined && (
          <div style={{
            ...TEXT.caption, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)',
            marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{subtitle}</div>
        )}
      </div>
      {meta !== undefined && (
        <span style={{
          flex: 'none', maxWidth: 160, ...TEXT.caption, color: 'var(--text-muted)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{meta}</span>
      )}
      {actions !== undefined && (
        <span style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: sp(1) }}>{actions}</span>
      )}
    </div>
  );
}

/**
 * Боковая навигация «сузить список»: даты у истории, папки у закладок.
 *
 * ⚠️ Одно место и один вид на оба раздела. Раньше даты были голыми кнопками кегля 12, а папки —
 * своей вёрсткой со счётчиком: две колонки, делающие одно и то же, выглядели по-разному.
 */
export function SideNav({ caption, items, activeKey, onPick, onRemove }: {
  caption: string;
  items: { key: string; label: string; note?: string; removable?: boolean }[];
  activeKey?: string;
  onPick: (key: string) => void;
  /** Удаление пункта — у папок закладок. Кнопка видна только у помеченных removable. */
  onRemove?: (key: string) => void;
}) {
  return (
    <nav style={{ width: 172, flex: 'none', display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span style={{ ...CAPS, padding: `${sp(1)}px ${sp(3)}px ${sp(2)}px` }}>{caption}</span>
      {items.map((item) => {
        const on = item.key === activeKey;
        return (
          <button
            key={item.key}
            onClick={() => onPick(item.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: sp(2), width: '100%',
              padding: pad(2, 3), border: 'none', borderRadius: RADIUS.control,
              background: on ? 'var(--selected)' : 'transparent',
              color: on ? 'var(--text-strong)' : 'var(--text-body)',
              ...TEXT.body, fontWeight: on ? 650 : 450,
              textAlign: 'left', cursor: 'default',
              transition: motion.hover('background'),
            }}
            onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = 'var(--surface-hover)'; }}
            onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = 'transparent'; }}
          >
            <span style={{
              flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{item.label}</span>
            {item.note !== undefined && (
              <span style={{ ...TEXT.caption, color: 'var(--text-faint)', flex: 'none' }}>{item.note}</span>
            )}
            {item.removable === true && onRemove !== undefined && (
              // ⚠️ Кнопка внутри кнопки недопустима, поэтому это span с ролью — так же, как
              // сделано у действий внутри строки списка настроек.
              <span
                role="button"
                title="Удалить папку"
                onClick={(e) => { e.stopPropagation(); onRemove(item.key); }}
                style={{ flex: 'none', display: 'inline-flex', color: 'var(--text-faint)' }}
              ><Trash2 size={13} /></span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

/** Раздел с боковой навигацией: сузить слева, список справа. Узко — колонки складываются. */
export function SplitView({ side, children }: { side: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: sp(4), alignItems: 'flex-start', flexWrap: 'wrap' }}>
      {side}
      <div style={{ flex: '1 1 320px', minWidth: 0 }}>{children}</div>
    </div>
  );
}
