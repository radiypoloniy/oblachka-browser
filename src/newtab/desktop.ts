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
  /**
   * Место в сетке — 0-based клетка левого верхнего угла. Хранить координаты стало можно ровно
   * тогда, когда число колонок перестало зависеть от ширины окна (см. computeGrid): пока сетка
   * плавала, клетка №7 существовала не при всякой ширине, и приходилось хранить порядок.
   * ⚠️ Отсутствуют у только что добавленного элемента — он встаёт в первую свободную клетку
   * (см. placeItems). Это не «неопределённое состояние», а честное «человек ещё не выбирал».
   */
  col?: number;
  row?: number;
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
  /**
   * kind==='widget': этот виджет — ГЕРОЙ стола (высота 3, цвет в полную силу).
   *
   * ⚠️ Героя выбирает ЧЕЛОВЕК, а не код: набор виджетов у каждого свой, и «главным» на одном
   * столе будет погода, на другом — курс или защита. Инвариант «ровно один герой» держит
   * setHero ниже: он снимает флаг со всех остальных.
   */
  hero?: boolean;
  /**
   * kind==='widget' && widget==='gen': ключ тела одностраничника (oblako-desktop-gen-<id>).
   * Несколько своих виджетов на столе — разные genId. Само тело не лежит в раскладке.
   */
  genId?: string;
}

/**
 * Назначить героя стола. Возвращает НОВУЮ раскладку: снимает флаг со всех и ставит одному.
 *
 * ⚠️ Повторный вызов на том же элементе снимает геройство — «сделать главным» это переключатель,
 * а не одностороннее действие. Без этого убрать героя было бы нечем, кроме как назначив другого.
 */
export function setHero(layout: DesktopLayout, id: string): DesktopLayout {
  const wasHero = layout.items.find((i) => i.id === id)?.hero === true;
  return {
    ...layout,
    items: layout.items.map((i) => (i.id === id ? { ...i, hero: !wasHero } : (i.hero ? { ...i, hero: false } : i))),
  };
}

export interface DesktopLayout {
  /** 2 — элементы хранят координаты. 1 (только на диске) — хранился порядок, см. loadDesktop. */
  version: 2;
  items: DesktopItem[];
  /**
   * Число колонок сетки. Живёт ЗДЕСЬ, а не в настройках вкладки (src/newtab/settings.ts), хотя
   * человек меняет его в той же панели: это не украшение, а система координат раскладки —
   * размеры элементов заданы в клетках, и менять их порознь нельзя. Отсутствует у раскладок,
   * сохранённых до появления настройки, — тогда DEFAULT_COLS.
   */
  cols?: number;
  /** Размер плиток (см. SCALE_PRESETS). Он же задаёт число колонок при смене. */
  scale?: DesktopScale;
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

/**
 * Минимальный размер виджета в клетках — по типу.
 *
 * ⚠️ Это не вкусовщина, а ДОГОВОР с отрисовкой. Тянуть за угол можно было любой виджет до 1×1, и
 * на такой плитке содержимое просто налезало само на себя: у «Курса ЦБ» подпись сталкивалась с
 * «USD · 30 дней», у «Защиты» счётчик уезжал под заголовок, а строка «заблокировано за сеанс»
 * рвалась на три. Никакой адаптацией это не лечится: в 97 px нельзя показать число и подписать
 * его, места нет физически. Поэтому виджет объявляет, ниже чего он не работает, а укладка это
 * соблюдает — и в момент растягивания, и при чтении раскладки с диска (там уже могли остаться
 * плитки, утянутые до 1×1 руками).
 *
 * Ключ — тот же, что у WIDGET_RENDERERS. Неизвестный тип ограничения не получает: чужой виджет
 * лучше показать как есть, чем молча раздуть.
 */
export const WIDGET_MIN: Record<string, CellSize> = {
  // Число и подпись под ним: одна строка — заголовок, вторая — значение.
  rates:  { w: 2, h: 1 },
  crypto: { w: 2, h: 1 },
  shield: { w: 2, h: 1 },
  holiday:{ w: 2, h: 1 },
  // Картинка плюс две строки текста рядом с ней — в одну клетку не складывается никак.
  moon:    { w: 2, h: 2 },
  weather: { w: 2, h: 2 },
  // Списочные: смысл появляется, когда видно хотя бы одну строку списка, а не только заголовок.
  tasks:     { w: 2, h: 2 },
  downloads: { w: 2, h: 2 },
  topsites:  { w: 2, h: 2 },
  tracking:  { w: 2, h: 2 },  // число плюс строка о подешевевшем — в одну клетку не складывается
  digest:    { w: 4, h: 2 },  // строки итога — фразы, в две клетки ширины они не читаются
  // Свой одностраничник: меньше 2×2 iframe некуда, там же кнопки таймера.
  gen:     { w: 2, h: 2 },
  // Часам хватает и клетки: циферблат просто становится меньше, налезать там нечему.
  clock: { w: 1, h: 1 },
  // Сетка дней — семь колонок: в одну клетку это 17 px на день, то есть нечитаемо в принципе.
  calendar: { w: 2, h: 2 },
  // Время, три кнопки длительности и кнопка хода — в клетку не складывается.
  timer: { w: 2, h: 2 },
};

/** Наименьший размер, до которого можно ужать этот элемент. Иконки — всегда одна клетка. */
export function minSizeFor(item: Pick<DesktopItem, 'kind' | 'widget'>): CellSize {
  if (item.kind !== 'widget') return { w: 1, h: 1 };
  return WIDGET_MIN[item.widget ?? ''] ?? { w: 1, h: 1 };
}

export function sizeName(size: CellSize): WidgetSizeName | null {
  for (const [name, s] of Object.entries(WIDGET_SIZES)) {
    if (s.w === size.w && s.h === size.h) return name as WidgetSizeName;
  }
  return null;
}

// ── Геометрия сетки ───────────────────────────────────────────────────────────
//
// ⚠️ ЧИСЛО КОЛОНОК ПОСТОЯННО и от ширины окна не зависит — это главное решение всего экрана,
// и оно же лечит сразу две жалобы, которые казались разными.
//
// Раньше колонки считались от ширины (от 4 до 10), и отсюда шло всё остальное: раз в сетке
// то пять колонок, то девять, координаты элемента хранить нельзя (в сетке из пяти нет клетки
// №7), значит хранится порядок, значит место вычисляется заново на каждую ширину — а любое
// правило пересчёта это выбор из двух зол. Жадное затыкает дыры, но плитки переезжают сами;
// последовательное никого не двигает, но оставляет дыры. Обе жалобы («при сжатии окна
// появляются пустоты» и «поставить как нравится нельзя») — это одна и та же плавающая сетка.
//
// Теперь при сжатии окна меняется РАЗМЕР КЛЕТКИ, а не расклад: сетка одна и та же от 520 px
// до 2560 px, как springboard на iPad — там она 6×5 и на 11", и на 13", отличается только шаг.
//
// Два потолка ниже — то, из-за чего сетка не выглядит ни мелкой, ни раздутой: без потолка
// клетки иконки на широком окне раздулись бы в лапти, а без потолка зазора между ними
// появились бы коридоры. Упёрлись в оба — сетка просто центрируется.
export const CELL_MAX = 132;
export const GRID_GAP = 14;
// ⚠️ Потолок зазора низкий намеренно. Зазор входит ВНУТРЬ многоклеточного виджета (плитка 2×2 —
// это две клетки плюс зазор между ними), поэтому раздутый зазор раздувает и сами виджеты: при 40
// px плитка 2×2 из клеток по 120 выходила 280 px вместо 264 и на глаз читалась как «крупная».
// Исторически зазор был всегда 14 и не рос вовсе; 24 — компромисс, при котором сетка на широком
// окне не выглядит тесным островком, но и виджеты не пухнут.
const GAP_MAX = 24;
export const COLS_MIN = 4;
export const COLS_MAX = 10;
export const DEFAULT_COLS = 6;

/**
 * Размер плиток — ОДНА ручка на два связанных числа: сколько колонок и до скольких пикселей
 * растёт клетка. Порознь их выставлять нельзя: шесть мелких плиток на широком окне собрались бы
 * в островок посреди пустоты, а восемь крупных не поместились бы вовсе.
 *
 * ⚠️ Значения не выдуманы, а взяты из ИСТОРИИ этого же экрана. Пока колонки считались от ширины
 * (`CELL_TARGET = 108`), клетка выходила такой: на области 1320 px — 10 колонок по 119, на
 * 1100 — 9 по 110, на 900 — 7 по 117, на 700 — 5 по 129. То есть жила в вилке 110…132, и ниже
 * 110 стол не опускался никогда — туда не идём и здесь. Заморозка колонок сама по себе сделала
 * стол крупнее (6 колонок вместо 9–10 при клетке в потолок 132), и «Средний» возвращает прежнее
 * ощущение, а «Крупный» оставляет то, что получилось после заморозки, — кому так и понравилось.
 */
export type DesktopScale = 'compact' | 'medium' | 'large';
export const SCALE_PRESETS: Record<DesktopScale, { cols: number; cell: number; label: string }> = {
  compact: { cols: 8, cell: 110, label: 'Мелкий' },
  medium:  { cols: 6, cell: 120, label: 'Средний' },
  large:   { cols: 5, cell: 140, label: 'Крупный' },
};
export const DEFAULT_SCALE: DesktopScale = 'medium';

export function scaleOf(layout: Pick<DesktopLayout, 'scale'>): DesktopScale {
  const s = layout.scale;
  return s && s in SCALE_PRESETS ? s : DEFAULT_SCALE;
}

export function clampCols(cols: number | undefined): number {
  if (!cols || !Number.isFinite(cols)) return DEFAULT_COLS;
  return Math.max(COLS_MIN, Math.min(COLS_MAX, Math.round(cols)));
}

export interface GridMetrics {
  cols: number;
  cell: number;
  gap: number;
  /** Ширина самой сетки — по ней центрируется контейнер. */
  width: number;
}

export function computeGrid(available: number, colsSetting: number, cellMax = CELL_MAX): GridMetrics {
  const cols = clampCols(colsSetting);
  const fit = (available - (cols - 1) * GRID_GAP) / cols;
  // ⚠️ Нижнего порога клетки здесь НЕТ намеренно, хотя он тут был. Он делал сетку ШИРЕ
  // отведённой области, и дальше начинался цикл: горизонтальная полоса прокрутки съедала
  // высоту → появлялась вертикальная → та отнимала ширину → сетка пересчитывалась → полосы
  // менялись местами. Это и было дрожанием виджетов на узком окне: не рывок, а колебание
  // между двумя раскладками несколько раз в секунду. Влезть в область важнее, чем не мельчать.
  const cell = Math.min(cellMax, fit);
  // Клетка упёрлась в потолок, а место ещё осталось — отдаём его ЗАЗОРУ, а не плиткам: иначе
  // на широком окне шесть колонок собирались бы в тесный островок посреди пустоты.
  const slack = Math.max(0, available - (cols * cell + (cols - 1) * GRID_GAP));
  const gap = cols > 1 ? Math.min(GAP_MAX, GRID_GAP + slack / (cols - 1)) : GRID_GAP;
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

/** Сетка занятости — общая механика для обеих укладок ниже. */
function makeGrid(cols: number) {
  const occupied: boolean[][] = [];
  const rowAt = (r: number): boolean[] => {
    while (occupied.length <= r) occupied.push(new Array<boolean>(cols).fill(false));
    return occupied[r]!;
  };
  const fits = (r: number, c: number, w: number, h: number): boolean => {
    if (c < 0 || r < 0 || c + w > cols) return false;
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
  /** Первая свободная клетка в порядке чтения, начиная с указанной строки. */
  const firstFree = (w: number, h: number, fromRow = 0): { col: number; row: number } => {
    for (let r = Math.max(0, fromRow); r < 500; r++) {
      for (let c = 0; c + w <= cols; c++) if (fits(r, c, w, h)) return { col: c, row: r };
    }
    return { col: 0, row: 0 }; // недостижимо: пустых строк снизу бесконечно много
  };
  return { fits, occupy, firstFree };
}

function byRowCol(a: DesktopItem, b: DesktopItem): number {
  return (a.row ?? 0) - (b.row ?? 0) || (a.col ?? 0) - (b.col ?? 0);
}

/**
 * Раскладка ПО КООРДИНАТАМ: элемент стоит там, куда его положили, и дыры между элементами
 * сохраняются — это выбор человека, а не побочный эффект укладки.
 *
 * ⚠️ Ничего никуда не «всплывает». Это главное отличие от прежней укладки по порядку: там место
 * элемента зависело от размеров всех предыдущих, поэтому любая правка могла сдвинуть половину
 * экрана, а поставить плитку в конкретную клетку было нельзя в принципе. Здесь правка одного
 * элемента не касается остальных вообще.
 *
 * Разбираются ровно два случая, и оба — про данные, которые не человек писал:
 *  • элемент без координат (только что добавленный) — встаёт в первую свободную клетку;
 *  • наложение (сменилась плотность сетки, изменился размер виджета, кто-то поправил
 *    localStorage) — проигравший сдвигается в ближайшую свободную клетку, а не исчезает.
 * Кто «выигрывает» при наложении — решает порядок чтения (сверху слева), плюс priorityId:
 * при растягивании виджета на месте обязан остаться именно тот, который тянут.
 */
export function placeItems(items: DesktopItem[], colsSetting: number, priorityId?: string): { placed: PlacedItem[]; rows: number } {
  const cols = clampCols(colsSetting);
  const { fits, occupy, firstFree } = makeGrid(cols);
  const placed: PlacedItem[] = [];
  let maxRow = 0;

  const positioned = items.filter((i) => typeof i.col === 'number' && typeof i.row === 'number');
  const floating = items.filter((i) => typeof i.col !== 'number' || typeof i.row !== 'number');
  const ordered = positioned.sort(byRowCol);
  if (priorityId) {
    const idx = ordered.findIndex((i) => i.id === priorityId);
    if (idx > 0) ordered.unshift(...ordered.splice(idx, 1));
  }

  for (const item of [...ordered, ...floating]) {
    const w = Math.min(item.size.w, cols); // виджет шире сетки сжимается, а не выпадает
    const h = item.size.h;
    let col = Math.max(0, Math.min(cols - w, item.col ?? 0));
    let row = Math.max(0, item.row ?? 0);
    if (!fits(row, col, w, h)) ({ col, row } = firstFree(w, h, typeof item.row === 'number' ? row : 0));
    occupy(row, col, w, h);
    placed.push({ item, col, row, w, h });
    maxRow = Math.max(maxRow, row + h);
  }

  return { placed, rows: maxRow };
}

/**
 * Записать фактические координаты обратно в раскладку. Нужна там, где расстановку решал не
 * человек, а код (миграция, смена плотности, растягивание виджета в тесноте): без этого
 * сохранённое состояние разошлось бы с тем, что человек видит на экране.
 */
export function normalize(layout: DesktopLayout, priorityId?: string): DesktopLayout {
  const { placed } = placeItems(layout.items, layout.cols ?? DEFAULT_COLS, priorityId);
  return {
    ...layout,
    items: placed
      .map((p) => ({ ...p.item, col: p.col, row: p.row }))
      .sort(byRowCol), // порядок в файле = порядок чтения на экране, так его хотя бы можно читать
  };
}

/**
 * Последовательная укладка слева направо с переносом: место элемента — функция его НОМЕРА и
 * размеров всех, кто стоит до него. Ничего больше.
 *
 * ⚠️ Больше НЕ рисует экран — с переходом на координаты (см. placeItems) она осталась ровно для
 * двух случаев, где расставлять приходится за человека: перенос старой раскладки, хранившей
 * порядок, и смена плотности сетки, после которой прежние координаты недействительны.
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
export function layoutItems(items: DesktopItem[], colsSetting: number): { placed: PlacedItem[]; rows: number } {
  const cols = clampCols(colsSetting);
  const { fits, occupy } = makeGrid(cols);
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

// ⚠️ У КАЖДОГО ПРОФИЛЯ СВОЙ СТОЛ. Иначе новый профиль открывался с чужими плитками: «часто
// открываете» и «чем занимался» строятся из истории, а она общая на приложение. Человек заводит
// «Отдых», открывает новую вкладку — и видит там рабочие сайты. Живая жалоба 22.08, и она про
// то же, что пустые папки: содержимое рассказывает о человеке, даже когда он этого не просил.
//
// ⚠️ Ключ основного профиля НЕ МЕНЯЕТСЯ. Там уже лежит разложенный человеком стол, и переезд на
// новый ключ означал бы, что он однажды открыл браузер и увидел набор по умолчанию вместо своего.
let activeProfileId = 'default';

function layoutKey(): string {
  return activeProfileId === 'default' ? KEY : `${KEY}-${activeProfileId}`;
}

/** Сменился активный профиль — стол обязан перечитаться под него. */
export function setDesktopProfile(id: string): void {
  const next = id || 'default';
  if (next === activeProfileId) return;
  activeProfileId = next;
  window.dispatchEvent(new CustomEvent(EVENT));
}

// Стартовый набор. Виджеты сверху, приложения следом — тот же порядок, что на реф-скриншотах
// iPad: сначала то, что показывает данные, потом то, что запускают.
// ⚠️ Координат у стартовых элементов нет намеренно: их расставит placeItems в первые свободные
// клетки, и это ровно то же, что человек увидел бы, разложив их сам сверху вниз.
export function defaultLayout(): DesktopLayout {
  return {
    version: 2,
    scale: DEFAULT_SCALE,
    cols: SCALE_PRESETS[DEFAULT_SCALE].cols,
    // ⚠️ Набор СОБРАН, а не «что первое пришло»: стол показывается на каждой новой вкладке и это
    // лицо продукта, поэтому у плиток заданы и КООРДИНАТЫ, и ЗАЛИВКИ. Без координат укладчик
    // выстраивает их подряд, без заливок всё уходит в цвет темы — стол выглядит серой сеткой,
    // хотя каждая плитка по отдельности хороша.
    //
    // ⚠️ Цвета взяты из плакатного набора и НЕ ПОВТОРЯЮТСЯ рядом: небо у часов, графит у защиты,
    // страсть у таймера, горчица у календаря. Соседние плитки одного тона сливаются в пятно —
    // это уже ловили на паре «погода и календарь», когда обе были синими.
    //
    // ⚠️ Виджеты, ходящие в СЕТЬ БЕЗ СПРОСА (курс валют, крипта), в наборе по-прежнему НЕТ.
    // Стол открывается на каждой новой вкладке, то есть браузер сам, без единого действия
    // человека, регулярно стучался бы в ЦБ РФ и CoinGecko. Добавляются через «+», и там сказано,
    // куда уйдёт запрос (NETWORK_WIDGETS в AddSheet.tsx).
    // ⚠️ Погода — ИСКЛЮЧЕНИЕ, и оно проверяемое: без выбранного города запроса нет вовсе
    // (`if (!city) return` в WeatherWidget), плитка показывает «Укажите город». То есть в наборе
    // она стоит молча и оживает только после явного действия человека.
    items: [
      { id: 'w-clock',    kind: 'widget', widget: 'clock',    size: WIDGET_SIZES.small,  col: 0, row: 0, fill: 'blue' },
      { id: 'w-shield',   kind: 'widget', widget: 'shield',   size: WIDGET_SIZES.bar,    col: 2, row: 0, fill: 'slate' },
      { id: 'w-music',    kind: 'widget', widget: 'music',    size: WIDGET_SIZES.bar,    col: 2, row: 1 },
      { id: 'w-weather',  kind: 'widget', widget: 'weather',  size: WIDGET_SIZES.small,  col: 4, row: 0 },
      { id: 'w-timer',    kind: 'widget', widget: 'timer',    size: WIDGET_SIZES.small,  col: 0, row: 2, fill: 'pink' },
      { id: 'w-calendar', kind: 'widget', widget: 'calendar', size: { w: 3, h: 2 },      col: 2, row: 2, fill: 'mustard' },
      { id: 'w-tasks',    kind: 'widget', widget: 'tasks',    size: WIDGET_SIZES.medium, col: 0, row: 4 },
      { id: 'w-topsites', kind: 'widget', widget: 'topsites', size: WIDGET_SIZES.medium, col: 4, row: 4 },
      { id: 'a-calc',     kind: 'app', appId: 'calc',    size: { w: 1, h: 1 }, col: 5, row: 2 },
      { id: 'a-convert',  kind: 'app', appId: 'convert', size: { w: 1, h: 1 }, col: 5, row: 3 },
      { id: 'a-timer',    kind: 'app', appId: 'timer',   size: { w: 1, h: 1 }, col: 0, row: 6 },
      { id: 'a-counter',  kind: 'app', appId: 'counter', size: { w: 1, h: 1 }, col: 1, row: 6 },
      { id: 'a-color',    kind: 'app', appId: 'color',   size: { w: 1, h: 1 }, col: 2, row: 6 },
      { id: 'a-kitten',   kind: 'app', appId: 'kitten',  size: { w: 1, h: 1 }, col: 3, row: 6 },
    ],
  };
}

/**
 * Стартовый набор НОВОГО профиля.
 *
 * ⚠️ Беднее общего ровно на то, что построено из ИСТОРИИ: «часто открываете» и «чем занимался».
 * История у профилей пока общая, поэтому в свежем профиле эти плитки показывали бы сайты из
 * другого — того самого, от которого человек и отделялся. Часы, дела и приложения ничего о нём
 * не рассказывают и в сеть не ходят; всё остальное он добавит сам через «+», и его выбор
 * сохранится в этом профиле.
 */
export function profileDefaultLayout(): DesktopLayout {
  const base = defaultLayout();
  // ⚠️ Убираем ВСЁ, что построено на данных человека: «часто открываете» и «чем занимался» —
  // из истории (она пока общая на профили), «дела» — это его личный список, и подсовывать
  // рабочие задачи в профиль «Отдых» так же неуместно, как рабочие сайты.
  const personal = new Set(['topsites', 'digest', 'tracking', 'tasks']);
  const items = base.items.filter((i) => !(i.kind === 'widget' && personal.has(i.widget ?? '')));
  // Взамен — нейтральный счётчик защиты: он считает вырезанные трекеры ЭТОГО сеанса, ничего не
  // помнит между запусками и в сеть не ходит. Пустой стол выглядел бы поломкой, а не чистотой.
  items.unshift({ id: 'w-shield', kind: 'widget', widget: 'shield', size: WIDGET_SIZES.small });
  return { ...base, items };
}

export function loadDesktop(): DesktopLayout {
  try {
    const raw = localStorage.getItem(layoutKey());
    // ⚠️ У НОВОГО профиля свой стартовый набор — беднее общего (см. profileDefaultLayout).
    if (!raw) return activeProfileId === 'default' ? defaultLayout() : profileDefaultLayout();
    const parsed = JSON.parse(raw) as Partial<DesktopLayout>;
    if (!Array.isArray(parsed.items)) return defaultLayout();
    // Терпимо к чужому/старому JSON: элементы без обязательных полей просто выкидываем, а не
    // роняем весь экран — раскладка это косметика, а не данные пользователя.
    const items = parsed.items.filter((i): i is DesktopItem =>
      !!i && typeof i.id === 'string' && typeof i.kind === 'string'
      && !!i.size && typeof i.size.w === 'number' && typeof i.size.h === 'number')
      // ⚠️ Размер чиним ПРИ ЧТЕНИИ, а не только в момент растягивания: минимумы появились позже
      // самой возможности тянуть за угол, и на дисках уже лежат виджеты, утянутые до 1×1 руками.
      // Без этого починка не дошла бы до тех, у кого проблема как раз и есть.
      .map((i) => ({ ...i, size: clampSize(i, i.size) }));
    const scale = scaleOf(parsed);
    // ⚠️ Колонки идут ЗА размером плиток: они одно решение (см. SCALE_PRESETS). Если на диске
    // осталось число из прежней ручки «плотность», раскладка один раз перекладывается под
    // пресет — иначе координаты жили бы в одной сетке, а рисовались в другой.
    const cols = clampCols(parsed.cols ?? SCALE_PRESETS[scale].cols);
    if (parsed.version === 2) {
      const layout: DesktopLayout = { version: 2, cols, scale, items };
      return cols === SCALE_PRESETS[scale].cols ? layout : setCols(layout, SCALE_PRESETS[scale].cols);
    }

    // ⚠️ ПЕРЕНОС со старого формата (хранился только порядок). Координаты берём из ТОЙ ЖЕ
    // последовательной укладки, которой этот стол и рисовался, — человек не должен заметить
    // смены формата: экран после обновления обязан выглядеть ровно так же, как до него.
    const { placed } = layoutItems(items, cols);
    return {
      version: 2, cols,
      items: placed.map((p) => ({ ...p.item, col: p.col, row: p.row })),
    };
  } catch {
    return defaultLayout();
  }
}

export function saveDesktop(layout: DesktopLayout): void {
  try {
    localStorage.setItem(layoutKey(), JSON.stringify(layout));
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

/**
 * Поставить элемент в клетку (col, row). Возвращает ПРЕЖНЮЮ раскладку, если так нельзя, —
 * тогда плитка на экране просто вернётся откуда взяли.
 *
 * ⚠️ Занятая клетка разбирается ровно двумя исходами, и оба человек может предсказать:
 *  • под плиткой ровно ОДИН элемент того же размера — меняются местами (иначе поменять две
 *    иконки местами было бы нечем: свободной клетки рядом может не быть вовсе);
 *  • во всех остальных случаях — отказ. Раздвигать соседей «как получится» здесь нельзя:
 *    ровно от самовольных переездов мы и уходили, переводя стол на координаты.
 */
export function moveItemTo(layout: DesktopLayout, id: string, col: number, row: number): DesktopLayout {
  const cols = clampCols(layout.cols);
  const item = layout.items.find((i) => i.id === id);
  if (!item) return layout;
  const w = Math.min(item.size.w, cols);
  const h = item.size.h;
  const c = Math.max(0, Math.min(cols - w, Math.round(col)));
  const r = Math.max(0, Math.round(row));
  if (c === item.col && r === item.row) return layout;

  // Кто стоит на целевых клетках. Считаем по ФАКТИЧЕСКОЙ раскладке, а не по сохранённым полям:
  // у только что добавленного элемента координат ещё нет, но место на экране он уже занимает.
  const placedNow = placeItems(layout.items, cols).placed;
  const hit = placedNow.filter((p) => p.item.id !== id
    && c < p.col + p.w && c + w > p.col && r < p.row + p.h && r + h > p.row);

  if (hit.length === 0) {
    return { ...layout, items: layout.items.map((i) => (i.id === id ? { ...i, col: c, row: r } : i)) };
  }
  const other = hit[0]!;
  if (hit.length > 1 || other.w !== w || other.h !== h) return layout;
  const mine = placedNow.find((p) => p.item.id === id);
  return {
    ...layout,
    items: layout.items.map((i) => {
      if (i.id === id) return { ...i, col: c, row: r };
      if (i.id === other.item.id) return { ...i, col: mine?.col ?? other.col, row: mine?.row ?? other.row };
      return i;
    }),
  };
}

/**
 * Сменить плотность сетки — ЕДИНСТВЕННЫЙ момент, когда расклад перестраивается не по воле
 * человека. Иначе никак: в сетке из пяти колонок нет клетки №7, и прежние координаты
 * недействительны все разом. Раскладываем последовательно по порядку чтения — то есть так же,
 * как выглядел экран до смены, насколько это вообще возможно в другой сетке.
 */
export function setCols(layout: DesktopLayout, cols: number): DesktopLayout {
  const next = clampCols(cols);
  if (next === clampCols(layout.cols)) return layout;
  const { placed } = layoutItems([...layout.items].sort(byRowCol), next);
  return { ...layout, cols: next, items: placed.map((p) => ({ ...p.item, col: p.col, row: p.row })) };
}

/** Сменить размер плиток. Число колонок едет вместе с ним — они одно решение, а не два. */
export function setScale(layout: DesktopLayout, scale: DesktopScale): DesktopLayout {
  return { ...setCols(layout, SCALE_PRESETS[scale].cols), scale };
}

/**
 * Изменить размер элемента. Иконки не растягиваются — у них смысл ровно одна клетка.
 * ⚠️ Растянутый виджет остаётся НА МЕСТЕ, а подвинется тот, на кого он наехал (priorityId в
 * normalize): человек тянет за угол конкретной плитки и ждёт, что двигается именно она.
 */
export function resizeItem(layout: DesktopLayout, id: string, size: CellSize): DesktopLayout {
  return normalize({
    ...layout,
    items: layout.items.map((i) => (i.id === id && i.kind === 'widget'
      ? { ...i, size: clampSize(i, size) }
      : i)),
  }, id);
}

/** Размер в допустимых пределах: не меньше минимума своего типа и не больше потолка сетки. */
export function clampSize(item: Pick<DesktopItem, 'kind' | 'widget'>, size: CellSize): CellSize {
  const min = minSizeFor(item);
  return {
    w: Math.max(min.w, Math.min(6, Math.round(size.w))),
    h: Math.max(min.h, Math.min(4, Math.round(size.h))),
  };
}

export function removeItem(layout: DesktopLayout, id: string): DesktopLayout {
  // Свой виджет с стола уходит, одностраничник остаётся в библиотеке — иначе после удаления
  // пришлось бы снова ждать модель.
  return { ...layout, items: layout.items.filter((i) => i.id !== id) };
}

export function addItem(layout: DesktopLayout, item: Omit<DesktopItem, 'id'>): DesktopLayout {
  const id = `${item.kind}-${Date.now().toString(36)}`;
  return { ...layout, items: [...layout.items, { ...item, id }] };
}

/** Уже стоит ли на столе это приложение/виджет — чтобы палитра не предлагала дубль. */
export function hasItem(layout: DesktopLayout, kind: DesktopItemKind, key: string): boolean {
  // Свои одностраничники все с ключом gen — дубль здесь как раз норма (фоторамка и таймер).
  if (kind === 'widget' && key === 'gen') return false;
  return layout.items.some((i) => i.kind === kind && (i.appId === key || i.widget === key));
}
