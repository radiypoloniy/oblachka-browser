import type { ReactNode } from 'react';
import { CAPS, COL, RADIUS, TEXT, motion, pad, sp, well } from '../../styles/system';

// ── Строка списка и полоса-мера ───────────────────────────────────────────────
//
// Продолжение kit.tsx: те же презентационные примитивы, только вынесенные отдельным файлом.
// ⚠️ Отдельным — не по смыслу, а по размеру: kit.tsx давно за порогом храповика структуры
// (см. scripts/structure-check.mjs), и дописывать в него новое значит растить то, что и так
// велико. `SpotLine` переехал сюда целиком, kit.tsx его реэкспортирует — вызывающие стороны
// ничего не заметили.

/**
 * Полоса-мера: какую долю целого занимает величина.
 *
 * ⚠️ Заведена в систему, а не написана на месте, потому что нужна сразу в четырёх местах одного
 * экрана диспетчера задач (память, видеопамять, процессор, доля строки) — и это ровно тот случай,
 * когда «нарисую тут полосочку» превращается в четыре разные полосочки.
 *
 * ⚠️ Заполнение — АКЦЕНТ, а не статусный цвет, и это по цветовому закону проекта. Полоса
 * показывает величину, а не тревогу: красная заливка при 90 % памяти была бы статусом, красящим
 * фон, а у нас статус фон не красит. Цвет можно переопределить `tone` там, где величина
 * действительно означает состояние (заряд, срок) — но по умолчанию его брать неоткуда.
 */
export function Meter({ share, tone = 'var(--accent)' }: {
  /** 0…1. Значения за пределами зажимаются — доля приходит из деления, а делитель бывает нулём. */
  share: number;
  tone?: string;
}) {
  return (
    <div style={{ ...well(RADIUS.pill), height: sp(1), overflow: 'hidden' }}>
      <div style={{
        width: `${Math.max(0, Math.min(1, share)) * 100}%`,
        height: '100%', background: tone, borderRadius: RADIUS.pill,
        transition: motion.state('width'),
      }} />
    </div>
  );
}

/**
 * Строка внутри SpotCard: право слева, контрол справа. Та же геометрия у камеры сайта и у поля
 * профиля.
 *
 * ⚠️ `cols` — числовые колонки МЕЖДУ именем и контролом (занято, скорость, процент). Добавлены
 * сюда, а не отдельным компонентом-таблицей: у строки списка и строки таблицы общее всё —
 * имя, уточнение, действие, — и расходятся они ровно на этих колонках. Второй компонент означал бы
 * две геометрии строки в одном приложении, которые начнут расходиться на первой же правке.
 *
 * ⚠️ Ширины колонок ФИКСИРОВАННЫЕ (COL из system.ts), а не `auto`. Каждая строка — своя сетка,
 * поэтому `auto` выравнивает числа внутри строки и расходится между соседними: столбец идёт
 * лесенкой. Числа выравниваются по правому краю — иначе разряды не читаются вертикально.
 */
export function SpotLine({ title, hint, control, cols, colWidths }: {
  title: ReactNode;
  hint?: ReactNode;
  control?: ReactNode;
  cols?: ReactNode[];
  /** По умолчанию все колонки COL.num. Порядок тот же, что у cols. */
  colWidths?: number[];
}) {
  const widths = (cols ?? []).map((_, i) => colWidths?.[i] ?? COL.num);
  // ⚠️ Колонка действия ФИКСИРОВАННАЯ, когда есть числовые колонки: при `auto` строка с
  // кнопкой и строка без неё дают разную ширину, и числа в первых уезжают влево — таблица
  // распадается на две. Без колонок поведение прежнее: контрол по содержимому.
  const act = widths.length > 0 ? `${COL.act}px` : 'auto';
  const template = ['minmax(0, 1fr)', ...widths.map((w) => `${w}px`), act].join(' ');
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: template, gap: sp(3), alignItems: 'center',
      padding: pad(3, 4), borderTop: '1px solid var(--divider)',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ ...TEXT.body, fontWeight: 650, color: 'var(--text-strong)' }}>{title}</div>
        {hint && <div style={{ ...TEXT.caption, color: 'var(--text-muted)' }}>{hint}</div>}
      </div>
      {(cols ?? []).map((c, i) => (
        <div key={i} style={{ minWidth: 0, textAlign: 'right' }}>{c}</div>
      ))}
      {control ?? <span />}
    </div>
  );
}

/**
 * Ползунок со шкалой.
 *
 * ⚠️ Заведён по итогам переписи: ползунок был ЕДИНСТВЕННЫМ контролом настроек без сущности в
 * наборе, и поэтому его рисовало каждое место само — четыре штуки, четыре чуть разных вида. В
 * двух файлах при этом лежали почти дословно одинаковые локальные помощники с одинаковой
 * сигнатурой. Это ровно то дублирование, ради предотвращения которого набор и существует.
 *
 * ⚠️ Внутри НАСТОЯЩИЙ `input type="range"`, а не своя дорожка с мышиными обработчиками. Своя
 * реализация означала бы заново написать стрелки, Home/End, PageUp/PageDown, шаг с зажатым
 * Shift и чтение с экрана — и однажды что-нибудь из этого потерять. Оформление добавляется
 * ВОКРУГ штатного контрола, а не вместо него.
 *
 * ⚠️ Засечки — не украшение: они показывают ШАГ. У длины пароля шаг единица, у насыщенности —
 * проценты, и шкала об этом честно сообщает, пока человек не начал тащить ручку.
 *
 * ⚠️ Цвет заполнения — ТОН РАЗДЕЛА, а не акцент палитры. Тот же приём, что у фокуса поля в
 * kit.tsx: на цветной странице синяя дорожка читалась бы элементом чужого интерфейса.
 */
export function SliderRow({ label, value, min, max, step, onChange, format, majors = 5 }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
  /** Сколько крупных засечек. Мелкие расставляются между ними по четыре. */
  majors?: number;
}) {
  // Засечки считаются от числа крупных, а не задаются списком: иначе диапазон 8…64 и диапазон
  // 0…100 просили бы разные разметки руками, и одна из них рано или поздно разъехалась бы.
  const marks = Array.from({ length: (majors - 1) * 5 + 1 }, (_, i) => i % 5 === 0);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: sp(3), padding: pad(3, 4) }}>
      <span style={{ flex: '0 0 120px', ...TEXT.body, fontWeight: 550, color: 'var(--text-strong)' }}>{label}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
          height: 10, marginBottom: sp(1), color: 'var(--text-faint)',
        }}>
          {marks.map((major, i) => (
            <span key={i} style={{
              width: 1, background: 'currentColor',
              height: major ? 9 : 5, opacity: major ? 0.55 : 0.3,
            }} />
          ))}
        </div>
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={label}
          style={{
            width: '100%', display: 'block', margin: 0,
            accentColor: 'var(--section-tone, var(--accent))', cursor: 'default',
          }}
        />
      </div>
      {/* ⚠️ Капса набирается ЗДЕСЬ, а не берётся CapsLabel из kit.tsx: kit реэкспортирует этот
          модуль, и импорт обратно замкнул бы круг зависимостей. */}
      <span style={{
        ...CAPS, flex: '0 0 52px', textAlign: 'right',
        color: 'var(--text-strong)', fontVariantNumeric: 'tabular-nums',
      }}>{format(value)}</span>
    </div>
  );
}
