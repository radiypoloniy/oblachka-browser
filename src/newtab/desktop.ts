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
  /**
   * Заливка виджета — id из WIDGET_FILLS (см. widgets.tsx). Отсутствует = 'theme', то есть
   * плитка идёт за темой и палитрой.
   * ⚠️ Хранится ID, а не цвет. Записанный сюда literal вроде '#3B8DF0' не потемнел бы вместе с
   * тёмной темой и не сменился бы вместе с палитрой — ровно та ошибка, которую в проекте уже
   * ловили на белом фоне плиток («#FFFFFF светил на весь стол», см. CLAUDE.md).
   */
  fill?: string;
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
  // ⚠️ Нижнего порога клетки здесь НЕТ намеренно, хотя он тут был. Он вступал в силу только
  // на COLS_MIN (выше колонки считаются от CELL_TARGET, а тот заведомо больше порога) — и
  // ровно там делал сетку ШИРЕ отведённой области. Дальше начинался цикл: горизонтальная
  // полоса прокрутки съедала высоту → появлялась вертикальная → та отнимала ширину → сетка
  // пересчитывалась → полосы менялись местами. Это и было дрожанием виджетов на узком окне:
  // не рывок, а колебание между двумя раскладками несколько раз в секунду. Влезть в область
  // важнее, чем не мельчать.
  const cell = Math.min(CELL_MAX, fit);
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
 * Последовательная укладка слева направо с переносом: место элемента — функция его НОМЕРА и
 * размеров всех, кто стоит до него. Ничего больше.
 *
 * ⚠️ Раньше здесь была ЖАДНАЯ укладка: каждый элемент искал первое подходящее место с начала
 * сетки. Из-за этого мелкая иконка, стоящая в списке ДЕСЯТОЙ, запрыгивала в дырку, оставшуюся
 * после широкого виджета во ВТОРОЙ строке. Со стороны это выглядело так, будто плитки живут
 * своей жизнью: сдвинул одну — переехала другая, с которой ты ничего не делал. И поставить
 * элемент в конкретное место было нельзя в принципе: он всё равно всплывал в ближайшую дыру
 * выше. Именно это и не давало «поставить как надо».
 *
 * Теперь курсор идёт ТОЛЬКО ВПЕРЁД и назад не возвращается. Цена — видимые дыры: широкий виджет,
 * не влезающий в остаток строки, оставляет её хвост пустым, и следующая иконка туда НЕ прыгает.
 * Это честный размен: дыру человек видит и может закрыть сам, переставив элементы, а
 * самопроизвольные переезды он не контролирует никак. Так же ведут себя сетки виджетов у Apple.
 *
 * ⚠️ Занятость всё равно проверяется: высокий виджет (h=2) захватывает клетки в следующей
 * строке, и курсор обязан их перешагнуть — но перешагивает ВПЕРЁД, а не ищет место выше.
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

  // Курсор — единственное состояние укладки. Он только растёт: сначала по колонкам, потом по
  // строкам. Возврата назад нет нигде, поэтому и «всплытия» элементов вверх быть не может.
  let curRow = 0;
  let curCol = 0;

  // ⚠️ Хвост строки может занять ТОЛЬКО ближайший сосед по списку — и никто дальше. Это средний
  // путь между двумя крайностями, каждую из которых уже проверили на живом столе:
  //  • жадная укладка (было изначально) затыкала дыры кем угодно, и элемент мог приехать из
  //    другого конца экрана — плитки «жили своей жизнью»;
  //  • строго последовательная (была после первой починки) не двигала никого, но на узком окне
  //    оставляла зияющие дыры: широкий виджет не влезал в остаток строки и уходил вниз целиком.
  // Заглядывание на ОДИН элемент вперёд убирает самые заметные пустоты и при этом сохраняет
  // главное свойство: издалека приехать нельзя, максимум — сосед перепрыгнул через одного.
  const queue = [...items];
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i]!;
    const w = Math.min(item.size.w, cols); // виджет шире сетки сжимается, а не выпадает
    const h = item.size.h;

    // Не влезает в остаток строки, а следующий влез бы — пропускаем его вперёд.
    if (curCol > 0 && curCol + w > cols) {
      const next = queue[i + 1];
      if (next && curCol + Math.min(next.size.w, cols) <= cols) {
        queue[i] = next;
        queue[i + 1] = item;
        i--;             // переигрываем этот шаг уже с соседом
        continue;
      }
    }

    let r = curRow;
    let c = curCol;
    for (;;) {
      if (c + w > cols) { r++; c = 0; continue; }   // не влезает в остаток строки — на следующую
      if (!fits(r, c, w, h)) { c++; continue; }     // клетка занята высоким соседом — шаг вправо
      break;
    }

    occupy(r, c, w, h);
    placed.push({ item, col: c, row: r, w, h });
    maxRow = Math.max(maxRow, r + h);

    curRow = r;
    curCol = c + w;
    if (curCol >= cols) { curRow = r + 1; curCol = 0; }
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
      // ⚠️ Виджетов, ходящих в СЕТЬ (погода, курсы, крипта), в стартовом наборе НЕТ намеренно.
      // Стол показывается на каждой новой вкладке, то есть по умолчанию браузер сам, без единого
      // действия человека, регулярно стучался бы в Open-Meteo, ЦБ РФ и CoinGecko — и рассказывал
      // бы им, когда человек открывает вкладки, а погода вдобавок и в каком он городе. Для
      // приватного браузера это не мелочь. Добавляются они через «+», и там же сказано, куда
      // именно уйдёт запрос (см. NETWORK_WIDGETS в AddSheet.tsx).
      { id: 'w-clock',    kind: 'widget', widget: 'clock',    size: WIDGET_SIZES.small },
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
