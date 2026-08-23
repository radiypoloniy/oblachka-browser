import type { CSSProperties } from 'react';
import { Pause } from 'lucide-react';
import { dayPhase, skyStops, type DayPhase } from '../../../shared/dayPhase';
import { CAPS, DISPLAY, RADIUS, TEXT, motion, pad, sp } from '../../styles/system';

// Лица часов: аналог для стола и три широких варианта для стенда.
// Дугу дня сюда не тащим — владелец назвал её посредственной; широкие часы держатся набором.

/** Тёплый ход стрелок — тот же systemOrange, что секундная держала и раньше. */
export const CLOCK_SECOND = '#FF9F0A';

export function AnalogFace({ size, now, seconds }: { size: number; now: Date; seconds: boolean }) {
  const h = now.getHours() % 12;
  const m = now.getMinutes();
  const s = now.getSeconds();
  // Часовая едет за минутами, минутная — за секундами. Иначе в 10:59 часовая стоит на 10.
  const hourAngle = h * 30 + m * 0.5;
  const minAngle = m * 6 + s * 0.1;
  const secAngle = s * 6;
  const dense = size >= 80;

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ display: 'block', flex: 'none' }}>
      {/* Риски минут — только на крупном циферблате: на клетке 1×1 шестьдесят штрихов слипаются. */}
      {dense && Array.from({ length: 60 }, (_, i) => (
        <line
          key={i}
          x1="50" y1="7.2" x2="50" y2={i % 5 === 0 ? 12.4 : 9.6}
          stroke="currentColor"
          strokeOpacity={i % 5 === 0 ? 0.88 : 0.38}
          strokeWidth={i % 5 === 0 ? 1.35 : 0.7}
          strokeLinecap="round"
          transform={`rotate(${i * 6} 50 50)`}
        />
      ))}
      <Marker hour={12} double />
      <Marker hour={3} />
      <Marker hour={6} />
      <Marker hour={9} />
      <BluntHand angle={hourAngle} length={24} width={6.2} />
      <BluntHand angle={minAngle} length={34} width={4.4} />
      {seconds && (
        <g
          style={{
            transform: `rotate(${secAngle}deg)`,
            transformOrigin: '50px 50px',
            transition: 'transform 1s linear',
          }}
        >
          <line x1="50" y1="58" x2="50" y2="14" stroke={CLOCK_SECOND} strokeWidth="1.15" strokeLinecap="round" />
        </g>
      )}
      <circle cx="50" cy="50" r="3.6" fill={CLOCK_SECOND} stroke="var(--app-bg)" strokeWidth="1.1" />
      <circle cx="50" cy="50" r="1.35" fill="currentColor" />
    </svg>
  );
}

function Marker({ hour, double }: { hour: 12 | 3 | 6 | 9; double?: boolean }) {
  const angle = hour === 12 ? 0 : hour * 30;
  return (
    <g transform={`rotate(${angle} 50 50)`}>
      {double ? (
        <>
          <polygon points="50,6.2 45.2,15.6 54.8,15.6" fill="currentColor" />
          <polygon points="50,8.4 46.4,15.2 53.6,15.2" fill="var(--app-bg)" fillOpacity="0.35" />
        </>
      ) : (
        <polygon points="50,6.6 46.1,14.8 53.9,14.8" fill="currentColor" />
      )}
    </g>
  );
}

function BluntHand({ angle, length, width }: { angle: number; length: number; width: number }) {
  const x = 50 - width / 2;
  const y = 50 - length;
  return (
    <g transform={`rotate(${angle} 50 50)`}>
      <rect
        x={x} y={y} width={width} height={length - 3}
        rx={1.15} ry={1.15}
        fill={CLOCK_SECOND}
        stroke="var(--app-bg)"
        strokeWidth="1.05"
      />
    </g>
  );
}

export function hhmm(now: Date): string {
  return now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function weekdayLong(now: Date): string {
  return now.toLocaleDateString('ru-RU', { weekday: 'long' });
}

function weekdayShort(now: Date): string {
  return now.toLocaleDateString('ru-RU', { weekday: 'short' }).replace('.', '');
}

function monthLong(now: Date): string {
  return now.toLocaleDateString('ru-RU', { month: 'long' });
}

/**
 * Растянуть набор на всю ширину плитки.
 *
 * textLength меняет ширину глифов, а не сплющивает контейнер: так календарные карточки
 * заполняют поле буквами. preserveAspectRatio=none здесь уместен — деформируем букву, не круг.
 */
function StretchText({ text, fill }: { text: string; fill: string }) {
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" width="100%" height="100%" aria-hidden>
      <text
        x="0" y="20"
        textLength="100"
        lengthAdjust="spacingAndGlyphs"
        fill={fill}
        style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22 }}
      >{text}</text>
    </svg>
  );
}

const inkWell: CSSProperties = {
  background: 'var(--text-strong)',
  color: 'var(--app-bg)',
  borderRadius: RADIUS.content,
  overflow: 'hidden',
};

const tileShell = (extra?: CSSProperties): CSSProperties => ({
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  ...extra,
});

/** (1) Время — набор на всю плитку. Небо фазы только подложка, без дуги. */
export function WideTypeClock({ now, sunrise, sunset }: {
  now: Date; sunrise: number; sunset: number;
}) {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const phase: DayPhase = dayPhase(nowMin, sunrise, sunset);
  const [top, mid, low] = skyStops(phase);
  const time = hhmm(now);
  return (
    <div style={tileShell({
      padding: pad(4),
      borderRadius: RADIUS.content,
      background: `linear-gradient(165deg, ${top} 0%, ${mid} 52%, ${low} 100%)`,
      color: '#fff',
      transition: motion.enter('background'),
    })}>
      <div style={{ ...CAPS, color: 'inherit', opacity: 0.78 }}>{weekdayLong(now)}</div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center' }}>
        <div style={{ width: '100%', height: '100%', maxHeight: 92 }}>
          <StretchText text={time} fill="#fff" />
        </div>
      </div>
      <div style={{ ...TEXT.body, color: 'inherit', opacity: 0.82, fontWeight: 600 }}>
        {now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
      </div>
    </div>
  );
}

/** (2) Кластер: циферблат + дата сверху, широкая полоса времени снизу. */
export function WideClusterClock({ now, seconds }: { now: Date; seconds: boolean }) {
  const time = hhmm(now);
  return (
    <div style={tileShell({ gap: sp(2) })}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: sp(2), flex: 1, minHeight: 0 }}>
        <div style={{
          ...inkWell,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: sp(3),
        }}>
          <AnalogFace size={118} now={now} seconds={seconds} />
        </div>
        <div style={{
          ...inkWell,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: pad(4),
          gap: sp(1),
        }}>
          <div style={{ ...TEXT.section, color: 'inherit', opacity: 0.72 }}>
            {weekdayShort(now)}
          </div>
          <div style={{ ...DISPLAY, fontSize: 52, fontWeight: 700, color: 'inherit' }}>
            {now.getDate()}
          </div>
        </div>
      </div>
      <div style={{
        flex: 'none',
        height: 72,
        borderRadius: RADIUS.content,
        background: 'var(--accent)',
        color: 'var(--on-accent)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: `0 ${sp(4)}px`,
      }}>
        <div style={{ width: '100%', height: 56 }}>
          <StretchText text={time} fill="currentColor" />
        </div>
      </div>
    </div>
  );
}

/** (3) Плакат: месяц растянут, сетка дней, время — второй ряд. */
export function WidePosterClock({ now }: { now: Date }) {
  const month = monthLong(now);
  const year = String(now.getFullYear());
  const cells = monthCells(now);
  const today = now.getDate();
  return (
    <div style={tileShell({
      ...inkWell,
      padding: pad(4),
      gap: sp(2),
    })}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: sp(3), height: 44, flex: 'none' }}>
        <div style={{ flex: 1, minWidth: 0, height: '100%' }}>
          <StretchText text={month} fill="currentColor" />
        </div>
        <div style={{
          ...CAPS,
          color: 'inherit',
          opacity: 0.55,
          writingMode: 'vertical-rl',
          transform: 'rotate(180deg)',
          height: 40,
        }}>{year}</div>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        gap: 2,
        flex: 1,
        minHeight: 0,
      }}>
        {['п', 'в', 'с', 'ч', 'п', 'с', 'в'].map((d, i) => (
          // ⚠️ Кегль — роль CAPS как есть, без своего числа. Шапка недели тише строки дней уже
          // трижды: моноширинной капсой, разрядкой и прозрачностью; четвёртым ослаблением
          // (свой мелкий кегль) она уходила из шкалы, а сторож типографики ловит это как ошибку.
          <div key={`h${i}`} style={{
            ...CAPS, color: 'inherit', opacity: 0.4, textAlign: 'center',
          }}>{d}</div>
        ))}
        {cells.map((n, i) => {
          const on = n === today;
          return (
            <div key={i} style={{
              ...TEXT.caption,
              textAlign: 'center',
              borderRadius: RADIUS.pill,
              background: on ? 'var(--accent)' : 'transparent',
              color: on ? 'var(--on-accent)' : 'inherit',
              opacity: n ? 1 : 0,
              fontWeight: on ? 700 : 500,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{n || ''}</div>
          );
        })}
      </div>
      <div style={{ ...DISPLAY, fontSize: 28, fontWeight: 700, letterSpacing: '-0.04em', color: 'inherit' }}>
        {hhmm(now)}
      </div>
    </div>
  );
}

function monthCells(now: Date): number[] {
  const y = now.getFullYear();
  const m = now.getMonth();
  const first = new Date(y, m, 1);
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(y, m + 1, 0).getDate();
  const out: number[] = Array.from({ length: offset }, () => 0);
  for (let d = 1; d <= days; d++) out.push(d);
  while (out.length % 7 !== 0) out.push(0);
  return out;
}

/** Компоновка таймера: пилюли длительности, крупное время, квадрат хода. */
export function TimerLayout({
  title, leftLabel, running, progress, presets, preset, onPreset, onStop, onToggle,
}: {
  title: string;
  leftLabel: string;
  running: boolean;
  progress: number;
  presets: { id: string; label: string }[];
  preset: string;
  onPreset: (id: string) => void;
  onStop: () => void;
  onToggle: () => void;
}) {
  const p = Math.max(0, Math.min(1, progress));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(3), height: '100%' }}>
      <div style={{ display: 'flex', gap: sp(2) }}>
        {presets.map((item) => {
          const on = item.id === preset;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onPreset(item.id)}
              style={{
                ...TEXT.body,
                fontWeight: 600,
                border: 'none',
                cursor: 'default',
                padding: pad(2, 4),
                borderRadius: RADIUS.control,
                background: on ? 'var(--accent)' : 'var(--surface)',
                color: on ? 'var(--on-accent)' : 'var(--text-body)',
                boxShadow: on ? 'none' : 'var(--shadow-lvl1)',
                transition: motion.hover('background', 'color'),
              }}
            >{item.label}</button>
          );
        })}
      </div>
      <div style={{
        flex: 1,
        minHeight: 0,
        background: 'var(--surface)',
        borderRadius: RADIUS.content,
        boxShadow: 'var(--shadow-lvl2), var(--inner-light)',
        border: '1px solid var(--divider)',
        padding: pad(4),
        display: 'flex',
        gap: sp(4),
        alignItems: 'stretch',
        color: 'var(--text-body)',
      }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ ...TEXT.body, color: 'var(--text-faint)' }}>{title}</div>
          <div style={{
            ...DISPLAY,
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            fontSize: 44,
            fontWeight: 700,
            color: 'var(--accent)',
          }}>{leftLabel}</div>
          <button
            type="button"
            onClick={onStop}
            style={{
              ...TEXT.body,
              fontWeight: 600,
              alignSelf: 'flex-start',
              border: 'none',
              cursor: 'default',
              padding: pad(2, 4),
              borderRadius: RADIUS.control,
              background: 'var(--accent)',
              color: 'var(--on-accent)',
            }}
          >Стоп</button>
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-label={running ? 'Пауза' : 'Продолжить'}
          style={{
            width: 132, flex: 'none',
            border: 'none',
            cursor: 'default',
            padding: 0,
            background: 'transparent',
            color: 'var(--accent)',
            borderRadius: RADIUS.box,
          }}
        >
          <svg width="132" height="132" viewBox="0 0 132 132">
            <rect x="6" y="6" width="120" height="120" rx="20"
              fill="none" stroke="var(--divider)" strokeWidth="3" />
            <rect x="6" y="6" width="120" height="120" rx="20"
              fill="none" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round"
              pathLength={1}
              strokeDasharray={`${p} 1`}
              transform="rotate(-90 66 66)"
              style={{ transition: motion.state('stroke-dasharray') }}
            />
            <foreignObject x="0" y="0" width="132" height="132">
              <div style={{
                width: '100%', height: '100%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Pause size={36} color="var(--accent)" />
              </div>
            </foreignObject>
          </svg>
        </button>
      </div>
    </div>
  );
}
