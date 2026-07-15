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
