import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Pause, Play } from 'lucide-react';
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

/**
 * Внутренний блок лица (квадрат циферблата, квадрат даты).
 *
 * ⚠️ Тон берётся ОТ ТЕКСТА текущей плитки (`currentColor`), а не задаётся своим цветом. Иначе
 * блок приходится красить дважды — под светлую тему и под тёмную, — и он всё равно мимо, когда
 * человек выбрал плитке свою заливку. Так же ведут себя чипы в дизайн-системе.
 */
const innerBlock: CSSProperties = {
  background: 'color-mix(in srgb, currentColor 10%, transparent)',
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
          ...innerBlock,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: sp(3),
        }}>
          <AnalogFace size={118} now={now} seconds={seconds} />
        </div>
        <div style={{
          ...innerBlock,
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
        {/* ⚠️ Полоса времени БОЛЬШЕ НЕ ТЯНЕТ БУКВЫ. Здесь и была «промашка с узкими и длинными
            часами»: растянутый на всю ширину набор превращал цифры в лапшу. Кегль подбирается
            под коробку, а остаток ширины добирается трекингом (см. FitLine). */}
        <div style={{ width: '100%', height: 56 }}>
          <FitLine text={time} align="center" maxTrack={0.06} />
        </div>
      </div>
    </div>
  );
}

/**
 * Строка, подогнанная под коробку БЕЗ деформации глифов.
 *
 * ⚠️ Так чинится главная претензия к плакату месяца: там ширина набиралась через
 * `textLength` + `lengthAdjust="spacingAndGlyphs"`, то есть буквы РАСТЯГИВАЛИСЬ по горизонтали.
 * На вывеске это читается как «шрифт сломали»: у Unbounded и так широкие овалы, и растянутый
 * «АВГУСТ» превращается в кашу из плоских О. В типографике ширину добирают ТРЕКИНГОМ, а не
 * телом буквы, — так набирают обложки и календарные карточки, с которых взят реф.
 *
 * Порядок ровно тот же, что делает человек руками: подобрать кегль (по меньшему из двух —
 * ширине и высоте), а остаток ширины раздать межбуквенными пробелами, и то с потолком: разрядка
 * сверх ~12% кегля перестаёт быть словом и становится россыпью букв.
 *
 * ⚠️ Меряем ЖИВОЙ элемент, а не считаем по таблице ширин: гарнитура грузится асинхронно, и
 * подгонка, сделанная до её загрузки, промахивается на треть. Отсюда и повтор по
 * `document.fonts.ready`, и ResizeObserver — плитка меняет размер вместе с сеткой стола.
 */
const FIT_PROBE = 100;

export function FitLine({ text, weight = 800, upper = false, maxTrack = 0.12, align = 'left', style }: {
  text: string;
  weight?: number;
  /** Верхний регистр — как на карточках рефа. */
  upper?: boolean;
  /** Потолок разрядки в долях кегля. */
  maxTrack?: number;
  align?: 'left' | 'center';
  style?: CSSProperties;
}) {
  const box = useRef<HTMLDivElement>(null);
  const ink = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState<{ size: number; track: number } | null>(null);
  const label = upper ? text.toUpperCase() : text;

  useLayoutEffect(() => {
    const b = box.current;
    const s = ink.current;
    if (!b || !s) return;
    let alive = true;
    const run = (): void => {
      if (!alive || !b || !s) return;
      const W = b.clientWidth;
      const H = b.clientHeight;
      if (!W || !H) return;
      // Пробный кегль → натуральная ширина → пропорция. Один замер, дальше арифметика.
      s.style.letterSpacing = '0px';
      s.style.fontSize = `${FIT_PROBE}px`;
      const natural = s.getBoundingClientRect().width || 1;
      // Высота строки у дисплейной гарнитуры примерно равна кеглю: line-height держим 1.
      const size = Math.min((W / natural) * FIT_PROBE, H);
      s.style.fontSize = `${size}px`;
      const actual = s.getBoundingClientRect().width;
      const gaps = Math.max(1, label.length - 1);
      const track = Math.max(0, Math.min((W - actual) / gaps, size * maxTrack));
      setFit({ size, track });
    };
    run();
    const ro = new ResizeObserver(run);
    ro.observe(b);
    void document.fonts?.ready?.then(run);
    return () => { alive = false; ro.disconnect(); };
  }, [label, maxTrack]);

  return (
    <div
      ref={box}
      style={{
        width: '100%', height: '100%', overflow: 'hidden',
        display: 'flex', alignItems: 'center',
        justifyContent: align === 'center' ? 'center' : 'flex-start',
        ...style,
      }}
    >
      <span
        ref={ink}
        style={{
          fontFamily: 'var(--font-display)', fontWeight: weight, lineHeight: 1,
          whiteSpace: 'nowrap', color: 'inherit',
          fontSize: fit?.size ?? FIT_PROBE,
          letterSpacing: fit ? `${fit.track}px` : undefined,
          // ⚠️ Разрядка добавляет пробел и ПОСЛЕ последней буквы — строка съезжает влево от края.
          // Съедаем его отрицательным полем, иначе выключка вправо всегда мимо на один пробел.
          marginRight: fit ? -fit.track : undefined,
          // До первого замера прячем: иначе видна вспышка строки пробного кегля.
          visibility: fit ? 'visible' : 'hidden',
        }}
      >{label}</span>
    </div>
  );
}

/**
 * Размер коробки в пикселях. ⚠️ Нужен там, где кегль ЗАВИСИТ ОТ ПЛИТКИ: на 2×2 сетка дней
 * помещается только подписью, на 4×4 та же подпись выглядит пылью в углу большого поля.
 * Проценты тут не помогают — font-size в процентах считается от РОДИТЕЛЬСКОГО кегля, а не от
 * высоты коробки.
 */
function useBoxSize<T extends HTMLElement>(): [RefObject<T>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = (): void => setSize({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/**
 * (3) Календарь месяца одним квадратом — по рефу с печатными карточками.
 *
 * ⚠️ Времени здесь НЕТ, и это не потеря, а разделение. В прежней версии внизу стояли часы, и
 * плитка пыталась быть сразу календарём и часами: время проигрывало вниманием сетке дней, а
 * сетка мешала времени. Реф — календарь, и виджет пусть будет календарём; часы рядом свои.
 *
 * ⚠️ Номер месяца — ВТОРОЙ фокус, как на карточках: крупная цифра держит композицию, когда
 * слово месяца короткое («май» иначе оставляет полплитки пустой). Он же делает узнаваемым
 * набор из двенадцати плиток: у каждой свой номер, а не только своё слово.
 */
export function CalendarFace({ now }: { now: Date }) {
  const cells = monthCells(now);
  const today = now.getDate();
  const num = String(now.getMonth() + 1).padStart(2, '0');
  const [grid, gridBox] = useBoxSize<HTMLDivElement>();
  // Строк в сетке: шапка недели плюс недели месяца. Кегль дня — доля высоты строки, с потолком:
  // на 4×4 иначе цифры перерастают слово месяца и спорят с ним за главную роль.
  const rows = 1 + cells.length / 7;
  const dayFont = gridBox.h ? Math.min(Math.round((gridBox.h / rows) * 0.52), 28) : 0;
  return (
    <div style={tileShell({ padding: pad(4), gap: sp(2) })}>
      {/* ⚠️ Номер месяца набирается ТЕМ ЖЕ подгоном, что и слово: заданный кегль («2.4em»)
          выглядел второстепенным на 4×4 и великоватым на 2×2, потому что не зависел от плитки.
          Доля ширины у него постоянная — так номер остаётся вторым фокусом на любом размере. */}
      <div style={{ display: 'flex', alignItems: 'stretch', gap: sp(3), flex: 'none', height: '26%' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <FitLine text={monthLong(now)} upper />
        </div>
        {/* ⚠️ Номер тональный (та же краска, тише), а НЕ акцентный. Акцентом он пропадал
            начисто, когда человек выбирал плитке акцентную заливку: акцент на акценте. Реф
            держит второй фокус ровно так же — тем же цветом, но легче. */}
        <div style={{ flex: 'none', width: '22%', opacity: 0.45 }}>
          <FitLine text={num} align="center" maxTrack={0.02} />
        </div>
      </div>

      <div
        ref={grid}
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
          gap: sp(1) - 2, flex: 1, minHeight: 0,
        }}
      >
        {WEEK_LETTERS.map((d, i) => (
          <div key={`h${i}`} style={{
            ...CAPS, color: 'inherit', opacity: 0.38, textAlign: 'center',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{d}</div>
        ))}
        {cells.map((n, i) => {
          const on = n === today;
          return (
            <div key={i} style={{
              ...TEXT.caption,
              // Кегль дня — от высоты строки сетки, а не из шкалы подписи: см. useBoxSize.
              fontSize: dayFont || undefined,
              color: 'inherit', textAlign: 'center', borderRadius: RADIUS.pill,
              // ⚠️ Сегодня — КОЛЬЦО, а не заливка. Заливка акцентом исчезала на акцентной плитке
              // (тот же случай, что с номером месяца), а кольцо краской самой плитки читается
              // на любой заливке и ближе к печатной карточке рефа.
              boxShadow: on ? 'inset 0 0 0 2px currentColor' : 'none',
              opacity: n ? 1 : 0,
              fontWeight: on ? 800 : 500,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: motion.state('box-shadow'),
            }}>{n || ''}</div>
          );
        })}
      </div>

      <div style={{ ...CAPS, color: 'inherit', opacity: 0.4, flex: 'none' }}>
        {now.getFullYear()}
      </div>
    </div>
  );
}

const WEEK_LETTERS = ['п', 'в', 'с', 'ч', 'п', 'с', 'в'];

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

/**
 * Таймер — целиком внутри плитки.
 *
 * ⚠️ Выбор длительности переехал ВНУТРЬ. На рефе пилюли висят над карточкой, и это честно для
 * картинки, но не для стола: у плитки нет «над», там сразу следующий виджет. Вынесенный ряд
 * означал бы, что таймер занимает больше места, чем его плитка, — то есть ломает сетку.
 *
 * ⚠️ Ход показывает ОБВОДКА ВСЕЙ ПЛИТКИ, а не колечко в углу. Так время видно боковым зрением
 * с любого расстояния: убывает сама рамка, а не деталь внутри. Заодно это снимает вторую
 * претензию — пустоту: у прежней версии полплитки занимал квадрат с паузой, и при этом само
 * время было мельче него.
 *
 * ⚠️ Кегль времени НЕ задан числом: строка подгоняется под ширину (FitLine). Прежняя версия
 * ставила 44 px и на узкой плитке обрезала минуты, а на широкой оставляла поля.
 */
export function TimerLayout({
  w, h, title, leftLabel, running, progress, presets, preset, onPreset, onStop, onToggle,
}: {
  /** Реальные размеры плитки: обводка хода рисуется в пикселях, а не в процентах. */
  w: number;
  h: number;
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
  // Широкая плитка (4×2) кладёт время и кнопку в ряд, квадратная (2×2) — в колонку.
  const wide = w / Math.max(1, h) > 1.5;
  const inset = 3;
  const btn = wide ? Math.round(h * 0.46) : Math.round(h * 0.24);

  return (
    <div style={{
      position: 'relative', width: '100%', height: '100%', overflow: 'hidden',
      borderRadius: RADIUS.content,
      padding: pad(4), display: 'flex', flexDirection: 'column', gap: sp(2),
    }}>
      {/* Обводка хода. pathLength=1 — доля рисуется прямо прогрессом, без пересчёта периметра. */}
      <svg
        width={w} height={h}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        aria-hidden
      >
        <rect
          x={inset} y={inset} width={Math.max(0, w - inset * 2)} height={Math.max(0, h - inset * 2)}
          rx={RADIUS.content} fill="none" stroke="currentColor" strokeOpacity={0.16} strokeWidth={inset * 2}
        />
        <rect
          x={inset} y={inset} width={Math.max(0, w - inset * 2)} height={Math.max(0, h - inset * 2)}
          rx={RADIUS.content} fill="none" stroke="var(--accent)" strokeWidth={inset * 2}
          strokeLinecap="round" pathLength={1} strokeDasharray={`${p} 1`}
          style={{ transition: motion.state('stroke-dasharray') }}
        />
      </svg>

      <div style={{ display: 'flex', gap: sp(1), flex: 'none' }}>
        {presets.map((item) => {
          const on = item.id === preset;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onPreset(item.id)}
              style={{
                ...TEXT.caption, fontWeight: 700,
                color: on ? 'var(--on-accent)' : 'inherit',
                opacity: on ? 1 : 0.6,
                border: 'none', cursor: 'default',
                padding: pad(1, 2), borderRadius: RADIUS.pill,
                background: on ? 'var(--accent)' : 'color-mix(in srgb, currentColor 10%, transparent)',
                transition: motion.hover('background', 'color', 'opacity'),
              }}
            >{item.label}</button>
          );
        })}
        <span style={{ ...CAPS, opacity: 0.35, marginLeft: 'auto' }}>{title}</span>
      </div>

      <div style={{
        flex: 1, minHeight: 0, display: 'flex',
        flexDirection: wide ? 'row' : 'column',
        alignItems: wide ? 'center' : 'stretch',
        gap: sp(3),
      }}>
        {/* ⚠️ Время — единственный герой плитки, поэтому занимает всё свободное поле. Дерзость
            здесь ровно в этом: не «крупная надпись среди элементов», а надпись во всю плитку. */}
        <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          <FitLine text={leftLabel} maxTrack={0.02} />
        </div>

        <div style={{
          flex: 'none', display: 'flex', alignItems: 'center', gap: sp(2),
          flexDirection: wide ? 'column' : 'row',
        }}>
          <button
            type="button"
            onClick={onToggle}
            aria-label={running ? 'Пауза' : 'Продолжить'}
            style={{
              width: btn, height: btn, flex: 'none',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              border: 'none', cursor: 'default', padding: 0,
              borderRadius: RADIUS.box,
              background: 'var(--accent)', color: 'var(--on-accent)',
              transition: motion.hover('background', 'transform'),
            }}
          >
            {running
              ? <Pause size={Math.round(btn * 0.42)} strokeWidth={2.6} />
              : <Play size={Math.round(btn * 0.42)} strokeWidth={2.6} />}
          </button>
          <button
            type="button"
            onClick={onStop}
            style={{
              ...CAPS, color: 'inherit', opacity: 0.6,
              border: 'none', background: 'transparent', cursor: 'default',
              padding: pad(1, 2), borderRadius: RADIUS.pill,
              transition: motion.hover('opacity'),
            }}
          >Сброс</button>
        </div>
      </div>
    </div>
  );
}
