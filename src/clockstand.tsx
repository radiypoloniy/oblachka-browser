import { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import {
  AnalogFace,
  WideTypeClock,
  WideClusterClock,
  WidePosterClock,
  TimerLayout,
} from './components/desktop/clockFaces';
import { CAPS, DISPLAY, RADIUS, TEXT, motion, pad, sp } from './styles/system';

// Временный стенд лиц часов. Три широких варианта сразу, плюс аналог и таймер.
// Дугу дня не показываю: задача была сравнить ДРУГИЕ идеи, а не ещё одну дугу.

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
  const frozen = PHASES.find((p) => p.id === phase)?.stamp ?? null;
  const now = mixNow(frozen, live);

  useEffect(() => {
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }, []);

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
      <header style={{ maxWidth: 980, margin: `0 auto ${sp(6)}px` }}>
        <div style={{ ...CAPS, marginBottom: sp(2) }}>стенд · часы</div>
        <h1 style={{ ...DISPLAY, fontSize: 32, fontWeight: 700, color: 'var(--text-strong)', margin: 0 }}>
          Три широких лица, без дуги
        </h1>
        <p style={{ ...TEXT.body, maxWidth: 640, margin: `${sp(3)}px 0 0` }}>
          Набор вместо траектории: широкие часы заполняют плитку буквами, а не аркой.
          Аналог и таймер — отдельно, по вашим рефам. Назовите номер.
        </p>
        <div style={{ display: 'flex', gap: sp(2), marginTop: sp(4), flexWrap: 'wrap' }}>
          {PHASES.map((p) => {
            const on = p.id === phase;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPhase(p.id)}
                style={{
                  ...TEXT.body,
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'default',
                  padding: pad(2, 4),
                  borderRadius: RADIUS.pill,
                  background: on ? 'var(--accent)' : 'var(--surface)',
                  color: on ? 'var(--on-accent)' : 'var(--text-body)',
                  boxShadow: on ? 'none' : 'var(--shadow-lvl1)',
                  transition: motion.hover('background', 'color'),
                }}
              >{p.label}</button>
            );
          })}
        </div>
      </header>

      <main style={{
        maxWidth: 980, margin: '0 auto',
        display: 'flex', flexDirection: 'column', gap: sp(8),
      }}>
        <Section n="1" title="Набор на всю ширину" hint="Время растянуто по плитке. Небо фазы — только земля, без дуги.">
          <Frame w={480} h={200}>
            <WideTypeClock now={now} sunrise={SUNRISE} sunset={SUNSET} />
          </Frame>
        </Section>

        <Section n="2" title="Кластер: циферблат, дата, полоса" hint="Компоновка рефа с часами и календарём. Полоса — акцент палитры, не чужой оранж.">
          <Frame w={480} h={220}>
            <WideClusterClock now={now} seconds />
          </Frame>
        </Section>

        <Section n="3" title="Плакат месяца" hint="Буквы месяца заполняют поле, как на календарных карточках. Сетка дней и время ниже.">
          <Frame w={480} h={280}>
            <WidePosterClock now={now} />
          </Frame>
        </Section>

        <Section n="A" title="Аналог" hint="Клинья 12/3/6/9, тупые стрелки. Уже подключён к виджету часов на столе.">
          <div style={{ display: 'flex', gap: sp(4) }}>
            <Frame w={200} h={200}>
              <div style={{
                width: '100%', height: '100%',
                background: 'var(--surface)',
                color: 'var(--text-strong)',
                borderRadius: RADIUS.content,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: 'var(--shadow-lvl2), var(--inner-light)',
              }}>
                <AnalogFace size={168} now={now} seconds />
              </div>
            </Frame>
            <Frame w={200} h={200}>
              <div style={{
                width: '100%', height: '100%',
                background: 'var(--text-strong)',
                color: 'var(--app-bg)',
                borderRadius: RADIUS.content,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <AnalogFace size={168} now={now} seconds />
              </div>
            </Frame>
          </div>
        </Section>

        <Section n="T" title="Таймер" hint="Пилюли длительности, крупное время, квадрат хода. Цвета — акцент системы.">
          <Frame w={480} h={260}>
            <TimerDemo />
          </Frame>
        </Section>
      </main>
    </div>
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
      <p style={{ ...TEXT.caption, margin: `0 0 ${sp(3)}px` }}>{hint}</p>
      {children}
    </section>
  );
}

function Frame({ w, h, children }: { w: number; h: number; children: ReactNode }) {
  return (
    <div style={{ width: w, height: h }}>{children}</div>
  );
}

const TIMER_PRESETS = [
  { id: '5', label: '5 мин', sec: 5 * 60 },
  { id: '10', label: '10 мин', sec: 10 * 60 },
  { id: '20', label: '20 мин', sec: 20 * 60 },
];

function TimerDemo() {
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
      title="Таймер"
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
