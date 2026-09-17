// Горизонтальные зазоры chrome-оболочки — общие для main (bounds AI-панели/вкладок в
// electron/TabManager.ts, electron/AiPanelManager.ts) и renderer (flex-раскладка в App.tsx,
// внутренний padding aipanel.tsx). Раньше эти же числа лежали двумя независимыми литералами
// по разные стороны IPC-границы — здесь один источник для значения (синхрон самих bounds
// всё равно остаётся ручным через resizeAiPanel/setContentBounds, эта константа только
// избавляет от рассинхрона ЧИСЕЛ).
export const SHELL_MARGIN = 12; // остров (сайдбар/AI-панель) — край окна
export const ISLAND_GAP = 10;   // остров — соседний остров (split↔split, split↔AI-панель)

// Полоса заголовка (favicon+title+×) над каждой split-панелью — вырезается сверху из bounds
// контентной WebContentsView (TabManager.ts: y += SPLIT_HEADER_HEIGHT, height -= им же) и
// рисуется чром-DOM в освободившейся зоне (App.tsx). Тот же приём, что и с самим контентом:
// React рисует дырку, main кладёт вьюху — просто дырка теперь не на всю высоту острова.
export const SPLIT_HEADER_HEIGHT = 36;

// ⚠️ Отступ страницы от краёв split-панели — и он же ответ на «почему у сайта скруглены верхние
// углы, хотя над ним отдельная шапка».
//
// Electron даёт вьюхе ОДИН радиус на все четыре угла (`View.setBorderRadius(radius: number)`,
// per-corner в API нет), а радиус острова — 20px. В сплите вьюха начинается под шапкой, поэтому
// её верхние скругления оказывались посреди панели: под прямой линией шапки — два жирных выреза,
// сквозь которые видно подложку. Прямоугольный верх при скруглённом низе нативной вьюхе задать
// нечем, а обрезать её DOM-ом нельзя — она лежит ПОВЕРХ React-слоя.
//
// Поэтому страница в сплите — не «продолжение острова», а отдельная карточка ВНУТРИ него: отступ
// со всех сторон, свой радиус (концентричный: 20 − 6 = 14). Скругления при этом честные — все
// четыре, как у любой карточки, — а вырезов нет вовсе: их место занял ровный кант панели.
// Одиночную вкладку это не касается: там шапки нет, и остров сам себе страница.
export const SPLIT_PANE_INSET = 6;

// Радиус той самой карточки — концентричный острову (--radius-island 20 минус кант 6). Общий,
// потому что скругление задают ОБЕ стороны: main — самой вьюхе (setBorderRadius), renderer —
// канту вокруг неё (box-shadow в App.tsx). Разъедутся числа — кант поедет по кривой мимо страницы.
export const SPLIT_PANE_RADIUS = 20 - SPLIT_PANE_INSET;

// Пределы доли левой панели. Живут здесь, потому что тем же зажимом пользуется и восстановление
// сессии: ratio приходит ИЗ ФАЙЛА, то есть это недоверенное число (см. shared/sessionTree.ts,
// там свои копии — их менять нельзя без правки здесь).
export const SPLIT_RATIO_MIN = 0.2;
export const SPLIT_RATIO_MAX = 0.8;

/** Прямоугольник в координатах окна — та же форма, что ContentBounds в контракте. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Деление области контента на два острова. Floor — один: и карточка страницы (splitPaneBounds),
 * и цель дропа (splitIslandRects) обязаны видеть одну и ту же вертикаль разделителя.
 */
function splitHalves(content: Rect, splitRatio: number): { leftX: number; leftW: number; rightX: number; rightW: number } {
  const leftW = Math.floor((content.width - ISLAND_GAP) * splitRatio);
  const rightW = content.width - leftW - ISLAND_GAP;
  return {
    leftX: content.x,
    leftW,
    rightX: content.x + leftW + ISLAND_GAP,
    rightW,
  };
}

/**
 * Прямоугольник СТРАНИЦЫ одной панели сплита: половина области контента минус полоса заголовка
 * сверху и минус кант карточки со всех сторон (разбор канта — у SPLIT_PANE_INSET выше).
 *
 * ⚠️ Формула ОДНА на всех потребителей (getTabViewBounds, repositionViews, замер поповеров):
 * раньше она стояла двумя копиями и при любой правке разъезжалась — панель уезжала на несколько
 * пикселей мимо своего канта, и это видно глазом.
 *
 * ⚠️ Ширина и высота зажаты нулём снизу. При узком окне или неожиданно большом отступе разность
 * уходит в минус, а отрицательные размеры вьюхи — это не «маленькая панель», а мусор в раскладке.
 */
export function splitPaneBounds(content: Rect, side: 'left' | 'right', splitRatio: number): Rect {
  const h = splitHalves(content, splitRatio);
  const panelX = side === 'left' ? h.leftX : h.rightX;
  const panelW = side === 'left' ? h.leftW : h.rightW;
  return {
    x: panelX + SPLIT_PANE_INSET,
    y: content.y + SPLIT_HEADER_HEIGHT + SPLIT_PANE_INSET,
    width: Math.max(0, panelW - SPLIT_PANE_INSET * 2),
    height: Math.max(0, content.height - SPLIT_HEADER_HEIGHT - SPLIT_PANE_INSET * 2),
  };
}

/**
 * Прямоугольники ОСТРОВОВ пары в оконных координатах. В них входит шапка и кант.
 *
 * ⚠️ Это не рамка страницы (splitPaneBounds). Зоны дропа целятся в остров целиком: человек видит
 * «панель», а не карточку внутри неё. Подсветка обязана совпасть с тем, что на экране.
 */
export function splitIslandRects(content: Rect, splitRatio: number): { left: Rect; right: Rect } {
  const h = splitHalves(content, splitRatio);
  return {
    left:  { x: h.leftX,  y: content.y, width: h.leftW,  height: content.height },
    right: { x: h.rightX, y: content.y, width: h.rightW, height: content.height },
  };
}

/**
 * Откуда панель въезжает в свой слот. Правило одно на вход в сплит и на замену панели.
 *
 * ⚠️ Свободные края несимметричны. Справа — край окна, по горизонтали ничего не закрывает.
 * Слева сайдбар, а нативная вью лежит ПОВЕРХ React: выезд слева накрыл бы список вкладок.
 * Поэтому левая панель поднимается снизу — нижний край окна свободен у обеих сторон.
 */
export function splitPanelEntryFrom(
  side: 'left' | 'right',
  slot: Rect,
  content: Rect,
): { fromX: number; fromY: number } {
  return side === 'right'
    ? { fromX: content.x + content.width, fromY: slot.y }
    : { fromX: slot.x, fromY: content.y + content.height };
}

/**
 * Кубическое ease-out проезда панели — та же кривая, что `--ease-out` в токенах.
 * Зажим [0, 1]: кадр после конца жеста не должен уехать за слот.
 */
export function splitSlideEase(elapsedMs: number, durMs: number): number {
  const t = Math.min(1, Math.max(0, elapsedMs / durMs));
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Кадр проезда: положение интерполируется, размер сразу конечный.
 *
 * ⚠️ Смена размера заставляет страницу пересчитывать вёрстку на каждом кадре (два тяжёлых
 * сайта разом — рывки). Сдвиг для страницы бесплатен. Поэтому панель не «разворачивается»,
 * а приезжает уже своего размера.
 */
export function splitSlidePosition(fromX: number, fromY: number, to: Rect, ease: number): Rect {
  return {
    x: Math.round(fromX + (to.x - fromX) * ease),
    y: Math.round(fromY + (to.y - fromY) * ease),
    width: Math.round(to.width),
    height: Math.round(to.height),
  };
}

/** Зажим доли левой панели — и для жеста мышью, и для числа, пришедшего из session.json. */
export function clampSplitRatio(ratio: number): number {
  return Math.max(SPLIT_RATIO_MIN, Math.min(SPLIT_RATIO_MAX, ratio));
}
