// Геометрия и бумага оформленного снимка вкладки.
//
// ⚠️ Живёт отдельно и без импортов: поля и радиус — доли от размера кадра, и ошибка в формуле
// на HiDPI выглядит «тень жиже, чем у macOS», а не падением. Прогон гоняет обычным node
// (scripts/screenshot-decorate-check.mjs).
//
// ⚠️ Бумага — литерал светлого --n3 (`#EEEEF1` в colors.css), не CSS-токен. Canvas не резолвит
// var(), и кадр НЕ должен следовать теме браузера: тёмная подложка снова станет чёрной рамкой
// в мессенджере, когда Windows выкинет альфу (DIB без прозрачности).

/** Светлая бумага под тенью. Совпадает с --n3 шкалы Угля, нарочно скопирована. */
export const SHOT_PAPER = '#EEEEF1';

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export interface ShotFrame {
  /** Поле вокруг страницы — место под тень. */
  pad: number;
  /** Скругление самой страницы. */
  radius: number;
  /** Ширина холста с полями. */
  width: number;
  /** Высота холста с полями. */
  height: number;
}

/** Поля, радиус и размер холста для кадра w×h. */
export function shotFrame(w: number, h: number): ShotFrame {
  const min = Math.min(w, h);
  const pad = clamp(Math.round(min * 0.055), 28, 110);
  const radius = clamp(Math.round(min * 0.018), 10, 28);
  return { pad, radius, width: w + pad * 2, height: h + pad * 2 };
}
