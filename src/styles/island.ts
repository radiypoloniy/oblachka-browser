import type React from 'react';

// ── Стиль кнопки навигации ────────────────────────────────────────────────────
// Живёт здесь (не в Toolbar.tsx), потому что islandBtn ниже строится поверх неё —
// вынесены вместе, чтобы не создавать циклический импорт между Toolbar.tsx и этим модулем.
export function navBtn(disabled: boolean): React.CSSProperties {
  return {
    border: 'none', background: 'transparent', padding: 7, borderRadius: 'var(--radius-sm)',
    color: disabled ? 'var(--text-faint)' : 'var(--text-muted)',
    cursor: 'default', display: 'inline-flex', opacity: disabled ? 0.45 : 1,
  };
}

// ── Плавающие плашки-острова ───────────────────────────────────────────────────
// Параметры стекла/тени/скругления — те же, что отлажены в поповере/AI-панели
// (surface + glass-filter + shadow-card + glass-edge). Изначально жили только в
// Toolbar.tsx — вынесены сюда для переиспользования в других панелях (История/Настройки).
export const islandPlate: React.CSSProperties = {
  background: 'var(--surface)',
  backdropFilter: 'var(--glass-filter)', WebkitBackdropFilter: 'var(--glass-filter)',
  boxShadow: 'var(--shadow-card)',
  border: '1px solid var(--glass-edge)',
};

// Одиночная кнопка-остров (AI, адблок) — тот же islandPlate, компактный размер как у navBtn.
export function islandBtn(color?: string, bg?: string): React.CSSProperties {
  return {
    ...navBtn(false),
    ...islandPlate,
    color: color ?? 'var(--text-muted)',
    background: bg ?? 'var(--surface)',
    borderRadius: 'var(--radius-card)',
  };
}
