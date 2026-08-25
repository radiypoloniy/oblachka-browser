import type React from 'react';

/**
 * Кольцо прогресса вокруг кнопки загрузок.
 *
 * ⚠️ `value === null` означает «идёт, но сколько — неизвестно» (сервер не отдал размер): тогда
 * кольцо крутится дугой в четверть окружности, а не стоит пустым. Пустое кольцо читается как
 * «загрузка не началась», и человек жмёт скачать второй раз.
 *
 * ⚠️ Поворот на -90° — чтобы дуга начиналась сверху, а не справа: так её видят все и так она
 * нарисована в макете.
 */
export function ProgressRing({ value }: { value: number | null }): React.ReactElement {
  const R = 13;
  const LEN = 2 * Math.PI * R;
  return (
    <svg
      viewBox="0 0 32 32" width={30} height={30} aria-hidden
      style={{
        position: 'absolute', inset: 0, margin: 'auto', pointerEvents: 'none',
        transform: 'rotate(-90deg)', // старт дуги сверху, а не справа
        animation: value === null ? 'oblako-dl-spin 1.1s linear infinite' : undefined,
      }}
    >
      <circle cx="16" cy="16" r={R} fill="none" stroke="var(--accent)" strokeOpacity={0.18} strokeWidth="2" />
      <circle
        cx="16" cy="16" r={R} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"
        strokeDasharray={LEN}
        strokeDashoffset={LEN * (1 - (value ?? 0.25))}
        style={{ transition: value === null ? undefined : 'stroke-dashoffset var(--dur-slow) var(--ease-standard)' }}
      />
    </svg>
  );
}
