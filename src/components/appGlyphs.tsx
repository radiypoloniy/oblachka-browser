import type React from 'react';

// Глифы приложений — своя отрисовка вместо готовых силуэтов.
//
// ⚠️ Зачем не иконочный набор. Любой набор (Phosphor, Lucide, SF-подобные) даёт ОДИН силуэт:
// калькулятор там — знак «=», таймер — кружок со стрелкой. У Apple же на иконке нарисован сам
// предмет: в калькуляторе видна сетка кнопок с выделенной колонкой операций, в таймере —
// циферблат с делениями и заводной головкой. Именно эта разница читается как «схематично» и
// «сделано всерьёз», и заменой одного набора на другой она не лечится.
//
// Рисуем инлайном, а не файлами: глифы многоцветные (у калькулятора экран светлее корпуса, у
// котёнка розовые уши), а CSS-маска красит всё одним цветом. Инлайн ещё и позволяет глифу
// подстроиться под плитку — на светлых он берёт акцентный цвет, на цветных остаётся белым.
//
// Все пути живут в системе координат 24×24 и наследуют currentColor: масштаб задаёт вызывающая
// сторона размером обёртки.

interface GlyphProps {
  size: number;
  /** Основной цвет: белый на цветной плитке, акцентный — на светлой. */
  color: string;
}

const box = (size: number): React.SVGProps<SVGSVGElement> => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
});

/** Калькулятор: корпус, экран и сетка кнопок с выделенным столбцом действий. */
function CalcGlyph({ size, color }: GlyphProps) {
  const dot = (x: number, y: number, o = 0.55) => (
    <rect key={`${x}-${y}`} x={x} y={y} width="2.6" height="2.2" rx="0.9" fill={color} opacity={o} />
  );
  return (
    <svg {...box(size)}>
      <rect x="3.5" y="2" width="17" height="20" rx="3.4" fill={color} opacity="0.22" />
      <rect x="3.5" y="2" width="17" height="20" rx="3.4" stroke={color} strokeWidth="1.5" />
      {/* Экран — самая светлая часть, как на настоящем калькуляторе. */}
      <rect x="6" y="4.6" width="12" height="4" rx="1.2" fill={color} opacity="0.95" />
      {/* Кнопки: три столбца цифр и правый столбец операций поярче. */}
      {[10.6, 14, 17.4].map((y) => [6.2, 9.8].map((x) => dot(x, y))).flat()}
      {[10.6, 14, 17.4].map((y) => dot(13.4, y, 0.55))}
      <rect x="16.6" y="10.6" width="2.6" height="8.8" rx="1.1" fill={color} opacity="0.95" />
    </svg>
  );
}

/** Таймер: циферблат с делениями, стрелкой и заводной головкой. */
function TimerGlyph({ size, color }: GlyphProps) {
  const ticks = Array.from({ length: 12 }, (_, i) => {
    const a = (i * Math.PI) / 6;
    const r1 = i % 3 === 0 ? 6.4 : 7.0;
    const cx = 12 + Math.sin(a) * r1;
    const cy = 13.2 - Math.cos(a) * r1;
    const cx2 = 12 + Math.sin(a) * 8.0;
    const cy2 = 13.2 - Math.cos(a) * 8.0;
    return (
      <line
        key={i} x1={cx} y1={cy} x2={cx2} y2={cy2}
        stroke={color} strokeWidth={i % 3 === 0 ? 1.5 : 1} strokeLinecap="round"
        opacity={i % 3 === 0 ? 0.95 : 0.5}
      />
    );
  });
  return (
    <svg {...box(size)}>
      <circle cx="12" cy="13.2" r="8.8" fill={color} opacity="0.18" />
      <circle cx="12" cy="13.2" r="8.8" stroke={color} strokeWidth="1.5" />
      {ticks}
      {/* Стрелка и ось. */}
      <line x1="12" y1="13.2" x2="15.4" y2="9.4" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="13.2" r="1.25" fill={color} />
      {/* Заводная головка и кнопка сверху — то, что делает секундомер секундомером. */}
      <rect x="10.6" y="1.7" width="2.8" height="1.9" rx="0.8" fill={color} />
      <line x1="12" y1="3.6" x2="12" y2="4.6" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      <line x1="18.6" y1="6" x2="20" y2="4.6" stroke={color} strokeWidth="1.6" strokeLinecap="round" opacity="0.8" />
    </svg>
  );
}

/** Конвертер: две встречные стрелки и знаки величин по краям. */
function ConvertGlyph({ size, color }: GlyphProps) {
  return (
    <svg {...box(size)}>
      <path d="M5.4 9.2h11.2" stroke={color} strokeWidth="1.9" strokeLinecap="round" />
      <path d="M14.2 6.4 17 9.2 14.2 12" stroke={color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18.6 15.2H7.4" stroke={color} strokeWidth="1.9" strokeLinecap="round" />
      <path d="M9.8 12.4 7 15.2 9.8 18" stroke={color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      {/* Единицы по углам: без них это просто «обновить». */}
      <circle cx="5.2" cy="5.4" r="1.5" fill={color} opacity="0.65" />
      <rect x="17.2" y="17.4" width="3" height="3" rx="1" fill={color} opacity="0.65" />
    </svg>
  );
}

/** Счётчик текста: лист со строками и крупная «А» поверх. */
function CounterGlyph({ size, color }: GlyphProps) {
  return (
    <svg {...box(size)}>
      <rect x="3.6" y="2.4" width="16.8" height="19.2" rx="3" fill={color} opacity="0.16" />
      <rect x="3.6" y="2.4" width="16.8" height="19.2" rx="3" stroke={color} strokeWidth="1.4" />
      {[6.6, 9.4].map((y) => (
        <line key={y} x1="6.6" y1={y} x2="17.4" y2={y} stroke={color} strokeWidth="1.3" strokeLinecap="round" opacity="0.5" />
      ))}
      <line x1="6.6" y1="12.2" x2="13.6" y2="12.2" stroke={color} strokeWidth="1.3" strokeLinecap="round" opacity="0.5" />
      {/* Буква — сам предмет счёта. */}
      <path d="M8.2 19.6 11 13.6l2.8 6" stroke={color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.2 17.9h3.6" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="16.6" cy="18.4" r="1.5" fill={color} opacity="0.75" />
    </svg>
  );
}

/** Пипетка: инструмент с каплей взятого цвета. */
function ColorGlyph({ size, color }: GlyphProps) {
  return (
    <svg {...box(size)}>
      <path
        d="M14.9 3.6a2.6 2.6 0 0 1 3.7 3.7l-1.5 1.5 1 1-2.2 2.2-1-1-6.1 6.1-3.5.9.9-3.5 6.1-6.1-1-1L13.5 5.2l1 1 .4-2.6Z"
        fill={color} opacity="0.2"
      />
      <path
        d="m15.9 4.6 3.5 3.5M17.1 6.9l-8.3 8.3-3 .8.8-3 8.3-8.3"
        stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      />
      {/* Капля цвета — то, ради чего пипетку и берут. */}
      <path d="M18.4 13.4c1.2 1.5 1.9 2.5 1.9 3.3a1.9 1.9 0 1 1-3.8 0c0-.8.7-1.8 1.9-3.3Z" fill={color} opacity="0.9" />
    </svg>
  );
}

/** Котёнок: мордочка с ушами, глазами и усами. */
function KittenGlyph({ size, color }: GlyphProps) {
  return (
    <svg {...box(size)}>
      <path d="M5.2 8.4 4.4 3.6l4.3 2.5M18.8 8.4l.8-4.8-4.3 2.5" fill={color} opacity="0.9" />
      <circle cx="12" cy="13" r="7.6" fill={color} opacity="0.22" />
      <circle cx="12" cy="13" r="7.6" stroke={color} strokeWidth="1.5" />
      <circle cx="9.4" cy="12.2" r="1.05" fill={color} />
      <circle cx="14.6" cy="12.2" r="1.05" fill={color} />
      <path d="M11 15.4c.6.5 1.4.5 2 0" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
      {[[4.6, 12.6], [4.6, 14.4]].map(([x, y]) => (
        <line key={y} x1={x} y1={y} x2={x + 3} y2={y - 0.4} stroke={color} strokeWidth="1.1" strokeLinecap="round" opacity="0.6" />
      ))}
      {[[19.4, 12.6], [19.4, 14.4]].map(([x, y]) => (
        <line key={y} x1={x} y1={y} x2={x - 3} y2={y - 0.4} stroke={color} strokeWidth="1.1" strokeLinecap="round" opacity="0.6" />
      ))}
    </svg>
  );
}

/** Глобус для веб-приложений: сфера с меридианами. */
function WebGlyph({ size, color }: GlyphProps) {
  return (
    <svg {...box(size)}>
      <circle cx="12" cy="12" r="9" fill={color} opacity="0.18" />
      <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.6" />
      <ellipse cx="12" cy="12" rx="4" ry="9" stroke={color} strokeWidth="1.4" opacity="0.8" />
      <path d="M3.4 9.2h17.2M3.4 14.8h17.2" stroke={color} strokeWidth="1.4" strokeLinecap="round" opacity="0.8" />
    </svg>
  );
}

const GLYPHS: Record<string, (p: GlyphProps) => React.ReactElement> = {
  calc: CalcGlyph,
  timer: TimerGlyph,
  convert: ConvertGlyph,
  counter: CounterGlyph,
  color: ColorGlyph,
  kitten: KittenGlyph,
  web: WebGlyph,
};

export function hasGlyph(id: string): boolean {
  return id in GLYPHS;
}

export function AppGlyph({ id, size, color }: { id: string; size: number; color: string }) {
  const G = GLYPHS[id];
  return G ? <G size={size} color={color} /> : null;
}
