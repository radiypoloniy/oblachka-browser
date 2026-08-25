import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { X, Trash2, Wand2, Loader2 } from 'lucide-react';
import type { HistoryEntry, HistoryClearPeriod } from '../../shared/ipc';
import { islandPlate } from '../styles/island';
import { TEXT, RADIUS, motion, pad, sp } from '../styles/system';
import { GroupCap, Row, Rows, SideNav, SplitView, type LibrarySummary } from './library/kit';
import { btnGhost } from './settings/kit';
import SiteFavicon from './SiteFavicon';
import { EmptyState } from './EmptyState';
import { ClockGlyph, SearchGlyph } from './glyphs';
import { sectionCache } from './library/sectionCache';

interface HistoryProps {
  /** Строка поиска — общая на всю библиотеку, живёт в оболочке (LibraryShell). */
  query: string;
  onSummary: (s: LibrarySummary) => void;
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

// ⚠️ Последний показанный список — переживает размонтирование раздела и ЗАБЫВАЕТСЯ при смене
// профиля (разбор — в шапке library/sectionCache.ts).
// ⚠️ Кладём сюда только НЕОТФИЛЬТРОВАННЫЙ список. Иначе, вернувшись в раздел, человек увидел бы
// результаты прошлого поиска как полный архив.
const cachedEntries = sectionCache<HistoryEntry[]>([]);

const CLEAR_OPTIONS: { label: string; value: HistoryClearPeriod }[] = [
  { label: 'За последний час',    value: 'hour' },
  { label: 'За сегодня',          value: 'day'  },
  { label: 'За неделю',           value: 'week' },
  { label: 'За всё время',        value: 'all'  },
];

export default function History({ query, onSummary }: HistoryProps) {
  // Первый кадр — то, что показывали в прошлый раз; свежий список приезжает следом.
  const [entries, setEntries] = useState<HistoryEntry[]>(cachedEntries.get);
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
    if (!query.trim()) cachedEntries.set(result);
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

  // ⚠️ Сводка. Числа берутся из УЖЕ ЗАГРУЖЕННОГО куска, и это ограничение названо честно: история
  // живёт в SQLite и приходит страницами, поэтому «сколько всего» отсюда не узнать. Показываем то,
  // что посчитать можно без вранья: страниц за сегодня в загруженном и разных сайтов в нём же.
  // Общий счётчик появится, когда для него будет запрос (см. library-pass-1.html, раздел 07).
  const todayCount = entries.filter((e) => diffDaysFromToday(e.lastVisit) === 0).length;
  const siteCount = new Set(entries.map((e) => domainOf(e.url))).size;
  useEffect(() => {
    onSummary({
      hero: entries.length === 0 ? '—' : String(todayCount),
      heroLabel: entries.length === 0
        ? 'страниц за сегодня пока нет'
        : `${plural(todayCount, 'страница', 'страницы', 'страниц')} за сегодня`,
      facts: [
        { label: 'За сегодня', hint: 'открытых страниц', value: String(todayCount), active: todayCount > 0 },
        { label: 'Сайтов', hint: 'разных доменов в списке', value: String(siteCount), active: siteCount > 0 },
        { label: 'Записей', hint: 'загружено в этот список', value: String(entries.length), active: entries.length > 0 },
        { label: 'Поиск по смыслу', hint: 'Qwen переранжирует находки', value: smartOn ? 'Включён' : 'Выключен', active: smartOn },
      ],
    });
  }, [onSummary, entries.length, todayCount, siteCount, smartOn]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(3) }}>
      {/* Управление разделом. Крестика тут больше нет — он один и стоит в шапке библиотеки. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: sp(2), flexWrap: 'wrap', position: 'relative' }}>
        {/* ⚠️ «Найти по смыслу» — СТРОКА-ДЕЙСТВИЕ, а не спрятанная палочка в поле ввода. Кнопка
            ✨ внутри поля включала переранжирование моделью, то есть отдельное решение ценой в
            секунды, и нажать её вслепую человек не мог. Теперь предложение появляется тогда,
            когда его есть чем выполнить, — при непустом запросе. */}
        {query.trim() && (
          <button
            onClick={() => { setSmartOn(true); void handleSmartSearch(); }}
            disabled={smartLoading}
            style={{ ...btnGhost, display: 'inline-flex', alignItems: 'center', gap: sp(2), opacity: smartLoading ? 0.6 : 1 }}
          >
            {smartLoading
              ? <Loader2 size={14} style={{ animation: 'oblako-spin 1s linear infinite' }} />
              : <Wand2 size={14} />}
            {smartLoading ? 'Qwen переранжирует…' : 'Найти по смыслу'}
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button
          onClick={() => setClearOpen((v) => !v)}
          style={{ ...btnGhost, display: 'inline-flex', alignItems: 'center', gap: sp(2) }}
        ><Trash2 size={14} /> Очистить</button>
        {clearOpen && (
          <div style={{
            position: 'absolute', top: 40, right: 0, zIndex: 200, minWidth: 190,
            ...islandPlate, borderRadius: RADIUS.box, overflow: 'hidden',
          }}>
            {CLEAR_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => void handleClear(opt.value)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: pad(2, 3),
                  background: 'none', border: 'none', cursor: 'default',
                  ...TEXT.body, color: 'var(--text-body)',
                  transition: motion.hover('background'),
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
              >{opt.label}</button>
            ))}
          </div>
        )}
      </div>

      {clearError && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: sp(2), padding: pad(2, 3),
          borderRadius: RADIUS.control, ...TEXT.body,
          background: 'color-mix(in srgb, var(--danger-500) 12%, transparent)',
          color: 'var(--danger-500)',
        }}>
          Не удалось очистить историю. Попробуйте ещё раз.
          <button onClick={() => setClearError(false)} style={{
            marginLeft: 'auto', background: 'none', border: 'none', cursor: 'default',
            color: 'inherit', display: 'flex', padding: 2,
          }}><X size={12} /></button>
        </div>
      )}

      {/* Реранк не отработал (упал/недоступна модель) — честно говорим, что порядок ниже это
          cosine top-k, а не решение Qwen (SmartSearchResponse.degraded). */}
      {smartResultsShown && smartDegraded && (
        <span style={{ ...TEXT.caption, color: 'var(--warning-500)' }}>
          Показан быстрый результат — AI не ответил, порядок по сходству, не по смыслу.
        </span>
      )}

      {entries.length === 0 ? (
        <EmptyState
          icon={query ? <SearchGlyph size={22} /> : <ClockGlyph size={22} />}
          title={query ? 'Ничего не нашлось' : 'История пуста'}
          hint={query
            ? 'Попробуйте другое слово — поиск смотрит и по заголовкам страниц, и по адресам.'
            : 'Страницы, которые вы откроете, появятся здесь по дням — и их можно будет найти словом из текста.'}
        />
      ) : smartResultsShown ? (
        // Умный поиск — плоский список в порядке релевантности: группировка по дню разрушила бы
        // этот порядок, раскидав находки по датам.
        <Rows>
          <GroupCap title="По смыслу" note={`${entries.length} ${plural(entries.length, 'находка', 'находки', 'находок')}`} />
          {entries.map((entry) => (
            <HistoryRow key={entry.id} entry={entry} onDelete={handleDelete} />
          ))}
        </Rows>
      ) : (
        <SplitView side={(
          <SideNav
            caption="когда"
            items={navItems.map((item) => ({ key: item.key, label: item.label }))}
            onPick={(key) => {
              const item = navItems.find((n) => n.key === key);
              if (item) scrollToDay(item.targetKey);
            }}
          />
        )}>
          <Rows>
            {dayGroups.map((group) => (
              <div
                key={group.key}
                ref={(el) => { if (el) dayRefs.current.set(group.key, el); else dayRefs.current.delete(group.key); }}
                // ⚠️ Раскладку и отрисовку невидимых дней браузер пропускает целиком
                // (content-visibility), а место под них резервирует по оценке высоты. История —
                // единственный раздел, где строк сотни: у закладок и отслеживания их десятки, и
                // там это не нужно. Именно эта пачка и давала «микрофриз» на открытии.
                //
                // ⚠️ Виртуализации тут нет намеренно: узлы ОСТАЮТСЯ в DOM, поэтому переход по
                // дню из левой навигации (scrollIntoView) продолжает работать, а поиск по
                // странице не перестаёт находить строки, которых «ещё нет».
                //
                // ⚠️ Оценка высоты нужна обязательно: без неё группа считается нулевой, полоса
                // прокрутки скачет по мере разворачивания дней. 44 px на строку — высота
                // HistoryRow, 34 — шапка дня.
                style={{
                  contentVisibility: 'auto',
                  containIntrinsicSize: `auto ${34 + group.entries.length * 44}px`,
                }}
              >
                <GroupCap
                  title={group.label}
                  note={`${group.entries.length} ${plural(group.entries.length, 'страница', 'страницы', 'страниц')}`}
                />
                {group.entries.map((entry) => (
                  <HistoryRow key={entry.id} entry={entry} onDelete={handleDelete} />
                ))}
              </div>
            ))}
          </Rows>
        </SplitView>
      )}
    </div>
  );
}

/** Русское склонение: 1 страница, 2 страницы, 5 страниц. */
function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

// Строка истории — общий рецепт библиотеки: слева время моноширинным (это данные, они обязаны
// стоять столбцом), значок сайта, имя дисплейной, адрес под ним.
//
// ⚠️ Адрес переехал ПОД заголовок. Раньше домен стоял справа от него в одной строке и отъедал
// ширину: длинные заголовки обрезались вдвое раньше, чем нужно, при том что сайт и так виден
// по значку.
function HistoryRow({ entry, onDelete }: { entry: HistoryEntry & { snippet?: string }; onDelete: (id: number) => void }) {
  return (
    <Row
      lead={timeOf(entry.lastVisit)}
      icon={<SiteFavicon url={entry.url} size={22} />}
      title={entry.title || entry.url}
      subtitle={entry.snippet ? `${domainOf(entry.url)} · ${entry.snippet}` : domainOf(entry.url)}
      title2={entry.url}
      onClick={() => { void window.oblako.createTab(entry.url); }}
      actions={(
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(entry.id); }}
          title="Удалить из истории"
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 26, height: 26, border: 'none', borderRadius: RADIUS.control,
            background: 'transparent', color: 'var(--text-faint)', cursor: 'default',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-sunken)'; e.currentTarget.style.color = 'var(--text-body)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-faint)'; }}
        ><X size={14} /></button>
      )}
    />
  );
}
