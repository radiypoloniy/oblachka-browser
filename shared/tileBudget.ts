// Сколько содержимого влезает в плитку стола — чистая арифметика без React и без DOM.
//
// ⚠️ Файл заведён по разбору «узкое окно» (25.08.2026). Виджеты сжимались вместе с клеткой, а
// решение «показывать блок или нет» принималось по ПОРОГУ ВЫСОТЫ КОРОБКИ (`box.height > 150`),
// который ничего не знал про то, сколько уже занято шапкой, числом и описанием. На клетке 105
// обязательная часть погоды съедала 175 px из 224, почасовому ряду нужно 75, порог его всё равно
// включал — и `overflow: hidden` срезал ряду низ. На снимке это выглядело как «часы 09/10/11 без
// температуры».
//
// Поэтому здесь два разных инструмента, и путать их не надо:
//  • densityOf/fromCell — как ужимается ТО, ЧТО РИСУЕТСЯ ВСЕГДА (поля, иконки, кнопки);
//  • weatherFit и подобные — что вообще ПОКАЗЫВАТЬ, по остатку места, а не по порогу.
//
// ⚠️ Значимых импортов тут быть не должно: проверка (scripts/tile-budget-check.mjs) гоняется
// голым node — то же правило, что у shared/sessionTree.ts.

/** Потолок клетки (CELL_MAX в src/newtab/desktop.ts). От него считается ужимание. */
export const CELL_REF = 132;

export type TileDensity = 'tight' | 'snug' | 'roomy';

/**
 * Насколько тесно на плитке.
 *
 * ⚠️ Границы взяты из замера, а не на глаз: клетка держится на потолке 132, пока область сетки
 * шире 862 px; при 800 даёт 122, при 700 — 105, при 640 (окно 900 — минимум) — 95. То есть
 * `snug` — это «окно поджали», а `tight` — «окно у нижней границы вообще».
 */
export function densityOf(cell: number): TileDensity {
  if (cell < 92) return 'tight';
  if (cell < 116) return 'snug';
  return 'roomy';
}

/** Поля плитки по плотности. Те же три ступени, что были у виджетов вручную. */
export function padOf(density: TileDensity): number {
  return density === 'tight' ? 10 : density === 'snug' ? 12 : 16;
}

/**
 * Абсолютный размер, ужатый вместе с клеткой.
 *
 * ⚠️ Ровно то, чего не хватало: иконка часа (30), кнопки плеера (38/30) и ячейка топ-сайтов
 * (76×80) были константами и на узком окне не менялись вовсе, пока плитка вокруг них теряла
 * четверть высоты. Клетка выше потолка не бывает, поэтому масштаб только вниз.
 */
export function fromCell(px: number, cell: number, min = 0): number {
  const k = Math.min(1, Math.max(0, cell) / CELL_REF);
  return Math.max(min, Math.round(px * k));
}

/** Влезет ли блок высотой need, если из коробки уже занято used. */
export function fitsBlock(boxHeight: number, used: number, need: number): boolean {
  return boxHeight - used >= need;
}

// ── Погода ────────────────────────────────────────────────────────────────────
// Единственная плитка, которая набирает четыре яруса сразу (шапка, число, описание, воздух и
// почасовой ряд), — и потому единственная, где переполнение видно первым.

/** Высоты ярусов погоды. Замерены по текущей вёрстке (кегли --fs-sm/--fs-xs и отступы). */
const W_HEADER = 19;   // город и крайности суток
const W_DESC = 20;     // «Малооблачно, ощущается 20°» вместе с marginTop
const W_AIR = 22;      // «Воздух: 21 · нормально ↑ 05:37 ↓ 19:14» вместе с marginTop
const W_HOURS_CHROME = 45; // отступ, линия, час и температура — всё, кроме самого значка
const W_GAP = 4;       // зазор между шапкой и числом
/** Минимальная ширина столбца почасового ряда: у́же цифры начинают слипаться. */
const W_HOUR_COL = 34;

export interface WeatherFit {
  /** Кегль ключевого числа. */
  tempSize: number;
  /** Значок погоды рядом с числом. */
  iconSize: number;
  showAir: boolean;
  /** Сколько столбцов почасового ряда рисовать; 0 — ряда нет вовсе. */
  hours: number;
  /** Значок в столбце почасового ряда. */
  hourIcon: number;
}

/**
 * Что показывает погода в коробке box при клетке cell.
 *
 * ⚠️ Порядок предпочтения — сверху вниз по вёрстке: сначала строка воздуха (дешёвая, 22 px),
 * потом почасовой ряд. Так плитка не «прыгает содержанием» при плавном изменении размера: блоки
 * гаснут в том же порядке, в каком стоят.
 */
export function weatherFit(
  box: { width: number; height: number },
  cell: number,
  wide: boolean,
  has: { air: boolean; hours: number },
): WeatherFit {
  const density = densityOf(cell);
  const pad = padOf(density);
  const grow = wide ? 0.3 : 0.34;
  // Прежняя формула кегля сохранена — она честно считалась от коробки. Добавлен только потолок
  // по плотности: на тесной клетке 64 px числа не оставляли места ни на что другое.
  const cap = density === 'tight' ? 46 : density === 'snug' ? 56 : 64;
  const hourIcon = fromCell(30, cell, 20);
  const byWidth = Math.floor((box.width - pad * 2) / W_HOUR_COL);
  const wanted = Math.min(has.hours, wide ? 6 : 3, Math.max(0, byWidth));

  const fit = (limit: number): WeatherFit => {
    const tempSize = Math.round(Math.min(box.height * grow, limit));
    let used = pad * 2 + W_HEADER + W_GAP + tempSize + W_DESC;
    const showAir = has.air && fitsBlock(box.height, used, W_AIR);
    if (showAir) used += W_AIR;
    const hours = wanted > 0 && fitsBlock(box.height, used, W_HOURS_CHROME + hourIcon) ? wanted : 0;
    return { tempSize, iconSize: Math.round(tempSize * 1.05), showAir, hours, hourIcon };
  };

  // ⚠️ Порядок попыток — это приоритет: ПОЧАСОВОЙ РЯД ВАЖНЕЕ КРУПНОГО ЧИСЛА. Сначала пробуем с
  // прижатым по плотности кеглем — так у ряда есть шанс; не влез всё равно — отдаём
  // освободившееся место числу, иначе плитка получает крупную дыру внизу.
  const first = fit(cap);
  return first.hours > 0 ? first : fit(64);
}

// ── Музыка ────────────────────────────────────────────────────────────────────

export interface MusicFit {
  /** Сколько кнопок сервисов показывать в состоянии «ничего не играет». */
  services: number;
  /** Показывать ли поясняющую строку под кнопками. */
  hint: boolean;
  /** Кнопки транспорта: главная и боковые. */
  primary: number;
  secondary: number;
}

/**
 * ⚠️ Причина наложения на снимке: две кнопки сервисов переносились на две строки, контент
 * становился выше коробки, а `justify-content: center` при переполнении растит его в ОБЕ стороны
 * — верхняя строка уезжала под собственную подпись плитки. Лечится парой: `safe center` в вёрстке
 * и одна кнопка вместо двух здесь.
 */
export function musicFit(box: { width: number; height: number }, cell: number): MusicFit {
  const density = densityOf(cell);
  const pad = padOf(density);
  // Подпись плитки + строка «Ничего не играет» + сами кнопки.
  const avail = box.height - pad * 2 - 13 - 18 - 8;
  const rowH = fromCell(28, cell, 24);
  return {
    services: avail >= rowH * 2 + 6 ? 2 : 1,
    hint: avail >= rowH * 2 + 6 + 16,
    primary: fromCell(38, cell, 30),
    secondary: fromCell(30, cell, 24),
  };
}

// ── Топ-сайты ─────────────────────────────────────────────────────────────────

/** Ячейка сетки часто открываемых сайтов: была константой 76×80 при любой клетке. */
export function tileGridCell(cell: number): { w: number; h: number } {
  return { w: fromCell(76, cell, 58), h: fromCell(80, cell, 62) };
}
