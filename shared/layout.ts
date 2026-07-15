// Горизонтальные зазоры chrome-оболочки — общие для main (bounds AI-панели/вкладок в
// electron/TabManager.ts, electron/AiPanelManager.ts) и renderer (flex-раскладка в App.tsx,
// внутренний padding aipanel.tsx). Раньше эти же числа лежали двумя независимыми литералами
// по разные стороны IPC-границы — здесь один источник для значения (синхрон самих bounds
// всё равно остаётся ручным через resizeAiPanel/setContentBounds, эта константа только
// избавляет от рассинхрона ЧИСЕЛ).
export const SHELL_MARGIN = 12; // остров (сайдбар/AI-панель) — край окна
export const ISLAND_GAP = 16;   // остров — соседний остров (split↔split, split↔AI-панель)
