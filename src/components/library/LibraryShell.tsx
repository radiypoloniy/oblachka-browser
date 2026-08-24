import type React from 'react';
import { Search, X } from 'lucide-react';
import { CAPS, DISPLAY, RADIUS, TEXT, grain, motion, pad, sp } from '../../styles/system';
import { islandPlate, untintedPlateVars } from '../../styles/island';
import { panelIsland } from '../../styles/system';
import { FactGrid, TONE_INK, type LibrarySummary, type LibraryTone } from './kit';

// Оболочка большого меню: цветная шапка с героем, рельс разделов и одно поле поиска.
//
// ⚠️ ПЛАКАТНЫЙ ЦВЕТ ЗДЕСЬ ЗАКОНЕН, в отличие от поповеров и AI-панели. Библиотека — СТРАНИЦА
// приложения, как настройки: чужого сайта на ней нет, спорить не с кем. Правило «хром тихий»
// про рамку вокруг чужой страницы, а не про собственные экраны продукта.
//
// ⚠️ ТОН МЕНЯЕТСЯ ВМЕСТЕ С РАЗДЕЛОМ и закреплён навсегда — тем же приёмом, что SECTION_TONE в
// настройках: История всегда небо, Закладки горчица, Загрузки чай, Отслеживание мандарин, поиск
// лайм. После третьего открытия раздел находят по цвету, не читая.
//
// ⚠️ КРЕСТИК ОДИН и стоит ЗДЕСЬ. Раньше он был внутри каждого из пяти островов, хотя закрывает
// он вкладку, а не раздел: четыре копии одной кнопки, каждая уезжала вместе с переключением.

export interface LibraryShellProps {
  tone: LibraryTone;
  /** Название раздела — подзаголовком НАД героем, мелко: его человек уже прочитал в сайдбаре. */
  title: string;
  summary: LibrarySummary;
  /** Строка поиска. Одна на все разделы — раньше их было три с разным поведением. */
  query: string;
  onQuery: (v: string) => void;
  searchPlaceholder: string;
  /** Искать сразу по истории, закладкам и загрузкам. */
  everywhere: boolean;
  onEverywhere: (v: boolean) => void;
  /** Поиск уходит к модели и работает по Enter — см. StuffSearchView. */
  onSubmit?: () => void;
  /** Рельс разделов — приходит снаружи, оболочка про состав разделов не знает. */
  rail: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}

export default function LibraryShell({
  tone, title, summary, query, onQuery, searchPlaceholder,
  everywhere, onEverywhere, onSubmit, rail, onClose, children,
}: LibraryShellProps) {
  const ink = TONE_INK[tone];
  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      ...islandPlate,
      ...panelIsland(),
      ...untintedPlateVars,
    }}>
      {/* ── Шапка: тон раздела, название мелко, ответ крупно ── */}
      <div style={{
        background: `var(--poster-${tone})`, color: ink,
        padding: pad(6, 6), position: 'relative', overflow: 'hidden', flex: 'none',
        transition: motion.state('background'),
      }}>
        {/* Зерно поверх заливки — та же текстура, что на шапках настроек и карточках стола.
            Она и отличает «напечатано» от «залито в макете». */}
        <div style={grain} />
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: sp(4), position: 'relative' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              ...DISPLAY, fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em',
              color: 'inherit', opacity: 0.82,
            }}>{title}</div>
            {/* ⚠️ ГЕРОЙ — ЧИСЛО, ради которого раздел открывают. Раньше библиотека встречала
                собственным названием («История посещений»), то есть словом, которое человек уже
                прочитал в сайдбаре, пока сюда шёл. */}
            <div style={{
              ...DISPLAY, fontSize: 44, fontWeight: 800, letterSpacing: '-0.04em',
              lineHeight: 1.02, marginTop: sp(1), color: 'inherit',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{summary.hero}</div>
            <div style={{ ...TEXT.body, opacity: 0.72, color: 'inherit' }}>{summary.heroLabel}</div>
          </div>
          <button
            onClick={onClose}
            title="Закрыть"
            style={{
              flex: 'none', width: 32, height: 32, borderRadius: '50%', border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'default',
              background: 'color-mix(in srgb, currentColor 14%, transparent)', color: 'inherit',
            }}
          ><X size={16} /></button>
        </div>
      </div>

      {/* ── Рельс: сегменты и одно поле поиска на общей подложке ──
          ⚠️ Раньше это были ДВЕ капсулы, висящие в воздухе НАД островом и ни к чему не
          прикреплённые. Подложка привязывает их к шапке, а поле поиска перестаёт быть третьим
          самостоятельным полем со своим поведением в каждом разделе. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: sp(2), flexWrap: 'wrap',
        padding: pad(3, 6), background: 'var(--surface-sunken)',
        borderBottom: '1px solid var(--divider)', flex: 'none',
      }}>
        {rail}
        <div style={{
          flex: '1 1 220px', minWidth: 0, display: 'flex', alignItems: 'center', gap: sp(2),
          height: 38, padding: `0 ${sp(1)}px 0 ${sp(3)}px`, borderRadius: RADIUS.pill,
          background: 'var(--surface)', border: '1px solid var(--divider)',
        }}>
          <Search size={15} style={{ flex: 'none', color: 'var(--text-faint)' }} />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && onSubmit) onSubmit(); }}
            placeholder={searchPlaceholder}
            style={{
              flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none',
              ...TEXT.body, color: 'var(--text-strong)', fontFamily: 'inherit',
            }}
          />
          {/* ⚠️ «Везде» — ПЕРЕКЛЮЧАТЕЛЬ ВНУТРИ ПОЛЯ, а не пятый раздел и не отдельная капсула.
              Это не архив, а способ искать: держать его в одном ряду с четырьмя архивами значило
              бы предлагать «выбери один из пяти», хотя выбор тут другого рода. */}
          <button
            onClick={() => onEverywhere(!everywhere)}
            title={everywhere
              ? 'Ищем сразу по истории, закладкам и загрузкам — по Enter'
              : 'Искать сразу по истории, закладкам и загрузкам'}
            style={{
              flex: 'none', ...CAPS, padding: `${sp(1)}px ${sp(2)}px`, borderRadius: RADIUS.pill,
              border: everywhere ? 'none' : '1px solid var(--divider)',
              background: everywhere ? 'var(--text-strong)' : 'transparent',
              color: everywhere ? 'var(--app-bg)' : 'var(--text-muted)',
              cursor: 'default', transition: motion.state('background', 'color'),
            }}
          >везде</button>
        </div>
      </div>

      {/* ── Содержимое раздела ── */}
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, overflowY: 'auto', padding: pad(4, 6) }}>
        {summary.facts !== undefined && <FactGrid facts={summary.facts} />}
        {children}
      </div>
    </div>
  );
}
