import { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import {
  AnalogFace,
  WideTypeClock,
  WideClusterClock,
  CalendarFace,
  TimerLayout,
} from './components/desktop/clockFaces';
import { CAPS, DISPLAY, RADIUS, TEXT, motion, pad, sp } from './styles/system';
import type { CSSProperties } from 'react';

// Временный стенд лиц часов. Сносится вместе с невыбранными вариантами.
//
// ⚠️ Плитки показаны В РЕАЛЬНЫХ ПИКСЕЛЯХ СЕТКИ СТОЛА, а не «примерно широкими». Первая версия
// стенда рисовала произвольные 480×200, и по ней нельзя было судить о том, что получится:
// у стола клетка 120 и зазор 14, то есть 2×2 — это ровно 254×254, а 4×2 — 522×254. Вывод
// «узкие и длинные часы — промашка» был сделан по стенду, а не по столу: столько места, сколько
// занимала полоса времени на стенде, на столе не бывает вовсе.
const CELL = 120;
const GAP = 14;
const tile = (w: number, h: number): { w: number; h: number } => ({
  w: w * CELL + (w - 1) * GAP,
  h: h * CELL + (h - 1) * GAP,
});
const T_SMALL = tile(2, 2);
// Мелкий масштаб стола: клетка 110 вместо 120 (см. SCALE_PRESETS). Жалоба на нечитаемые даты
// пришла именно с него, поэтому календарь показываем и в нём.
const T_SMALL_COMPACT = { w: 2 * 110 + 14, h: 2 * 110 + 14 };
const T_WIDE = tile(4, 2);
const T_LARGE = tile(4, 4);

const SUNRISE = 6 * 60 + 12;
const SUNSET = 20 * 60 + 5;

const PHASES: { id: string; label: string; stamp: Date | null }[] = [
  { id: 'live', label: 'сейчас', stamp: null },
  { id: 'dawn', label: 'утро', stamp: atHour(6, 10) },
  { id: 'noon', label: 'полдень', stamp: atHour(12, 0) },
  { id: 'sunset', label: 'закат', stamp: atHour(19, 40) },
  { id: 'night', label: 'ночь', stamp: atHour(23, 15) },
];

function atHour(h: number, m: number): Date {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

function mixNow(frozen: Date | null, live: Date): Date {
  if (!frozen) return live;
  const d = new Date(live);
  d.setHours(frozen.getHours(), frozen.getMinutes(), live.getSeconds(), live.getMilliseconds());
  return d;
}

function ClockStand() {
  const [live, setLive] = useState(() => new Date());
  const [phase, setPhase] = useState('live');
  const [dark, setDark] = useState(true);
  const frozen = PHASES.find((p) => p.id === phase)?.stamp ?? null;
  const now = mixNow(frozen, live);

  // Тема переключается прямо на стенде: лица живут и на светлом столе, и на тёмном, и решение
  // «берём этот вариант» нельзя принимать, увидев только одну сторону.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }, [dark]);

  useEffect(() => {
    const t = window.setInterval(() => setLive(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <div style={{
      minHeight: '100%',
      background: 'var(--canvas)',
      color: 'var(--text-body)',
      padding: pad(8, 6),
    }}>
      <header style={{ maxWidth: 1120, margin: `0 auto ${sp(6)}px` }}>
        <div style={{ ...CAPS, marginBottom: sp(2) }}>стенд · часы и календарь</div>
        <h1 style={{ ...DISPLAY, fontSize: 32, fontWeight: 700, color: 'var(--text-strong)', margin: 0 }}>
          Причёсано по рефам
        </h1>
        <p style={{ ...TEXT.body, maxWidth: 680, margin: `${sp(3)}px 0 0` }}>
          Плитки в настоящих размерах сетки стола: 2×2 — 254 px, 4×2 — 522×254, 4×4 — 522×522.
          Календарь набран трекингом вместо растянутых букв, таймер собран внутрь плитки.
        </p>
        <div style={{ display: 'flex', gap: sp(2), marginTop: sp(4), flexWrap: 'wrap' }}>
          {PHASES.map((p) => (
            <Chip key={p.id} on={p.id === phase} onClick={() => setPhase(p.id)}>{p.label}</Chip>
          ))}
          <span style={{ width: sp(4) }} />
          <Chip on={dark} onClick={() => setDark((v) => !v)}>{dark ? 'тёмная' : 'светлая'}</Chip>
        </div>
      </header>

      <main style={{
        maxWidth: 1120, margin: '0 auto',
        display: 'flex', flexDirection: 'column', gap: sp(8),
      }}>
        <Section n="1" title="Набор на всю ширину" hint="Оставлен как был — растяжение здесь и есть характер. Небо по фазе дня.">
          <Frame size={T_WIDE} label="4×2" fill="none">
            <WideTypeClock now={now} sunrise={SUNRISE} sunset={SUNSET} />
          </Frame>
        </Section>

        <Section n="2" title="Кластер: циферблат, дата, полоса" hint="Полоса времени больше не тянет буквы: кегль подобран, ширина добрана трекингом.">
          <Frame size={T_WIDE} label="4×2">
            <WideClusterClock now={now} seconds />
          </Frame>
        </Section>

        <Section n="3" title="Календарь месяца" hint="По рефу с печатными карточками: слово месяца целыми буквами, номер месяца вторым фокусом, времени внутри нет.">
          <div style={{ display: 'flex', gap: sp(4), flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <Frame size={T_SMALL_COMPACT} label="2×2 · мелкий масштаб">
              <CalendarFace now={now} />
            </Frame>
            <Frame size={T_SMALL} label="2×2 · средний">
              <CalendarFace now={now} />
            </Frame>
            <Frame size={T_SMALL} label="2×2 · чернила" fill="ink">
              <CalendarFace now={now} />
            </Frame>
            <Frame size={T_SMALL} label="2×2 · цветная" fill="accent">
              <CalendarFace now={now} />
            </Frame>
            <Frame size={T_LARGE} label="4×4">
              <CalendarFace now={now} />
            </Frame>
          </div>
        </Section>

        <Section n="A" title="Циферблат" hint="Клинья 12/3/6/9, тупые стрелки. Уже подключён к виджету часов на столе.">
          <div style={{ display: 'flex', gap: sp(4) }}>
            <Frame size={T_SMALL} label="2×2 · плитка">
              <Center><AnalogFace size={T_SMALL.h - 48} now={now} seconds /></Center>
            </Frame>
            <Frame size={T_SMALL} label="2×2 · чернила" fill="ink">
              <Center><AnalogFace size={T_SMALL.h - 48} now={now} seconds /></Center>
            </Frame>
            <Frame size={T_SMALL} label="2×2 · цветная" fill="accent">
              <Center><AnalogFace size={T_SMALL.h - 48} now={now} seconds /></Center>
            </Frame>
          </div>
        </Section>

        <Section n="T" title="Таймер" hint="Выбор длительности внутри плитки, ход показывает обводка всей плитки, время занимает всё поле.">
          <div style={{ display: 'flex', gap: sp(4), flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <Frame size={T_SMALL} label="2×2 · плитка">
              <TimerDemo w={T_SMALL.w} h={T_SMALL.h} />
            </Frame>
            <Frame size={T_SMALL} label="2×2 · чернила" fill="ink">
              <TimerDemo w={T_SMALL.w} h={T_SMALL.h} />
            </Frame>
            <Frame size={T_WIDE} label="4×2" fill="ink">
              <TimerDemo w={T_WIDE.w} h={T_WIDE.h} />
            </Frame>
          </div>
        </Section>
      </main>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...TEXT.body, fontWeight: 600,
        border: 'none', cursor: 'default',
        padding: pad(2, 4), borderRadius: RADIUS.pill,
        background: on ? 'var(--accent)' : 'var(--surface)',
        color: on ? 'var(--on-accent)' : 'var(--text-body)',
        boxShadow: on ? 'none' : 'var(--shadow-lvl1)',
        transition: motion.hover('background', 'color'),
      }}
    >{children}</button>
  );
}

function Section({ n, title, hint, children }: {
  n: string; title: string; hint: string; children: ReactNode;
}) {
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: sp(3), marginBottom: sp(2) }}>
        <span style={{ ...CAPS, color: 'var(--accent)' }}>{n}</span>
        <h2 style={{ ...TEXT.section, margin: 0 }}>{title}</h2>
      </div>
      <p style={{ ...TEXT.caption, margin: `0 0 ${sp(3)}px`, maxWidth: '68ch' }}>{hint}</p>
      {children}
    </section>
  );
}

// Заливка плитки. ⚠️ Красит ПЛИТКА, а не лицо: на столе фон даёт виджет (или выбор человека),
// и лицо обязано ложиться на любой. Прежняя версия красила себя сама — на тёмной теме карточки
// выворачивались в белые и дрались с фоном стола.
type Fill = 'card' | 'ink' | 'accent' | 'none';

// ⚠️ Каждая заливка объявляет --tile-bg — ту же переменную, что на столе объявляет Tile.
// Без неё лица не знают, на чём стоят, и кнопки таймера красятся мимо (см. TILE_BG в clockFaces).
const FILLS: Record<Fill, CSSProperties> = {
  card: {
    background: 'var(--surface)', color: 'var(--text-strong)',
    boxShadow: 'var(--shadow-lvl2), var(--inner-light)',
    ['--tile-bg' as string]: 'var(--surface)',
    ['--tile-ink' as string]: 'var(--text-strong)',
  },
  ink: {
    background: 'var(--text-strong)', color: 'var(--app-bg)',
    ['--tile-bg' as string]: 'var(--text-strong)',
    ['--tile-ink' as string]: 'var(--app-bg)',
  },
  accent: {
    background: 'var(--accent)', color: 'var(--on-accent)',
    ['--tile-bg' as string]: 'var(--accent)',
    ['--tile-ink' as string]: 'var(--on-accent)',
  },
  none: {},
};

function Frame({ size, label, fill = 'card', children }: {
  size: { w: number; h: number };
  label: string;
  fill?: Fill;
  children: ReactNode;
}) {
  return (
    <div>
      <div style={{
        width: size.w, height: size.h,
        borderRadius: RADIUS.content, overflow: 'hidden',
        ...FILLS[fill],
      }}>{children}</div>
      <div style={{ ...CAPS, opacity: 0.45, marginTop: sp(2) }}>{label}</div>
    </div>
  );
}

function Center({ children }: { children: ReactNode }) {
  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>{children}</div>
  );
}

const TIMER_PRESETS = [
  { id: '5', label: '5', sec: 5 * 60 },
  { id: '10', label: '10', sec: 10 * 60 },
  { id: '20', label: '20', sec: 20 * 60 },
];

function TimerDemo({ w, h }: { w: number; h: number }) {
  const [preset, setPreset] = useState('20');
  const total = TIMER_PRESETS.find((p) => p.id === preset)?.sec ?? 20 * 60;
  const [left, setLeft] = useState(total);
  const [running, setRunning] = useState(true);

  useEffect(() => {
    setLeft(total);
    setRunning(true);
  }, [total]);

  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => {
      setLeft((s) => (s <= 0 ? 0 : s - 1));
    }, 1000);
    return () => window.clearInterval(t);
  }, [running]);

  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, '0');
  const progress = total === 0 ? 0 : 1 - left / total;

  return (
    <TimerLayout
      w={w}
      h={h}
      title="таймер"
      leftLabel={`${mm}:${ss}`}
      running={running && left > 0}
      progress={progress}
      presets={TIMER_PRESETS.map(({ id, label }) => ({ id, label }))}
      preset={preset}
      onPreset={(id) => setPreset(id)}
      onStop={() => { setRunning(false); setLeft(total); }}
      onToggle={() => setRunning((v) => !v)}
    />
  );
}

createRoot(document.getElementById('root')!).render(<ClockStand />);
