import type { CSSProperties, ReactNode } from 'react';
import { ChevronDown, RotateCcw, X } from 'lucide-react';
import { CAPS, DISPLAY_ROW, RADIUS, TEXT } from '../../styles/system';
import { useLanguage } from '../../i18n';
import type { ChatMessage } from '../contract';
/**
 * Плашка над лентой: про что беседа, состояние модели, «очистить беседу».
 *
 * ⚠️ Герой панели: отвечает на вопрос «он вообще про эту страницу?». Поэтому заголовок
 * дисплейной гарнитурой, а состояние модели — чипом в плашке, а не второй крупной строкой.
 * Что именно стоит в заголовке (страница, набор или пустой чат), решает ContextIsland.tsx —
 * каркас один, иначе две плашки разъехались бы по отступам на первой же правке.
 */
export function PageIsland({
  lead, title, subtitle, sending, messages, modelState, onOpenMenu, menuOpen, onUnlink,
}: {
  /** Значок слева: фавикон страницы или знак отвязанной беседы. */
  lead: ReactNode;
  title: string;
  subtitle: string;
  sending: boolean;
  messages: ChatMessage[];
  modelState: { label: string | null; loaded: boolean } | null;
  /** Клик по заголовку — меню источника беседы (страница / набор / пустой чат). */
  onOpenMenu: () => void;
  menuOpen: boolean;
  /** Есть только у страницы: крестик отвязывает беседу от неё. */
  onUnlink?: () => void;
}) {
  const { t } = useLanguage();
  return (
  <div style={ISLAND_STYLE}>
    {lead}
    {/* ⚠️ ЗАГОЛОВОК ДИСПЛЕЙНОЙ, ПОД НИМ ДОМЕН. Это герой панели: вопрос «он вообще про эту
        вкладку или про предыдущую?» возникает раньше любого другого и задаётся заново после
        каждого переключения. Домен нужен отдельной строкой потому, что заголовки страниц
        врут чаще адресов — «Главная» встречается на сотне сайтов.
        ⚠️ Заголовок — кнопка меню, но выглядит текстом: шеврон рядом и есть всё приглашение. */}
    <button
      onClick={onOpenMenu}
      aria-expanded={menuOpen}
      title={t('Откуда беседа берёт контекст')}
      style={{
        flex: 1, minWidth: 0, display: 'block', textAlign: 'left',
        background: 'transparent', border: 'none', padding: 0, font: 'inherit', color: 'inherit',
        cursor: 'pointer',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 4, ...DISPLAY_ROW, whiteSpace: 'nowrap' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
        <ChevronDown size={13} style={{
          flex: 'none', color: 'var(--text-faint)',
          transform: menuOpen ? 'rotate(180deg)' : 'none', transition: 'transform var(--dur-fast) var(--ease-out)',
        }} />
      </span>
      {subtitle && (
        <span style={{
          display: 'block', ...TEXT.caption, color: 'var(--text-muted)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {subtitle}
        </span>
      )}
    </button>
    {/* ⚠️ Состояние модели — ЧИПОМ В ПЛАШКЕ, а не отдельной строкой и не героем. Вопрос
        «он про эту вкладку?» человек задаёт каждый раз, а «что за модель и почему долго» —
        один раз; поэтому страница крупно, модель мелко, но в том же ряду: одна строка
        отвечает на оба вопроса и панель не теряет высоту у ленты. */}
    {modelState && (
      <span
        title={modelState.label
          ? (modelState.loaded
            ? `${modelState.label} — в памяти, отвечает сразу`
            : `${modelState.label} — поднимется в память при первом запросе`)
          : 'Локальная модель не установлена'}
        style={{
          ...CAPS, flex: 'none', whiteSpace: 'nowrap',
          padding: '4px 8px', borderRadius: RADIUS.pill,
          background: modelState.loaded ? 'var(--surface-sunken)' : 'var(--selected)',
          color: 'var(--text-muted)',
        }}
      >
        {!modelState.label ? 'нет модели' : modelState.loaded ? 'в памяти' : 'поднимаю'}
      </span>
    )}
    {/* Очистить беседу — начать с чистого листа, не уходя со страницы. Показывается
        только когда чистить есть что: на пустой ленте это была бы кнопка без действия.
        Во время генерации гасится по той же причине, что и чипы подсказок (chipsBusy) —
        иначе ответ приехал бы в уже очищенную ленту. */}
    {messages.length > 0 && (
      <button
        onClick={() => window.aiPanel.clearChat()}
        disabled={sending}
        title="Очистить беседу"
        style={{ ...ICON_BUTTON, cursor: sending ? 'default' : 'pointer', opacity: sending ? 0.4 : 1 }}
      >
        <RotateCcw size={13} strokeWidth={2} />
      </button>
    )}
    {/* ⚠️ Крестик ОТВЯЗЫВАЕТ, а не закрывает: беседа страницы остаётся во вкладке, панель уходит
        в отвязанный чат (набор по умолчанию или пустой). Вернуться — через меню заголовка. */}
    {onUnlink && (
      <button onClick={onUnlink} title={t('Отвязать от страницы')} style={ICON_BUTTON}>
        <X size={13} strokeWidth={2} />
      </button>
    )}
  </div>
  );
}

const ISLAND_STYLE: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  margin: `10px var(--pad-island) 0`,
  padding: '7px 8px 7px 12px',
  background: 'var(--surface-solid)',
  border: '1px solid var(--glass-edge)',
  boxShadow: 'var(--shadow-card)',
  borderRadius: 'var(--radius-card)',
  flexShrink: 0,
  minWidth: 0,
};

const ICON_BUTTON: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 22, height: 22, flexShrink: 0,
  background: 'transparent', border: 'none', borderRadius: '50%',
  color: 'var(--text-faint)', cursor: 'pointer', padding: 0,
};
