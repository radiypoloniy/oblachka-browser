import { Globe, RotateCcw } from 'lucide-react';
import { CAPS, DISPLAY_ROW, RADIUS, TEXT } from '../../styles/system';
import type { ChatMessage } from '../contract';
/**
 * Островок текущей страницы: заголовок, домен, состояние модели, «очистить беседу».
 *
 * ⚠️ Герой панели: отвечает на вопрос «он вообще про эту страницу?». Поэтому заголовок
 * дисплейной гарнитурой, а состояние модели — чипом в плашке, а не второй крупной строкой.
 */
export function PageIsland({
  pageTitle, pageHost, pageFavicon, faviconError, sending, messages, modelState, setFaviconError,
}: {
  pageTitle: string;
  pageHost: string;
  pageFavicon: string | null;
  faviconError: boolean;
  sending: boolean;
  messages: ChatMessage[];
  modelState: { label: string | null; loaded: boolean } | null;
  setFaviconError: (v: boolean) => void;
}) {
  return (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 8,
    margin: `10px var(--pad-island) 0`,
    padding: '7px 8px 7px 12px',
    background: 'var(--surface-solid)',
    border: '1px solid var(--glass-edge)',
    boxShadow: 'var(--shadow-card)',
    borderRadius: 'var(--radius-card)',
    flexShrink: 0,
    minWidth: 0,
  }}>
    {pageFavicon && !faviconError ? (
      <img
        src={pageFavicon}
        alt=""
        width={16}
        height={16}
        onError={() => setFaviconError(true)}
        style={{ flexShrink: 0, borderRadius: RADIUS.tight, objectFit: 'contain' }}
      />
    ) : (
      <Globe size={16} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
    )}
    {/* ⚠️ ЗАГОЛОВОК ДИСПЛЕЙНОЙ, ПОД НИМ ДОМЕН. Это герой панели: вопрос «он вообще про эту
        вкладку или про предыдущую?» возникает раньше любого другого и задаётся заново после
        каждого переключения. Домен нужен отдельной строкой потому, что заголовки страниц
        врут чаще адресов — «Главная» встречается на сотне сайтов. */}
    <span style={{ flex: 1, minWidth: 0 }}>
      <span style={{
        display: 'block', ...DISPLAY_ROW,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {pageTitle || 'Новая вкладка'}
      </span>
      {pageHost && (
        <span style={{
          display: 'block', ...TEXT.caption, color: 'var(--text-muted)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {pageHost}
        </span>
      )}
    </span>
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
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 22, height: 22, flexShrink: 0,
          background: 'transparent', border: 'none', borderRadius: '50%',
          color: 'var(--text-faint)', cursor: sending ? 'default' : 'pointer', padding: 0,
          opacity: sending ? 0.4 : 1,
        }}
      >
        <RotateCcw size={13} strokeWidth={2} />
      </button>
    )}
  </div>
  );
}
