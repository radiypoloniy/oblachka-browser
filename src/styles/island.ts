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
// Единая точка сборки «стеклянного» рецепта (фон + backdrop-blur + кант + тень) — раньше
// был продублирован по значению в 4 местах (Hub.tsx ×2, Sidebar.tsx asideBase/innerPlate,
// TabError.tsx), каждое со своими нюансами (см. ниже). Свели все в одну фабрику, чтобы менять
// сам рецепт блюра (Этап C) одной правкой, а не искать по всем копиям.
//
// Различия между местами не косметические, поэтому не слиты вслепую — параметризованы:
// - background: --surface (карточки внутри уже стеклянной поверхности, напр. поповеры) или
//   --surface-island (сами плавающие острова — Hub, сайдбар) — разные токены, разная роль
//   по вложенности (см. radii.css: острова снаружи, карточки внутри).
// - shadow: --shadow-card (дефолт, карточки) / --shadow-island (внешние острова-оболочки,
//   тяжелее) / null (плоские чипы без тени вообще, напр. QuickPromptChip в Hub.tsx).
// - border: кант --glass-edge есть почти везде, но НЕ у Sidebar::asideBase — тот кант не несёт
//   (внешняя оболочка сайдбара, кант был бы виден только по периметру всего сайдбара разом).
//
// radius сюда намеренно не входит — он всегда разный по контексту (card/pill/island), каждый
// вызывающий добавляет свой поверх (тот же паттерн, что уже был у islandPlate).
export interface GlassPlateOptions {
  surface?: 'surface' | 'surface-island';
  shadow?: 'shadow-card' | 'shadow-island' | null;
  border?: boolean;
}

export function glassPlate({ surface = 'surface', shadow = 'shadow-card', border = true }: GlassPlateOptions = {}): React.CSSProperties {
  return {
    background: `var(--${surface})`,
    backdropFilter: 'var(--glass-filter)', WebkitBackdropFilter: 'var(--glass-filter)',
    ...(shadow ? { boxShadow: `var(--${shadow})` } : {}),
    ...(border ? { border: '1px solid var(--glass-edge)' } : {}),
  };
}

// Изначально жили только в Toolbar.tsx — вынесены сюда для переиспользования в других панелях
// (История/Настройки/поповеры). Совпадает с glassPlate() по умолчанию — оставлен константой,
// чтобы существующие потребители (`...islandPlate`) не трогать вообще.
export const islandPlate: React.CSSProperties = glassPlate();

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
