import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import { BREAK, CAPS, COL, NUMERIC, PAGE_MAX, TEXT, pad, sp } from './styles/system';
import {
  CapsLabel, Fact, InlineError, LoadingNote, Meter, Panel, Read,
  SectionHeader, SpotLine, btnGhost, btnTone, toneVars,
} from './components/settings/kit';
import { Sparkline } from './components/desktop/widgets';
import type { ResourceKind, ResourceProcess, ResourceSnapshot } from '../shared/ipc';

// Диспетчер задач (Shift+Esc): куда уходит память прямо сейчас.
//
// ⚠️ Зачем он нужен, если есть диспетчер Windows. Тот показывает процессы, но не знает, ЧТО в
// них: восемь одинаковых строк «Oblako» ничего не объясняют. Здесь у каждой строки есть имя, а у
// групп — подытог с долей, и на вопрос «куда ушла память» отвечает первый же экран.
//
// ⚠️ Главное число — Private Bytes. Working Set включает разделяемые страницы и файловый кэш (в
// том числе mmap-нутый файл модели), поэтому сумма по процессам его задваивает: замер 31.08.2026
// дал 2268 МБ private против 3133 МБ working set на одном состоянии. Падение working set к тому же
// ничего не стоит — страницы просто вытеснили.
//
// ⚠️ Опрос раз в секунду ИЗ ОКНА, а не пуш из main: пока окно закрыто, никто ничего не считает.
//
// ⚠️ Экран собран по системе настроек (макет — oblako-design/taskmanager-pass-1.html): у него ТОН
// раздела, шапка-плашка с зерном, лента внутри неё, цвет на ГРУППЕ. Первая версия была свёрстана
// мимо этого — одна серая земля на всё, — и разбор ошибки лежит в docs/design-taskmanager.md.

const TICK_MS = 1000;
/** Длина ленты истории: минута — столько, сколько человек готов смотреть, не отводя глаз. */
const HISTORY = 60;

// ── Группы ────────────────────────────────────────────────────────────────────
//
// ⚠️ Группировка — не украшение, а ответ на главный вопрос экрана. Плоский список из пятнадцати
// строк заставляет складывать в уме; «ядро 41 %, модель 41 %, вкладки 10 %» читается за секунду.
// ⚠️ Цвет живёт НА ГРУППЕ: точка у заголовка и полосы долей внутри. Красить строки по отдельности
// значило бы пятнадцать цветов на экране.
type GroupId = 'core' | 'model' | 'tabs' | 'service';

const GROUPS: { id: GroupId; title: string; tone: string; kinds: ResourceKind[] }[] = [
  { id: 'core', title: 'Ядро браузера', tone: 'var(--poster-tea)', kinds: ['main', 'gpu'] },
  { id: 'model', title: 'Локальная модель', tone: 'var(--poster-tangerine)', kinds: ['model'] },
  { id: 'tabs', title: 'Вкладки', tone: 'var(--poster-sky)', kinds: ['tab'] },
  { id: 'service', title: 'Панели и служебное', tone: 'var(--poster-neutral)', kinds: ['chrome', 'popover', 'utility', 'other'] },
];

function mb(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} ГБ`;
  return `${Math.round(bytes / 1024 / 1024)} МБ`;
}

/** Число в колонке: разряды моноширинные, иначе столбец не читается сверху вниз. */
function Num({ children, dim }: { children: React.ReactNode; dim?: boolean }) {
  return (
    <span style={{ ...TEXT.body, ...NUMERIC, color: dim ? 'var(--text-muted)' : 'var(--text-strong)' }}>
      {children}
    </span>
  );
}

/**
 * Ширина окна для выбора раскладки.
 *
 * ⚠️ В JS, а не медиазапросом: интерфейс собран инлайновыми стилями, и виджеты стола уже решают
 * то же самое так же (box.width в widgets.tsx). Два механизма адаптивности разошлись бы на первой
 * же правке.
 */
function useWindowWidth(): number {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

function Row({ p, share, tone, width, modelLoaded, onSleep, onUnload }: {
  p: ResourceProcess;
  share: number;
  tone: string;
  width: number;
  modelLoaded: boolean;
  onSleep: (tabId: string) => void;
  onUnload: () => void;
}) {
  // Действие есть не у каждой строки, и это правильно: ядро и графику «закрыть» нельзя, а
  // притворяться, что можно, — обманывать.
  const canSleep = p.kind === 'tab' && p.tabId !== null && !p.sleeping && !p.active;
  // ⚠️ Не «процесс инференса жив», а «модель загружена»: процесс поднимается заранее и без модели
  // весит немного, выгружать в нём нечего.
  const canUnload = p.kind === 'model' && modelLoaded;

  const cols: React.ReactNode[] = [
    <span key="p" style={{ display: 'block' }}>
      <Num>{p.privateBytes > 0 ? mb(p.privateBytes) : '—'}</Num>
      <span style={{ display: 'block', marginTop: sp(1) }}><Meter share={share} tone={tone} /></span>
    </span>,
  ];
  const widths: number[] = [COL.num];
  // ⚠️ Колонки уходят ПО ОДНОЙ и от наименее важного: сначала справочный рабочий набор, затем
  // процент. Главное число не уходит никогда — без него экрана нет.
  if (width > BREAK.wide) {
    cols.push(<Num key="w" dim>{p.workingSet > 0 ? mb(p.workingSet) : '—'}</Num>);
    widths.push(COL.num);
  }
  if (width > BREAK.mid) {
    cols.push(<Num key="c" dim={p.cpu < 5}>{p.cpu >= 0.5 ? `${p.cpu.toFixed(0)} %` : '—'}</Num>);
    widths.push(COL.narrow);
  }

  return (
    <div style={{ opacity: p.sleeping ? 0.55 : 1 }}>
      <SpotLine
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: sp(2), minWidth: 0 }}>
            {/* ⚠️ Активная вкладка помечена ТОЧКОЙ, а не заливкой строки: заливка в нашей системе
                значит «выбрано человеком», а тут состояние, которое сложилось само. */}
            {p.active && <span aria-label="открыта сейчас" style={{
              width: sp(2), height: sp(2), borderRadius: '50%', background: 'var(--success-500)', flex: 'none',
            }} />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
          </span>
        }
        hint={`${p.detail}${p.pid > 0 ? ` · ${p.pid}` : ''}`}
        cols={cols}
        colWidths={widths}
        control={
          canSleep
            ? <button type="button" style={btnGhost} onClick={() => onSleep(p.tabId!)}>Усыпить</button>
            : canUnload
              ? <button type="button" style={btnTone} onClick={onUnload}>Выгрузить</button>
              : undefined
        }
      />
    </div>
  );
}

function Group({ title, tone, items, total, heaviest, width, collapsible, modelLoaded, onSleep, onUnload }: {
  title: string;
  tone: string;
  items: ResourceProcess[];
  total: number;
  heaviest: number;
  width: number;
  collapsible: boolean;
  modelLoaded: boolean;
  onSleep: (tabId: string) => void;
  onUnload: () => void;
}) {
  // ⚠️ Служебная группа свёрнута по умолчанию: она длинная и почти всегда неинтересная, но
  // прятать её насовсем нельзя — именно в ней видно прогретые панели, которые не умирают.
  const [open, setOpen] = useState(!collapsible);
  if (items.length === 0) return null;
  const sum = items.reduce((s, p) => s + p.privateBytes, 0);

  return (
    // ⚠️ Тон группы кладётся ПЕРЕМЕННОЙ, как тон раздела в настройках: точку у заголовка рисует
    // CapsLabel по --section-tone, полосы долей — тот же цвет. Один источник на всю группу.
    <div style={{ ...toneVars(undefined), ['--section-tone' as string]: tone }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: sp(3) }}>
        <CapsLabel style={{ marginBottom: 0, color: 'var(--text-strong)' }}>{title}</CapsLabel>
        <span style={{ ...TEXT.caption, ...NUMERIC, marginLeft: 'auto' }}>
          {mb(sum)} · {total > 0 ? Math.round((sum / total) * 100) : 0} %{items.length > 1 ? ` · ${items.length} шт.` : ''}
        </span>
        {collapsible && (
          <button type="button" style={btnGhost} onClick={() => setOpen((v) => !v)}>
            {open ? 'Свернуть' : 'Показать'}
          </button>
        )}
      </div>
      {open && (
        <Panel style={{ marginTop: sp(2) }}>
          {items.map((p) => (
            <Row
              key={`${p.pid}-${p.tabId ?? p.title}`}
              p={p}
              share={p.privateBytes / Math.max(1, heaviest)}
              tone={tone}
              width={width}
              modelLoaded={modelLoaded}
              onSleep={onSleep}
              onUnload={onUnload}
            />
          ))}
        </Panel>
      )}
    </div>
  );
}

function TaskManager() {
  const [snap, setSnap] = useState<ResourceSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const history = useRef<number[]>([]);
  const width = useWindowWidth();

  useEffect(() => {
    void window.taskManager.getTheme()
      .then((t) => {
        const dark = t.mode === 'dark' || (t.mode === 'system' && t.systemDark);
        document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
        if (t.palette) document.documentElement.setAttribute('data-palette', t.palette);
      })
      .catch(() => { /* тема останется светлой — не повод не показывать числа */ });
  }, []);

  const pull = useCallback(async () => {
    try {
      const s = await window.taskManager.getSnapshot();
      history.current = [...history.current, s.totals.privateBytes].slice(-HISTORY);
      setSnap(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void pull();
    const t = setInterval(() => { void pull(); }, TICK_MS);
    return () => clearInterval(t);
  }, [pull]);

  const grouped = useMemo(() => {
    const all = snap?.processes ?? [];
    return GROUPS.map((g) => ({
      ...g,
      // Внутри группы — по цене: ответ «кто съел» обязан быть первой строкой.
      items: all.filter((p) => g.kinds.includes(p.kind)).sort((a, b) => b.privateBytes - a.privateBytes),
    }));
  }, [snap]);
  const heaviest = Math.max(1, ...(snap?.processes ?? []).map((p) => p.privateBytes));

  const onSleep = useCallback((tabId: string) => {
    void window.taskManager.sleepTab(tabId).then(() => pull());
  }, [pull]);
  const onUnload = useCallback(() => {
    void window.taskManager.unloadModel().then(() => pull());
  }, [pull]);

  const ramUsed = snap ? snap.machine.ramTotalBytes - snap.machine.ramFreeBytes : 0;
  const ramShare = snap ? ramUsed / Math.max(1, snap.machine.ramTotalBytes) : 0;
  const vramTotal = snap?.machine.vramTotalBytes ?? null;
  const vramFree = snap?.machine.vramFreeBytes ?? null;
  const vramUsed = vramTotal !== null && vramFree !== null ? vramTotal - vramFree : null;
  const modelRow = snap?.processes.find((p) => p.kind === 'model') ?? null;

  // ⚠️ Плитка перестраивается по ширине, а не «плывёт» auto-fit: у клеток РАЗНЫЙ вес, и при
  // автозаполнении график то занимает пол-экрана, то ужимается в колонку с фактами. Четыре
  // колонки на широком, две на среднем, одна на узком — и график всегда во всю ширину плитки.
  const tileCols = width > BREAK.wide ? 4 : width > BREAK.narrow ? 2 : 1;
  // Высокая клетка только там, где рядом есть что поставить: в одну колонку она бессмысленна.
  const chartTall = tileCols === 4;
  const lo = history.current.length > 0 ? Math.min(...history.current) : 0;
  const hi = history.current.length > 0 ? Math.max(...history.current) : 0;
  const trendHint = history.current.length > 1
    ? `от ${mb(lo)} до ${mb(hi)} · сейчас ${mb(history.current[history.current.length - 1]!)}`
    : 'копим историю…';

  return (
    // ⚠️ Тон экрана — ЧАЙ, и кладётся он ровно так же, как тон раздела настроек: переменными на
    // контейнере (см. Settings.tsx). Отсюда цвет берут и плашка шапки, и кнопка действия.
    // ⚠️ Поля ровно pad(6, 8): отрицательные margin шапки вычитают именно их, иначе плашка
    // вылезает за содержимое.
    <div style={{
      minHeight: '100vh', background: 'var(--app-bg)', color: 'var(--text-body)',
      maxWidth: PAGE_MAX.board, marginInline: 'auto', width: '100%',
      padding: pad(6, 8), display: 'flex', flexDirection: 'column', gap: sp(6),
      ...toneVars('tea'),
    }}>
      <SectionHeader
        title="Диспетчер задач"
        hero={snap ? mb(snap.totals.privateBytes) : '—'}
        heroLabel={snap
          ? `занято браузером · ${mb(snap.totals.workingSet)} рабочий набор · ${snap.processes.length} процессов`
          : 'считаем…'}
      />

      {error && <InlineError>Снимок не пришёл: {error}</InlineError>}

      {/* ⚠️ ПЛИТКА, а не ровный ряд одинаковых карточек. Пять равных прямоугольников не говорят,
          что важнее; у графика есть форма и время — он старший и занимает две клетки на две.
          ⚠️ График живёт ЗДЕСЬ, а не на цветной плашке: на насыщенном чае тонкая линия тонула —
          краска перебивала графику. На спокойной поверхности карточки он наконец читается. */}
      <div style={{
        display: 'grid', gap: sp(3),
        gridTemplateColumns: `repeat(${tileCols}, minmax(0, 1fr))`,
        gridAutoRows: 'minmax(112px, auto)',
      }}>
        <div style={{ gridColumn: `span ${Math.min(2, tileCols)}`, gridRow: chartTall ? 'span 2' : 'span 1' }}>
          <Fact
            label="Динамика за минуту"
            hint={trendHint}
            value=""
            foot={
              <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: sp(1) }}>
                <Sparkline
                  values={history.current.length > 1 ? history.current : [0, 0]}
                  height={chartTall ? sp(8) * 4 : sp(8) * 3}
                  color="var(--section-tone, var(--accent))"
                  fill="color-mix(in srgb, var(--section-tone, var(--accent)) 34%, transparent)"
                />
                <div style={{ ...CAPS, display: 'flex', justifyContent: 'space-between' }}>
                  <span>минуту назад</span><span>сейчас</span>
                </div>
              </div>
            }
          />
        </div>
        <Fact
          label="Память машины"
          hint={snap ? `${mb(ramUsed)} из ${mb(snap.machine.ramTotalBytes)}` : undefined}
          value={snap ? `${Math.round(ramShare * 100)} %` : '—'}
          foot={<Meter share={ramShare} />}
        />
        <Fact
          label="Видеопамять"
          hint={vramTotal !== null
            ? `${vramUsed !== null ? mb(vramUsed) : '—'} из ${mb(vramTotal)}${snap?.machine.gpuBackend ? ` · ${snap.machine.gpuBackend}` : ''}`
            : 'не определена'}
          value={vramTotal && vramUsed !== null ? `${Math.round((vramUsed / vramTotal) * 100)} %` : '—'}
          foot={<Meter share={vramTotal && vramUsed !== null ? vramUsed / vramTotal : 0} />}
        />
        <Fact
          label="Процессор"
          hint={snap ? `${snap.processes.length} процессов` : undefined}
          value={snap ? `${snap.totals.cpu.toFixed(0)} %` : '—'}
          foot={<Meter share={snap ? snap.totals.cpu / 100 : 0} />}
        />
        <Fact
          label="Локальная модель"
          hint={snap?.loadedModelId ?? 'не загружена'}
          value={modelRow ? mb(modelRow.privateBytes) : '—'}
          foot={<Meter
            share={modelRow && snap ? modelRow.privateBytes / Math.max(1, snap.totals.privateBytes) : 0}
            tone="var(--poster-tangerine)"
          />}
        />
      </div>

      {snap === null && <LoadingNote />}

      {grouped.map((g) => (
        <Group
          key={g.id}
          title={g.title}
          tone={g.tone}
          items={g.items}
          total={snap?.totals.privateBytes ?? 0}
          heaviest={heaviest}
          width={width}
          collapsible={g.id === 'service'}
          modelLoaded={snap?.loadedModelId != null}
          onSleep={onSleep}
          onUnload={onUnload}
        />
      ))}

      {/* ⚠️ Сноска не украшение: без неё два числа выглядят как «одно и то же, но почему-то
          разное», и человек перестаёт доверять обоим. */}
      <Read>
        «Занято» — приватная память процесса, то, что он реально забрал у системы. «Рабочий набор»
        больше, потому что включает разделяемые страницы и файловый кэш — в том числе файл модели,
        отображённый в память. Падение рабочего набора не означает, что память освободилась.
      </Read>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<TaskManager />);
