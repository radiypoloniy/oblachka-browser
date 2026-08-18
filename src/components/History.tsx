import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { X, Search, Trash2, Clock, Wand2, Loader2 } from 'lucide-react';
import type { HistoryEntry, HistoryClearPeriod } from '../../shared/ipc';
import { islandPlate, untintedPlateVars } from '../styles/island';
import { TEXT, CAPS, panelIsland } from '../styles/system';
import SiteFavicon from './SiteFavicon';

interface HistoryProps {
  onClose: () => void;
}

// ── Группировка по дню (референс — страница истории Chrome/Яндекс) ──────────────────────────
function startOfDayMs(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function diffDaysFromToday(ms: number): number {
  return Math.round((startOfDayMs(Date.now()) - startOfDayMs(ms)) / 86_400_000);
}

function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(ms: number): string {
  const diff = diffDaysFromToday(ms);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Вчера';
  return new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'long' });
}

function timeOf(ms: number): string {
  return new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}`;
}

function monthLabel(ms: number): string {
  const label = new Date(ms).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function domainOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

interface DayGroup {
  key: string;
  label: string;
  diffDays: number;
  entries: HistoryEntry[];
}

// entries уже упорядочены по last_visit DESC (см. HistoryManager.ts) — просто бьём подряд идущие
// записи одного дня в одну группу, повторной сортировки не требуется.
function groupByDay(entries: HistoryEntry[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const e of entries) {
    const key = dayKey(e.lastVisit);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.entries.push(e);
    } else {
      groups.push({ key, label: dayLabel(e.lastVisit), diffDays: diffDaysFromToday(e.lastVisit), entries: [e] });
    }
  }
  return groups;
}

interface NavItem { key: string; label: string; targetKey: string }

// Недавние дни — по имени (Сегодня/Вчера/«6 июля, понедельник»), дальше — свёрнуто по месяцам
// (один пункт на месяц, ведёт к первой попавшейся в нём группе).
const RECENT_DAYS_SHOWN_INDIVIDUALLY = 6;

function buildNavItems(groups: DayGroup[]): NavItem[] {
  const items: NavItem[] = [];
  const seenMonths = new Set<string>();
  for (const g of groups) {
    if (g.diffDays <= RECENT_DAYS_SHOWN_INDIVIDUALLY) {
      items.push({ key: g.key, label: g.label, targetKey: g.key });
      continue;
    }
    const ms = g.entries[0]!.lastVisit;
    const mKey = monthKey(ms);
    if (!seenMonths.has(mKey)) {
      seenMonths.add(mKey);
      items.push({ key: mKey, label: monthLabel(ms), targetKey: g.key });
    }
  }
  return items;
}

const CLEAR_OPTIONS: { label: string; value: HistoryClearPeriod }[] = [
  { label: 'За последний час',    value: 'hour' },
  { label: 'За сегодня',          value: 'day'  },
  { label: 'За неделю',           value: 'week' },
  { label: 'За всё время',        value: 'all'  },
];

export default function History({ onClose }: HistoryProps) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [query, setQuery] = useState('');
  const [clearOpen, setClearOpen] = useState(false);
  const [clearError, setClearError] = useState(false);
  // Умный поиск (Qwen-реранк) — своё поле, отдельное от омнибокса (см. диагностику: это два
  // разных поля ввода с разными наборами фич, не один компонент в двух режимах). Выключен по
  // умолчанию — генеративный вызов небесплатный. НЕ участвует в live-фильтрации по keystroke
  // ниже (load() как был) — включается только по явному Enter (см. handleSearchKeyDown).
  const [smartOn, setSmartOn] = useState(false);
  const [smartLoading, setSmartLoading] = useState(false);
  // true — последний показанный результат умного поиска на самом деле cosine top-k без Qwen
  // (реранк упал/недоступен, см. SmartSearchResponse.degraded в shared/ipc.ts). Не то же самое,
  // что smartResultsShown=false — там результат вообще не от умного поиска, здесь он от него,
  // просто без LLM-шага.
  const [smartDegraded, setSmartDegraded] = useState(false);
  // true — entries сейчас содержит Qwen-реранк (порядок релевантности), не хронологию. Группировка
  // по дню/навигация по датам в этом случае показывать нельзя — она молча разрушила бы порядок
  // релевантности, раскидав результаты по датам. Плоский список — та же логика, что и раньше.
  const [smartResultsShown, setSmartResultsShown] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  // Счётчик запросов в entries — защита от гонки: load() (мгновенный, на каждый keystroke) и
  // handleSmartSearch() (Qwen, ~1-2+ сек) пишут в один и тот же entries независимо друг от
  // друга и без отмены. Без счётчика поздний ответ УСТАРЕВШЕГО запроса (юзер уже успел
  // напечатать/запустить новый, пока предыдущий Qwen-вызов ещё летел) мог молча перезаписать
  // уже показанные свежие результаты — тот самый «один результат из прошлого поиска затесался».
  const searchSeqRef = useRef(0);
  // Скролл к секции дня по клику в левой навигации — ключ дня → DOM-узел заголовка группы.
  const dayRefs = useRef(new Map<string, HTMLDivElement>());

  const load = useCallback(async () => {
    const seq = ++searchSeqRef.current;
    const result = query.trim()
      ? await window.oblako.searchHistory(query)
      : await window.oblako.getHistory();
    if (searchSeqRef.current !== seq) return; // подоспел более новый запрос — этот ответ устарел
    setEntries(result);
    setSmartResultsShown(false);
    setSmartDegraded(false);
  }, [query]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const dayGroups = useMemo(() => groupByDay(entries), [entries]);
  const navItems = useMemo(() => buildNavItems(dayGroups), [dayGroups]);

  function scrollToDay(key: string) {
    dayRefs.current.get(key)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function handleDelete(id: number) {
    await window.oblako.deleteHistoryEntry(id);
    void load();
  }

  async function handleClear(period: HistoryClearPeriod) {
    const ok = await window.oblako.clearHistory(period);
    setClearOpen(false);
    setClearError(!ok);
    void load();
  }

  // Только по явному Enter — генеративный вызов Qwen занимает секунды, гонять его на каждый
  // keystroke (как обычный load() выше) нельзя. Результат временно заменяет entries; дальнейший
  // ввод/очистка снова отдают управление обычному live-поиску через load().
  async function handleSmartSearch() {
    const q = query.trim();
    if (!q || smartLoading) return;
    const seq = ++searchSeqRef.current;
    setSmartLoading(true);
    try {
      const { results, degraded } = await window.oblako.searchHistorySmart(q);
      if (searchSeqRef.current === seq) { setEntries(results); setSmartResultsShown(true); setSmartDegraded(degraded); } // иначе — устарело, юзер уже дальше
    } catch {
      // IPC целиком недоступен (не то же самое, что "реранк внутри упал" — то помечено полем
      // degraded в успешном ответе выше) — не оставляем список пустым молча, просто откатываемся
      // на обычный поиск (load() уже отработал по этому же query per keystroke), но тоже
      // только если этот запрос всё ещё актуален.
      if (searchSeqRef.current === seq) void load();
    } finally {
      setSmartLoading(false);
    }
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && smartOn) void handleSmartSearch();
  }

  return (
    <div style={{
      height: '100%', position: 'relative',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      // Тот же "остров", что у сайдбара (Sidebar.tsx::asideBase) — radius-island/shadow-island
      // совпадают с CONTENT_CORNER_RADIUS у обычной вкладки (TabManager.ts), только фон
      // непрозрачный (--surface-solid), не --surface-island: у сайдбара мало текста, лёгкая
      // прозрачность не мешает, а плотный список истории на полупрозрачном фоне читался бы хуже.
      // Отступ по периметру — НЕ здесь: contentRef в App.tsx уже даёт margin:var(--gutter-shell)
      // один раз на весь контент (Hub тоже им пользуется, без своего собственного margin).
      ...islandPlate,
      ...panelIsland(),
      ...untintedPlateVars,
    }}>
      {/* Заголовок */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '16px 20px 12px',
        borderBottom: '1px solid var(--divider)',
        flexShrink: 0,
      }}>
        <Clock size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        {/* Роль «заголовок раздела» из системы: 22/700 с плотным трекингом. Раньше здесь стоял
            fs-md (16) обычным весом — заголовок панели читался как строка списка. */}
        <span style={{ ...TEXT.title, flex: 1 }}>История посещений</span>
        <button
          onClick={() => setClearOpen((v) => !v)}
          title="Очистить историю"
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 4,
            color: 'var(--text-muted)', borderRadius: 'var(--radius-sm)',
            display: 'flex', alignItems: 'center',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; e.currentTarget.style.color = 'var(--text-body)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)'; }}
        >
          <Trash2 size={15} />
        </button>
        <button
          onClick={onClose}
          title="Закрыть"
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 4,
            color: 'var(--text-muted)', borderRadius: 'var(--radius-sm)',
            display: 'flex', alignItems: 'center',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; e.currentTarget.style.color = 'var(--text-body)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)'; }}
        >
          <X size={16} />
        </button>
      </div>

      {clearError && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 20px', fontSize: 'var(--fs-sm)',
          background: 'color-mix(in srgb, var(--danger-500) 12%, transparent)',
          color: 'var(--danger-500)', flexShrink: 0,
        }}>
          Не удалось очистить историю. Попробуйте ещё раз.
          <button
            onClick={() => setClearError(false)}
            style={{
              marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
              color: 'inherit', display: 'flex', padding: 2,
            }}
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Дропдаун очистки */}
      {clearOpen && (
        <div style={{
          position: 'absolute', top: 52, right: 16,
          ...islandPlate,
          borderRadius: 'var(--radius-card)',
          zIndex: 200, overflow: 'hidden', minWidth: 180,
        }}>
          {CLEAR_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => void handleClear(opt.value)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '8px 14px', background: 'none', border: 'none',
                cursor: 'pointer', fontSize: 'var(--fs-sm)', color: 'var(--text-body)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* Поиск — на всю ширину плиты */}
      <div style={{ padding: '10px 20px', flexShrink: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          ...islandPlate,
          borderRadius: 'var(--radius-sm)', padding: '6px 10px',
        }}>
          <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Поиск в истории…"
            style={{
              flex: 1, background: 'none', border: 'none', outline: 'none',
              fontSize: 'var(--fs-sm)', color: 'var(--text-body)',
            }}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: 2, color: 'var(--text-muted)', display: 'flex',
              }}
            >
              <X size={12} />
            </button>
          )}
          {/* Умный поиск (Qwen-реранк) — своё отдельное поле, не омнибокс (см. диагностику).
              Влияет только на Enter (handleSearchKeyDown), сам факт включения ничего не запускает. */}
          <button
            onClick={() => setSmartOn((v) => !v)}
            title={smartOn ? 'Умный поиск (Qwen): включён — Enter запускает переранжирование' : 'Умный поиск (Qwen): выключен'}
            style={{
              background: smartOn ? 'var(--accent-soft)' : 'none',
              border: 'none', cursor: 'default', padding: 3, borderRadius: 'var(--radius-sm)',
              color: smartOn ? 'var(--accent)' : 'var(--text-muted)', display: 'flex', flexShrink: 0,
            }}
          >
            <Wand2 size={14} />
          </button>
        </div>
      </div>

      {smartLoading && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', padding: '0 20px 8px', flexShrink: 0,
        }}>
          <Loader2 size={13} style={{ animation: 'oblako-spin 1s linear infinite' }} />
          Qwen переранжирует…
        </div>
      )}

      {/* Реранк не отработал (упал/недоступна модель) — вместо молчаливой подмены честно
          показываем, что порядок ниже — cosine top-k, не решение Qwen (SmartSearchResponse.degraded). */}
      {smartResultsShown && smartDegraded && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '0 20px 8px', fontSize: 'var(--fs-sm)', color: 'var(--warning-500)', flexShrink: 0,
        }}>
          Показан быстрый результат — AI не ответил, порядок по сходству, не по смыслу.
        </div>
      )}

      {entries.length === 0 ? (
        <div style={{
          textAlign: 'center', color: 'var(--text-muted)',
          fontSize: 'var(--fs-sm)', marginTop: 48,
        }}>
          {query ? 'Ничего не найдено' : 'История пуста'}
        </div>
      ) : smartResultsShown ? (
        // Умный поиск — плоский список в порядке релевантности (см. комментарий у smartResultsShown).
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '0 20px 16px' }}
          onClick={() => { if (clearOpen) setClearOpen(false); }}
        >
          {entries.map((entry) => (
            <HistoryRow key={entry.id} entry={entry} onDelete={handleDelete} />
          ))}
        </div>
      ) : (
        // Референс — страница истории Chrome/Яндекс: узкая навигация по датам слева,
        // список записей справа, сгруппированный блоками по дню.
        <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
          <nav style={{
            width: 150, flexShrink: 0, overflowY: 'auto',
            padding: '10px 8px 16px', borderRight: '1px solid var(--divider)',
          }}>
            {navItems.map((item) => (
              <button
                key={item.key}
                onClick={() => scrollToDay(item.targetKey)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '6px 10px', marginBottom: 1, border: 'none', background: 'none',
                  borderRadius: 'var(--radius-sm)', cursor: 'default',
                  fontSize: 'var(--fs-xs)', color: 'var(--text-body)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '0 20px 16px' }}
            onClick={() => { if (clearOpen) setClearOpen(false); }}
          >
            {dayGroups.map((group) => (
              <div
                key={group.key}
                ref={(el) => { if (el) dayRefs.current.set(group.key, el); else dayRefs.current.delete(group.key); }}
              >
                {/* Подпись группы — тот же приём, что в настройках и на плитках: моноширинная
                    капса. Именно она делает список «своим», а не набором строк. */}
                <div style={{
                  position: 'sticky', top: 0, zIndex: 1,
                  background: 'var(--surface-solid)',
                  ...CAPS,
                  padding: '12px 8px 6px',
                }}>
                  {group.label}
                </div>
                {group.entries.map((entry) => (
                  <HistoryRow key={entry.id} entry={entry} onDelete={handleDelete} />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryRow({ entry, onDelete }: { entry: HistoryEntry & { snippet?: string }; onDelete: (id: number) => void }) {
  const [hovered, setHovered] = useState(false);
  const domain = domainOf(entry.url);

  function handleNavigate() {
    void window.oblako.createTab(entry.url);
  }

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        // Строка стала выше и просторнее: это главный список раздела, а он читался как плотная
        // таблица — 6 px по вертикали на строку с 13-м кеглем. Пролистывать такое глазами тяжело.
        padding: '9px 10px', borderRadius: 'var(--radius-sm)',
        background: hovered ? 'var(--surface-hover)' : 'transparent',
        cursor: 'pointer',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={handleNavigate}
    >
      {/* Время — МОНОШИРИННОЕ: это данные, а не текст, и в столбце они обязаны стоять ровно. */}
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '0.02em',
        color: 'var(--text-faint)', width: 44, flexShrink: 0, fontVariantNumeric: 'tabular-nums',
      }}>
        {timeOf(entry.lastVisit)}
      </span>
      {/* Настоящий значок сайта вместо буквы домена: страницу человек узнаёт по нему быстрее,
          чем прочитывает заголовок. Буква осталась запасным путём внутри SiteFavicon. */}
      <SiteFavicon url={entry.url} size={22} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
            <span style={{
              flex: 1, minWidth: 0,
              ...TEXT.body, color: 'var(--text-strong)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {entry.title || entry.url}
            </span>
            <span style={{
              flexShrink: 3, minWidth: 0,
              fontSize: 'var(--fs-xs)', color: 'var(--text-faint)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {domain}
            </span>
          </div>
          {entry.snippet && (
            <div style={{
              fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: 2,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {entry.snippet}
            </div>
          )}
        </div>
      </div>
      {hovered && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(entry.id); }}
          title="Удалить из истории"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: 3, color: 'var(--text-muted)', display: 'flex',
            borderRadius: 'var(--radius-sm)', flexShrink: 0,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-body)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}
