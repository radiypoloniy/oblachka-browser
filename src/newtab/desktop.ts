// Рабочий стол новой вкладки: модель элементов, хранение и расчёт сетки.
//
// Устройство взято у springboard iPad, но с одной принципиальной поправкой. На планшете экран
// не меняется, поэтому там элемент стоит в КОНКРЕТНОЙ клетке и пустоты сохраняются. У нас окно
// ездит от 700 до 2560 px, и виджет шириной в четыре клетки просто негде поставить в сетке из
// трёх. Поэтому элемент хранит не координаты, а ПОРЯДОК и размер в клетках, а раскладка
// пересобирается на каждую ширину: элементы жадно укладываются слева направо, ширина каждого
// подрезается до числа колонок. Сломаться такой раскладке нечем — в ней нет позиций, которые
// могли бы стать недействительными.
//
// Хранится в localStorage рядом с остальными настройками вкладки (см. src/newtab/settings.ts):
// и вкладка, и раздел «Интерфейс» живут в одном рендерере, IPC между ними не нужен.

export type DesktopItemKind = 'site' | 'app' | 'widget';

/** Размер в клетках сетки. Ширина подрезается до числа колонок при отрисовке. */
export interface CellSize { w: number; h: number }

export interface DesktopItem {
  id: string;
  kind: DesktopItemKind;
  size: CellSize;
  /** kind==='site': адрес и подпись. */
  url?: string;
  title?: string;
  /** kind==='app': id из реестра приложений (см. aiApps.tsx::APPS). */
  appId?: string;
  /** kind==='widget': тип виджета (см. WIDGET_KINDS). */
  widget?: string;
}

export interface DesktopLayout {
  version: 1;
  items: DesktopItem[];
}

// ── Размеры ───────────────────────────────────────────────────────────────────
// Иконка — всегда одна клетка. Виджеты живут в трёх размерах, как у Apple: маленький квадрат,
// широкий и большой. Четвёртый (2×1) — для статусных полосок вроде «Защиты».
export const WIDGET_SIZES = {
  bar:    { w: 2, h: 1 },
  small:  { w: 2, h: 2 },
  medium: { w: 4, h: 2 },
  large:  { w: 4, h: 4 },
} as const;
export type WidgetSizeName = keyof typeof WIDGET_SIZES;

export function sizeName(size: CellSize): WidgetSizeName | null {
  for (const [name, s] of Object.entries(WIDGET_SIZES)) {
    if (s.w === size.w && s.h === size.h) return name as WidgetSizeName;
  }
  return null;
}

// ── Геометрия сетки ───────────────────────────────────────────────────────────
//
// ⚠️ Два потолка ниже — это ровно то, из-за чего сетка не выглядит ни мелкой, ни раздутой.
// Без потолка колонок на экране 2560 px получилось бы под двадцать колонок мелких иконок;
// без потолка размера клетки те же иконки на широком окне раздулись бы в лапти. Поэтому на
// большом экране сетка перестаёт расти и просто центрируется — как springboard на iPad.
const CELL_TARGET = 108; // желаемый шаг сетки, от него считается число колонок
export const CELL_MIN = 78;
export const CELL_MAX = 132;
export const COLS_MIN = 4;
export const COLS_MAX = 10;
export const GRID_GAP = 14;

export interface GridMetrics {
  cols: number;
  cell: number;
  gap: number;
  /** Ширина самой сетки — по ней центрируется контейнер. */
  width: number;
}

export function computeGrid(available: number): GridMetrics {
  const gap = GRID_GAP;
  const raw = Math.floor((available + gap) / (CELL_TARGET + gap));
  const cols = Math.max(COLS_MIN, Math.min(COLS_MAX, raw || COLS_MIN));
  const fit = (available - (cols - 1) * gap) / cols;
  const cell = Math.max(CELL_MIN, Math.min(CELL_MAX, fit));
  return { cols, cell, gap, width: cols * cell + (cols - 1) * gap };
}

// ── Укладка ───────────────────────────────────────────────────────────────────
export interface PlacedItem {
  item: DesktopItem;
  col: number;  // 0-based
  row: number;
  w: number;    // уже подрезано до числа колонок
  h: number;
}

/**
 * Жадная укладка слева направо с переносом. Элемент занимает первое место, где помещается по
 * ширине; строки заполняются по занятости клеток, поэтому широкий виджет не оставляет за собой
 * дыру, если следом идёт узкая иконка, — она встаёт рядом.
 *
 * ⚠️ Порядок элементов сохраняется всегда: человек расставил их сам, и «оптимизация» с
 * перестановкой местами выглядела бы как самовольство интерфейса.
 */
export function layoutItems(items: DesktopItem[], cols: number): { placed: PlacedItem[]; rows: number } {
  // Карта занятости: индекс строки → массив булевых по колонкам.
  const occupied: boolean[][] = [];
  const rowAt = (r: number): boolean[] => {
    while (occupied.length <= r) occupied.push(new Array<boolean>(cols).fill(false));
    return occupied[r];
  };
  const fits = (r: number, c: number, w: number, h: number): boolean => {
    if (c + w > cols) return false;
    for (let dr = 0; dr < h; dr++) {
      const row = rowAt(r + dr);
      for (let dc = 0; dc < w; dc++) if (row[c + dc]) return false;
    }
    return true;
  };
  const occupy = (r: number, c: number, w: number, h: number): void => {
    for (let dr = 0; dr < h; dr++) {
      const row = rowAt(r + dr);
      for (let dc = 0; dc < w; dc++) row[c + dc] = true;
    }
  };

  const placed: PlacedItem[] = [];
  let maxRow = 0;

  for (const item of items) {
    const w = Math.min(item.size.w, cols); // виджет шире сетки сжимается, а не выпадает
    const h = item.size.h;
    let done = false;
    for (let r = 0; !done; r++) {
      for (let c = 0; c + w <= cols; c++) {
        if (!fits(r, c, w, h)) continue;
        occupy(r, c, w, h);
        placed.push({ item, col: c, row: r, w, h });
        maxRow = Math.max(maxRow, r + h);
        done = true;
        break;
      }
    }
  }

  return { placed, rows: maxRow };
}

// ── Хранение ──────────────────────────────────────────────────────────────────
const KEY = 'oblako-desktop-layout';
const EVENT = 'oblako-desktop-changed';

// Стартовый набор. Виджеты сверху, приложения следом — тот же порядок, что на реф-скриншотах
// iPad: сначала то, что показывает данные, потом то, что запускают.
export function defaultLayout(): DesktopLayout {
  return {
    version: 1,
    items: [
      // ⚠️ Погода стоит широкой: в маленькой плитке почасовой ряд не помещается, а без него
      // виджет выглядит пустым — ровно та претензия, из-за которой их и переделывали.
      { id: 'w-weather',  kind: 'widget', widget: 'weather',  size: WIDGET_SIZES.medium },
      { id: 'w-clock',    kind: 'widget', widget: 'clock',    size: WIDGET_SIZES.small },
      { id: 'w-rates',    kind: 'widget', widget: 'rates',    size: WIDGET_SIZES.small },
      { id: 'w-tasks',    kind: 'widget', widget: 'tasks',    size: WIDGET_SIZES.medium },
      { id: 'w-topsites', kind: 'widget', widget: 'topsites', size: WIDGET_SIZES.medium },
      { id: 'a-calc',     kind: 'app', appId: 'calc',    size: { w: 1, h: 1 } },
      { id: 'a-convert',  kind: 'app', appId: 'convert', size: { w: 1, h: 1 } },
      { id: 'a-timer',    kind: 'app', appId: 'timer',   size: { w: 1, h: 1 } },
      { id: 'a-counter',  kind: 'app', appId: 'counter', size: { w: 1, h: 1 } },
      { id: 'a-color',    kind: 'app', appId: 'color',   size: { w: 1, h: 1 } },
      { id: 'a-kitten',   kind: 'app', appId: 'kitten',  size: { w: 1, h: 1 } },
    ],
  };
}

export function loadDesktop(): DesktopLayout {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultLayout();
    const parsed = JSON.parse(raw) as Partial<DesktopLayout>;
    if (!Array.isArray(parsed.items)) return defaultLayout();
    // Терпимо к чужому/старому JSON: элементы без обязательных полей просто выкидываем, а не
    // роняем весь экран — раскладка это косметика, а не данные пользователя.
    const items = parsed.items.filter((i): i is DesktopItem =>
      !!i && typeof i.id === 'string' && typeof i.kind === 'string'
      && !!i.size && typeof i.size.w === 'number' && typeof i.size.h === 'number');
    return { version: 1, items };
  } catch {
    return defaultLayout();
  }
}

export function saveDesktop(layout: DesktopLayout): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(layout));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch { /* квота переполнена — раскладка не критична, молчим */ }
}

export function subscribeDesktop(cb: () => void): () => void {
  const handler = (): void => cb();
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

// ── Правка раскладки ──────────────────────────────────────────────────────────
// Все операции возвращают НОВЫЙ объект раскладки: состояние живёт в React, и мутация на месте
// не вызвала бы перерисовку.

/** Переставить элемент на новое место в порядке укладки. */
export function moveItem(layout: DesktopLayout, id: string, toIndex: number): DesktopLayout {
  const from = layout.items.findIndex((i) => i.id === id);
  if (from < 0) return layout;
  const items = [...layout.items];
  const [item] = items.splice(from, 1);
  // ⚠️ Индекс назначения считается по списку БЕЗ переносимого элемента: иначе при движении
  // вперёд элемент вставал бы на позицию раньше желаемой ровно на единицу.
  const to = Math.max(0, Math.min(items.length, toIndex > from ? toIndex - 1 : toIndex));
  items.splice(to, 0, item);
  return { ...layout, items };
}

/** Изменить размер элемента. Иконки не растягиваются — у них смысл ровно одна клетка. */
export function resizeItem(layout: DesktopLayout, id: string, size: CellSize): DesktopLayout {
  return {
    ...layout,
    items: layout.items.map((i) => (i.id === id && i.kind === 'widget'
      ? { ...i, size: { w: Math.max(1, Math.min(6, size.w)), h: Math.max(1, Math.min(4, size.h)) } }
      : i)),
  };
}

export function removeItem(layout: DesktopLayout, id: string): DesktopLayout {
  return { ...layout, items: layout.items.filter((i) => i.id !== id) };
}

export function addItem(layout: DesktopLayout, item: Omit<DesktopItem, 'id'>): DesktopLayout {
  const id = `${item.kind}-${Date.now().toString(36)}`;
  return { ...layout, items: [...layout.items, { ...item, id }] };
}

/** Уже стоит ли на столе это приложение/виджет — чтобы палитра не предлагала дубль. */
export function hasItem(layout: DesktopLayout, kind: DesktopItemKind, key: string): boolean {
  return layout.items.some((i) => i.kind === kind && (i.appId === key || i.widget === key));
}
