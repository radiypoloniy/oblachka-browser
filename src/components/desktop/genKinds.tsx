import { useEffect, useMemo, useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import { TileCaption, TileValue } from './widgets';
import { RADIUS, TEXT, motion, pad, sp } from '../../styles/system';
import { daysUntil, genSourceLabel, type GenSpec, type GenRuntime, type GenSource, type GenItem } from '../../../shared/genSpec';
import { genClockLeftMs } from '../../../shared/genWidget';

// Восемь плиток каталога — нарисованы РУКАМИ, как «Погода» и «Часы».
//
// ⚠️ Это и есть смысл смены архитектуры: модель сюда не пишет ни строчки кода. Она отдала
// {kind, title, поля} — дальше работает обычный React в дизайн-системе. Отсюда следует всё
// остальное: плитка не может выйти пустой, всегда выглядит как стол, и её можно редактировать,
// потому что редактировать надо данные, а не разметку.
//
// ⚠️ Кегли считаются от РАЗМЕРА ПЛИТКИ, а не заданы числом: одна и та же спека живёт и в
// квадрате 2×2, и в широкой 4×2, и в большой 4×4.

export interface KindProps {
  spec: GenSpec;
  box: { width: number; height: number };
  hero?: boolean;
  runtime: GenRuntime;
  onRuntime: (next: GenRuntime) => void;
}

/** Кегль под ширину строки: длинная цитата обязана уменьшаться, а не обрезаться. */
function fitText(text: string, box: { width: number; height: number }, max: number): number {
  const len = Math.max(text.length, 1);
  const byWidth = (box.width - sp(8)) / (len * 0.52);
  const byHeight = box.height * (len > 40 ? 0.16 : len > 18 ? 0.24 : 0.3);
  return Math.round(Math.max(14, Math.min(max, byWidth, byHeight)));
}

const shell = (): React.CSSProperties => ({
  position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
  padding: pad(4), gap: sp(2),
});

const centre: React.CSSProperties = {
  flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center',
};

const subLine: React.CSSProperties = { ...TEXT.body, color: 'var(--text-faint)', marginTop: sp(1) };

// ── Список: один элемент, клик меняет ────────────────────────────────────────
export function GenList({ spec, box, hero }: KindProps) {
  const items = spec.items ?? [];
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * Math.max(items.length, 1)));
  useEffect(() => { setIdx(Math.floor(Math.random() * Math.max(items.length, 1))); }, [spec, items.length]);
  const item = items[Math.min(idx, items.length - 1)];
  const main = item?.main ?? '';
  return (
    <button
      type="button"
      onClick={() => {
        if (items.length < 2) return;
        let n = Math.floor(Math.random() * items.length);
        if (n === idx) n = (n + 1) % items.length;
        setIdx(n);
      }}
      style={{ ...shell(), border: 'none', background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'default', font: 'inherit' }}
    >
      <TileCaption>{spec.title}</TileCaption>
      <div style={centre}>
        <TileValue size={fitText(main, box, 52)} hero={hero} style={{ lineHeight: 1.15, overflowWrap: 'break-word' }}>
          {main}
        </TileValue>
        {!!item?.sub && <div style={subLine}>{item.sub}</div>}
      </div>
    </button>
  );
}

// ── Жребий: бросок с анимацией ───────────────────────────────────────────────
export function GenDice({ spec, box, hero }: KindProps) {
  // ⚠️ Две формы: диапазон чисел и список строк. Диапазон разворачивается в те же «грани»,
  // чтобы перебор при броске выглядел одинаково — это одна механика, а не две.
  const items: GenItem[] = useMemo(() => {
    if (typeof spec.from === 'number' && typeof spec.to === 'number') {
      const span = spec.to - spec.from + 1;
      // Перебирать тысячу чисел незачем: для показа хватает первых, итог всё равно случайный.
      const shown = Math.min(span, 60);
      return Array.from({ length: shown }, (_, i) => ({ main: String(spec.from! + i) }));
    }
    return spec.items ?? [];
  }, [spec]);
  const [idx, setIdx] = useState(0);
  const [rolling, setRolling] = useState(false);
  // ⚠️ Бросок ПОКАЗЫВАЕТСЯ, а не просто меняет строку: без перебора граней нажатие выглядит
  // как «ничего не произошло», особенно когда выпало то же самое.
  useEffect(() => {
    if (!rolling) return;
    const t = window.setInterval(() => setIdx((n) => (n + 1) % Math.max(items.length, 1)), 70);
    const stop = window.setTimeout(() => setRolling(false), 620);
    return () => { window.clearInterval(t); window.clearTimeout(stop); };
  }, [rolling, items.length]);
  const item = items[Math.min(idx, items.length - 1)];
  const main = item?.main ?? '';
  return (
    <button
      type="button"
      onClick={() => { if (!rolling && items.length > 1) setRolling(true); }}
      style={{ ...shell(), border: 'none', background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'default', font: 'inherit' }}
    >
      <TileCaption>{spec.title}</TileCaption>
      <div style={{ ...centre, opacity: rolling ? 0.55 : 1, transition: motion.hover('opacity') }}>
        <TileValue size={fitText(main, box, 48)} hero={hero} style={{ lineHeight: 1.15, overflowWrap: 'break-word' }}>
          {main}
        </TileValue>
        {!!item?.sub && !rolling && <div style={subLine}>{item.sub}</div>}
      </div>
      <div style={{ ...TEXT.caption }}>{rolling ? 'Бросаю…' : 'Нажмите, чтобы бросить'}</div>
    </button>
  );
}

// ── Счётчик ──────────────────────────────────────────────────────────────────
export function GenCounter({ spec, box, hero, runtime, onRuntime }: KindProps) {
  const step = spec.step ?? 1;
  const value = runtime.value ?? spec.start ?? 0;
  const shown = `${value}`;
  return (
    <div style={shell()}>
      <TileCaption>{spec.title}</TileCaption>
      <div style={centre}>
        <TileValue size={fitText(shown, box, 64)} hero={hero}>{shown}</TileValue>
        {!!spec.unit && <div style={subLine}>{spec.unit}</div>}
      </div>
      <div style={{ display: 'flex', gap: sp(2) }}>
        <StepButton label="−" onClick={() => onRuntime({ ...runtime, value: value - step })} />
        <StepButton label="+" accent onClick={() => onRuntime({ ...runtime, value: value + step })} />
      </div>
    </div>
  );
}

// ── Цель: кольцо прогресса ───────────────────────────────────────────────────
export function GenGoal({ spec, box, hero, runtime, onRuntime }: KindProps) {
  const target = spec.target ?? 1;
  const value = Math.max(0, Math.min(target, runtime.value ?? spec.start ?? 0));
  const ratio = target > 0 ? value / target : 0;
  const side = Math.round(Math.min(box.width, box.height) * 0.46);
  const stroke = Math.max(6, Math.round(side * 0.12));
  const r = (side - stroke) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <div style={shell()}>
      <TileCaption>{spec.title}</TileCaption>
      <div style={{ ...centre, alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'relative', width: side, height: side }}>
          <svg width={side} height={side} style={{ display: 'block', transform: 'rotate(-90deg)' }}>
            <circle cx={side / 2} cy={side / 2} r={r} fill="none" stroke="var(--divider)" strokeWidth={stroke} />
            <circle
              cx={side / 2} cy={side / 2} r={r} fill="none" stroke="var(--accent)" strokeWidth={stroke}
              strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - ratio)}
              style={{ transition: motion.state('stroke-dashoffset') }}
            />
          </svg>
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <TileValue size={Math.round(side * 0.3)} hero={hero}>{value}</TileValue>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: sp(2) }}>
        <span style={{ ...TEXT.caption, flex: 1 }}>
          из {target}{spec.unit ? ` ${spec.unit}` : ''}
        </span>
        <StepButton label="+" accent onClick={() => onRuntime({ ...runtime, value: Math.min(target, value + 1) })} />
      </div>
    </div>
  );
}

// ── Чек-лист ─────────────────────────────────────────────────────────────────
export function GenChecklist({ spec, runtime, onRuntime }: KindProps) {
  const items = spec.items ?? [];
  const done = new Set(runtime.done ?? []);
  const allDone = items.length > 0 && done.size >= items.length;
  return (
    <div style={shell()}>
      <div style={{ display: 'flex', alignItems: 'center', gap: sp(2) }}>
        <TileCaption>{spec.title}</TileCaption>
        <span style={{ flex: 1 }} />
        {done.size > 0 && (
          <button
            type="button"
            title="Сбросить"
            onClick={() => onRuntime({ ...runtime, done: [] })}
            style={{
              border: 'none', background: 'transparent', color: 'var(--text-faint)',
              cursor: 'default', padding: 0, display: 'inline-flex',
            }}
          ><RotateCcw size={14} /></button>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: sp(1) }}>
        {items.map((it, i) => {
          const on = done.has(i);
          return (
            <button
              key={`${it.main}-${i}`}
              type="button"
              onClick={() => {
                const next = new Set(done);
                if (on) next.delete(i); else next.add(i);
                onRuntime({ ...runtime, done: [...next].sort((a, b) => a - b) });
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: sp(2), textAlign: 'left',
                border: 'none', background: 'transparent', cursor: 'default', padding: `${sp(1)}px 0`,
                color: 'inherit', font: 'inherit',
              }}
            >
              <span style={{
                width: 18, height: 18, flex: 'none', borderRadius: RADIUS.tight,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: on ? 'var(--accent)' : 'transparent',
                border: on ? 'none' : '1.5px solid var(--divider-strong)',
                color: 'var(--on-accent)', transition: motion.hover('background', 'border-color'),
              }}>{on && <Check size={12} strokeWidth={3} />}</span>
              <span style={{
                ...TEXT.body, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                opacity: on ? 0.5 : 1, textDecoration: on ? 'line-through' : 'none',
              }}>{it.main}</span>
            </button>
          );
        })}
      </div>
      {allDone && <div style={{ ...TEXT.caption, color: 'var(--success-500)' }}>Всё готово</div>}
    </div>
  );
}

// ── Отсчёт до даты ───────────────────────────────────────────────────────────
export function GenCountdown({ spec, box, hero }: KindProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Раз в минуту: день меняется редко, а держать таймер на 250 мс ради этого незачем.
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  const left = daysUntil(spec.date ?? '', now);
  const shown = left > 0 ? `${left}` : left === 0 ? 'Сегодня' : `${-left}`;
  return (
    <div style={shell()}>
      <TileCaption>{spec.title}</TileCaption>
      <div style={centre}>
        <TileValue size={fitText(shown, box, 64)} hero={hero}>{shown}</TileValue>
        <div style={subLine}>
          {left > 0 ? plural(left, 'день', 'дня', 'дней') : left === 0 ? 'Тот самый день' : plural(-left, 'день назад', 'дня назад', 'дней назад')}
        </div>
      </div>
    </div>
  );
}

// ── Заметка ──────────────────────────────────────────────────────────────────
export function GenNote({ spec, box, hero }: KindProps) {
  const text = spec.text ?? '';
  return (
    <div style={shell()}>
      <TileCaption>{spec.title}</TileCaption>
      <div style={centre}>
        <TileValue size={fitText(text, box, 34)} hero={hero} style={{ lineHeight: 1.2, overflowWrap: 'break-word' }}>
          {text}
        </TileValue>
      </div>
    </div>
  );
}

// ── Из браузера: лента ───────────────────────────────────────────────────────
// ⚠️ Данные берёт ХОСТ и в момент показа. Модель знает про браузер ровно ничего: на просьбу
// «список последних посещённых сайтов» она честно выдумывала («Счастье — внутри вас»).
// Выдумать историю нельзя, её можно только взять — поэтому модель выбирает источник, а не
// содержимое. Побочный выигрыш: плитка всегда свежая, а не застывшая на момент сборки.

interface FeedRow { main: string; sub?: string; url?: string }

async function readFeed(source: GenSource, rows: number): Promise<FeedRow[]> {
  const host = (u: string): string => {
    try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; }
  };
  try {
    if (source === 'history') {
      const raw = await window.oblako.getHistory(rows * 4);
      const seen = new Set<string>();
      const out: FeedRow[] = [];
      for (const e of raw) {
        // Один сайт — одна строка: без склейки лента превращается в двадцать заходов на почту.
        const h = host(e.url);
        if (seen.has(h)) continue;
        seen.add(h);
        out.push({ main: e.title || h, sub: h, url: e.url });
        if (out.length >= rows) break;
      }
      return out;
    }
    if (source === 'topsites') {
      const raw = await window.oblako.getRecommendedSites();
      return raw.slice(0, rows).map((r) => ({ main: r.title || host(r.url), sub: host(r.url), url: r.url }));
    }
    if (source === 'tabs') {
      const raw = await window.oblako.getAllTabs();
      return raw
        .filter((t) => t.kind === 'page')
        .slice(0, rows)
        .map((t) => ({ main: t.title || host(t.url), sub: host(t.url), url: t.url }));
    }
    const raw = await window.oblako.getDownloads();
    return raw.slice(0, rows).map((d) => ({ main: d.filename, sub: host(d.url) }));
  } catch {
    return [];
  }
}

export function GenFeed({ spec, onOpen }: KindProps & { onOpen?: (url: string) => void }) {
  const source = spec.source ?? 'history';
  const rows = spec.rows ?? 5;
  const [data, setData] = useState<FeedRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    void readFeed(source, rows).then((d) => { if (alive) setData(d); });
    return () => { alive = false; };
  }, [source, rows]);
  return (
    <div style={shell()}>
      <TileCaption>{spec.title || genSourceLabel(source)}</TileCaption>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: sp(1) }}>
        {data === null && <span style={{ ...TEXT.caption }}>Смотрю…</span>}
        {data?.length === 0 && <span style={{ ...TEXT.caption }}>Пока пусто</span>}
        {data?.map((r, i) => (
          <button
            key={`${r.main}-${i}`}
            type="button"
            onClick={() => { if (r.url && onOpen) onOpen(r.url); }}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0,
              border: 'none', background: 'transparent', cursor: 'default', padding: `${sp(1)}px 0`,
              color: 'inherit', font: 'inherit', textAlign: 'left', width: '100%', minWidth: 0,
            }}
          >
            <span style={{
              ...TEXT.body, width: '100%', overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{r.main}</span>
            {!!r.sub && (
              <span style={{
                ...TEXT.caption, width: '100%', overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{r.sub}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Из браузера: число ───────────────────────────────────────────────────────
async function readStat(source: GenSource): Promise<{ value: number; unit: string }> {
  try {
    if (source === 'tabs') {
      const tabs = await window.oblako.getAllTabs();
      return { value: tabs.filter((t) => t.kind === 'page').length, unit: 'вкладок' };
    }
    if (source === 'blocked') {
      const st = await window.oblako.getAdBlockState();
      return { value: st.sessionBlockCount, unit: 'за сеанс' };
    }
    const dl = await window.oblako.getDownloads();
    return { value: dl.length, unit: 'файлов' };
  } catch {
    return { value: 0, unit: '' };
  }
}

export function GenStat({ spec, box, hero }: KindProps) {
  const source = spec.source ?? 'tabs';
  const [stat, setStat] = useState<{ value: number; unit: string } | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () => { void readStat(source).then((v) => { if (alive) setStat(v); }); };
    read();
    // Число из браузера обязано быть живым: вкладки открывают и закрывают, пока плитка на виду.
    const t = window.setInterval(read, 5000);
    return () => { alive = false; window.clearInterval(t); };
  }, [source]);
  const shown = stat ? String(stat.value) : '—';
  return (
    <div style={shell()}>
      <TileCaption>{spec.title || genSourceLabel(source)}</TileCaption>
      <div style={centre}>
        <TileValue size={fitText(shown, box, 64)} hero={hero}>{shown}</TileValue>
        {!!stat?.unit && <div style={subLine}>{stat.unit}</div>}
      </div>
    </div>
  );
}

// ── Таймер ───────────────────────────────────────────────────────────────────
// ⚠️ Ход таймера считает НЕ этот компонент: стол снимается при уходе на сайт, и setInterval
// вместе с ним умирает. На диске лежит endAt, а сигнал даёт genClocks в хроме окна.
export function GenTimerTile({ spec, box, hero, clock, onStart, onPause, onReset }: KindProps & {
  clock: { endAt: number; durationMs: number; leftMs: number; beeped: boolean } | null;
  onStart: () => void; onPause: () => void; onReset: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!clock || clock.endAt <= 0) return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [clock]);
  const durationMs = (spec.seconds ?? 1500) * 1000;
  const leftMs = clock ? genClockLeftMs(clock, now) : durationMs;
  const shown = formatClock(leftMs);
  const running = !!clock && clock.endAt > 0;
  return (
    <div style={shell()}>
      <TileCaption>{spec.title}</TileCaption>
      <div style={centre}>
        {/* ⚠️ Потолок ниже, чем у остальных чисел, и это не вкусовщина: под таймером ЕЩЁ ДВЕ
            КНОПКИ, и на маленькой плитке цифры при общем потолке вылезали за края. */}
        <TileValue size={fitText(shown, box, 44)} hero={hero}>{shown}</TileValue>
        <div style={subLine}>{clock?.beeped ? 'Готово' : running ? 'Идёт' : 'Пауза'}</div>
      </div>
      <div style={{ display: 'flex', gap: sp(2) }}>
        <StepButton label={running ? 'Пауза' : clock?.beeped ? 'Ещё раз' : 'Старт'} accent onClick={running ? onPause : onStart} />
        <StepButton label="Сброс" onClick={onReset} />
      </div>
    </div>
  );
}

function formatClock(ms: number): string {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function StepButton({ label, accent, onClick }: { label: string; accent?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...TEXT.body, flex: 1, border: 'none', cursor: 'default', padding: pad(2, 3),
        borderRadius: RADIUS.control, fontWeight: 600,
        background: accent ? 'var(--accent)' : 'var(--card-chip)',
        color: accent ? 'var(--on-accent)' : 'inherit',
        transition: motion.hover('background'),
      }}
    >{label}</button>
  );
}

/** Сколько элементов помещается — используется окном сборки для подсказки о размере. */
export function genFitsRows(box: { height: number }): number {
  return Math.max(1, Math.floor((box.height - sp(8) * 2) / 26));
}

export const GEN_KIND_RENDERERS = {
  list: GenList,
  dice: GenDice,
  counter: GenCounter,
  checklist: GenChecklist,
  goal: GenGoal,
  countdown: GenCountdown,
  note: GenNote,
  feed: GenFeed,
  stat: GenStat,
} as const;
