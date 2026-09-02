// Окна и перетаскивание вкладок, поиск по странице, правила, split, порядок
//
// Часть контракта IPC, вынесенная из main.ts (см. electron/ipc/deps.ts — почему нарезано
// непрерывными кусками, а не по доменам). Тела обработчиков перенесены дословно.
import { IPC } from '../../shared/ipc';
import type { DragCard, RuleParseOutcome, SmartFindResult, SplitSwapHint } from '../../shared/ipc';
import { endTabDrag, setSwapCursor, setSwapHint, setSwapThumb, startTabDrag } from '../DropZoneManager';
import { parsePhraseToRule } from '../RuleParser';
import { highlightCandidates, pickFragmentByMeaning } from '../SmartFind';
import { broadcastToChrome, contextFromSender } from '../WindowRegistry';
import type { WindowRole } from '../WindowRegistry';
import { ipcMain } from 'electron';
import type { IpcDeps } from './deps';

// И для смыслового Ctrl+F (см. SmartFind.ts). Второй Enter, пока идёт первый поиск, не должен
// вставать в очередь генерации: человек получил бы ответ на позапрошлый вопрос.
let smartFindBusy = false;

export function registerWindowsIpc(d: IpcDeps): void {
  const { createWindow, moveTabToExistingWindow, moveTabToNewWindow, rules, tabsOf, winOf } = d;

  // ⚠️ Три действия окна вместо прежней покраски полосы. Кнопки рисует наш хром (frame: false),
  // поэтому нажатия обязаны доехать сюда — у окна без рамки ОС их не обрабатывает.
  ipcMain.handle(IPC.WINDOW_MINIMIZE, (e) => { winOf(e)?.minimize(); });
  ipcMain.handle(IPC.WINDOW_TOGGLE_MAXIMIZE, (e) => {
    const w = winOf(e);
    if (!w) return;
    // Разворот и возврат — одна кнопка: у неё меняется только глиф.
    if (w.isMaximized()) w.unmaximize(); else w.maximize();
  });
  ipcMain.handle(IPC.WINDOW_CLOSE, (e) => { winOf(e)?.close(); });
  // Роль окна — чром спрашивает её один раз при монтировании и по ней решает, что рисовать.
  // Отправитель вне реестра (такого быть не должно) трактуем как лёгкое окно: спрятать лишнее
  // безопаснее, чем показать кнопку, которая полезет в чужие вкладки.
  ipcMain.handle(IPC.WINDOW_GET_ROLE, (e): WindowRole => contextFromSender(e.sender)?.role ?? 'light');
  // Новое окно — всегда лёгкое: полное ровно одно, оно владеет сессией.
  ipcMain.handle(IPC.WINDOW_OPEN, () => { createWindow('light'); });
  // Перенос вкладки в новое окно. Порядок важен: сначала СНИМАЕМ вкладку со старого окна и только
  // потом создаём новое. Наоборот — и при отказе снять (спящая, split, закреплённая) на экране
  // оставалось бы пустое окно, которого никто не просил.
  // Перетаскивание вкладки: зоны поверх страницы + слежение за курсором (см. DropZoneManager.ts).
  ipcMain.handle(IPC.TAB_DRAG_START, (e, card: DragCard | null) => { const w = winOf(e); if (w) startTabDrag(w, card); });
  ipcMain.handle(IPC.TAB_DRAG_END, (e) => { const w = winOf(e); return w ? endTabDrag(w) : { zone: null }; });
  ipcMain.handle(IPC.WINDOW_MOVE_TAB, (e, tabId: string) => {
    const from = tabsOf(e);
    return from ? moveTabToNewWindow(from, tabId) : false;
  });
  ipcMain.handle(IPC.WINDOW_MOVE_TAB_TO, (e, tabId: string, windowId: number) => {
    const from = tabsOf(e);
    return from ? moveTabToExistingWindow(from, tabId, windowId) : false;
  });
  ipcMain.handle(IPC.FIND_START, (e, q: string, fwd: boolean) => tabsOf(e)?.findInPage(q, fwd));
  ipcMain.handle(IPC.FIND_NEXT,  (e, fwd: boolean)            => tabsOf(e)?.findNext(fwd));
  ipcMain.handle(IPC.FIND_STOP,  (e)                            => tabsOf(e)?.stopFind());
  // Смысловой Ctrl+F: модель выбирает НОМЕР фрагмента страницы, цитату берём из своего массива и
  // подсвечиваем штатным findInPage (см. SmartFind.ts — там же, почему не «пусть модель процитирует»).
  // ⚠️ Гейта isModelWarm() здесь нет намеренно: человек переключил режим и нажал Enter — это явное
  // действие, и ждать загрузку модели оно вправе (в отличие от подсказок при наборе).
  ipcMain.handle(IPC.FIND_SMART, async (e, query: string): Promise<SmartFindResult> => {
    const tabs = tabsOf(e);
    const wc = tabs?.getActiveWebContents() ?? null;
    if (!tabs || !wc) return { ok: false, reason: 'no-text' };
    if (smartFindBusy) return { ok: false, reason: 'busy' };
    smartFindBusy = true;
    try {
      const pick = await pickFragmentByMeaning(wc, query);
      if (!pick.ok) {
        return { ok: false, reason: pick.reason === 'model-error' ? 'no-model' : pick.reason };
      }
      // ⚠️ Оставляем только те цитаты, которые реально удалось подсветить: показывать в счётчике
      // «1 / 3», где до двух из трёх не доехать, — обман. Подсветка первой заодно и прокручивает
      // к ней страницу, поэтому подбираем по порядку и первую же удачную оставляем показанной.
      const shown: string[] = [];
      let firstMatches = 0;
      for (const quote of pick.quotes) {
        const matches = await tabs.findQuoteInPage(highlightCandidates(quote));
        if (matches === 0) continue;
        shown.push(quote);
        if (shown.length === 1) firstMatches = matches;
      }
      if (shown.length === 0) return { ok: false, reason: 'not-found' };
      // Возвращаем подсветку на первую цитату: цикл выше оставил её на последней проверенной.
      if (shown.length > 1) await tabs.findQuoteInPage(highlightCandidates(shown[0]!));
      return { ok: true, quotes: shown, matches: firstMatches };
    } catch (err) {
      console.warn('[smart-find] ошибка:', err);
      return { ok: false, reason: 'no-model' };
    } finally {
      smartFindBusy = false;
    }
  });

  // ── Правила-автоматизации ──────────────────────────────────────────────────
  // ⚠️ Разбор фразы — ЕДИНСТВЕННЫЙ вызов модели во всей фиче, и он всегда явный: человек написал
  // фразу и нажал кнопку. Поэтому гейта isModelWarm() тут нет — ждать загрузку такое действие
  // вправе. Сохранения он не делает: черновик возвращается в UI на утверждение.
  let ruleParseBusy = false;
  ipcMain.handle(IPC.RULES_PARSE, async (_e, phrase: string): Promise<RuleParseOutcome> => {
    if (ruleParseBusy) return { ok: false, reason: 'model-error', error: 'Уже разбираю другую фразу' };
    ruleParseBusy = true;
    try {
      return await parsePhraseToRule(String(phrase ?? ''));
    } catch (err) {
      console.warn('[rules] разбор упал:', err);
      return { ok: false, reason: 'model-error' };
    } finally {
      ruleParseBusy = false;
    }
  });
  // Сохранение утверждённого черновика. Валидация повторяется ВНУТРИ хранилища: сюда приходит
  // объект из renderer, а он в общем случае — просто аргумент IPC, а не «наш» черновик.
  ipcMain.handle(IPC.RULES_ADD, (_e, draft: unknown) => {
    const saved = rules.add(draft);
    if (saved) broadcastToChrome(IPC.RULES_CHANGED, rules.list());
    return saved;
  });
  ipcMain.handle(IPC.RULES_LIST, () => rules.list());
  ipcMain.handle(IPC.RULES_SET_ENABLED, (_e, id: string, enabled: boolean) => {
    const ok = rules.setEnabled(id, enabled);
    if (ok) broadcastToChrome(IPC.RULES_CHANGED, rules.list());
    return ok;
  });
  ipcMain.handle(IPC.RULES_REMOVE, (_e, id: string) => {
    const ok = rules.remove(id);
    if (ok) broadcastToChrome(IPC.RULES_CHANGED, rules.list());
    return ok;
  });

  // Показать конкретную цитату из уже полученного ответа (стрелки в панели листают найденные
  // фрагменты). Состояния в main нет намеренно: список цитат держит панель, сюда приходит текст —
  // так листание не может разъехаться с тем, что человек видит в счётчике.
  ipcMain.handle(IPC.FIND_SMART_SHOW, async (e, quote: string): Promise<number> => {
    const tabs = tabsOf(e);
    if (!tabs || typeof quote !== 'string' || !quote.trim()) return 0;
    return tabs.findQuoteInPage(highlightCandidates(quote));
  });

  ipcMain.handle(IPC.TAB_PIN_TOGGLE, (e, id: string) => tabsOf(e)?.togglePin(id));
  ipcMain.handle(IPC.TAB_SET_MUTED, (e, id: string, muted: boolean) => tabsOf(e)?.setTabMuted(id, muted));

  // Split View
  ipcMain.handle(IPC.TAB_ENTER_SPLIT, (e, tabId: string, side?: 'left' | 'right') => tabsOf(e)?.enterSplit(tabId, side));
  ipcMain.handle(IPC.TAB_REPLACE_PANEL, (e, panelId: string, newId: string) => tabsOf(e)?.replaceSplitPanel(panelId, newId));
  ipcMain.handle(IPC.TAB_EXIT_SPLIT,  (e, tabId: string, keepId?: string) => tabsOf(e)?.exitSplit(tabId, keepId));
  ipcMain.handle(IPC.TAB_SPLIT_FOCUS, (e, side: 'left' | 'right') => tabsOf(e)?.focusSplitPanel(side));
  ipcMain.handle(IPC.TAB_SPLIT_RATIO, (e, ratio: number)           => tabsOf(e)?.setSplitRatio(ratio));
  ipcMain.handle(IPC.TAB_SPLIT_SWAP,  (e, tabId: string)           => tabsOf(e)?.swapSplitPanels(tabId));
  // Подсветка панели-цели при перетаскивании половины за шапку. Зону считает сам чром (жест держит
  // указатель через setPointerCapture, см. App.tsx) — от main нужна только картинка поверх страницы.
  // Одно сообщение на две работы: оверлей рисует подсветку и карточку, TabManager перестраивает
  // раскладку панелей (несомая уходит из неё, вторая показывает исход). Специально одно, а не два:
  // renderer гарантированно шлёт его в конце жеста с null, каким бы исход ни был, — значит и
  // возврат раскладки не может «не позваться».
  ipcMain.handle(IPC.SPLIT_SWAP_HINT, (e, hint: SplitSwapHint | null) => {
    const w = winOf(e);
    if (!w) return;
    setSwapHint(w, hint);
    tabsOf(e)?.applyPanelDragLayout(hint);
  });
  ipcMain.on(IPC.SPLIT_DRAG_CURSOR, (e, pos: { x: number; y: number } | null) => { const w = winOf(e); if (w) setSwapCursor(w, pos); });
  ipcMain.handle(IPC.SPLIT_CAPTURE_PANE, (e, tabId: string, width: number, maxHeight: number) => tabsOf(e)?.capturePaneThumb(tabId, width, maxHeight) ?? null);
  ipcMain.on(IPC.SPLIT_DRAG_THUMB, (e, thumb: string | null) => { const w = winOf(e); if (w) setSwapThumb(w, thumb); });

  ipcMain.handle(IPC.TAB_REORDER,
    (e, section: 'normal' | 'pinned', orderedIds: string[]) =>
      tabsOf(e)?.reorderTabs(section, orderedIds),
  );

  ipcMain.handle(IPC.TAB_MOVE_SECTION,
    (e, tabId: string, targetSection: 'pinned' | 'normal', targetIndex: number) =>
      tabsOf(e)?.moveTabSection(tabId, targetSection, targetIndex),
  );
}
