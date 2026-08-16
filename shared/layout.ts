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
  const leftWidth = Math.floor((content.width - ISLAND_GAP) * splitRatio);
  const panelX = side === 'left' ? content.x : content.x + leftWidth + ISLAND_GAP;
  const panelW = side === 'left' ? leftWidth : content.width - leftWidth - ISLAND_GAP;
  return {
    x: panelX + SPLIT_PANE_INSET,
    y: content.y + SPLIT_HEADER_HEIGHT + SPLIT_PANE_INSET,
    width: Math.max(0, panelW - SPLIT_PANE_INSET * 2),
    height: Math.max(0, content.height - SPLIT_HEADER_HEIGHT - SPLIT_PANE_INSET * 2),
  };
}

/** Зажим доли левой панели — и для жеста мышью, и для числа, пришедшего из session.json. */
export function clampSplitRatio(ratio: number): number {
  return Math.max(SPLIT_RATIO_MIN, Math.min(SPLIT_RATIO_MAX, ratio));
}
