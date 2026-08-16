// Вкладки: синхронизация состояния, тема, навигация, смысловой поиск по вкладкам
//
// Часть контракта IPC, вынесенная из main.ts (см. electron/ipc/deps.ts — почему нарезано
// непрерывными кусками, а не по доменам). Тела обработчиков перенесены дословно.
import { IPC, THEME_PALETTE_IDS } from '../../shared/ipc';
import type { PageChangesResult, SemanticSearchResult, SmartTabHit, SpecialTabKind, ThemeMode, ThemePaletteId, ThemePrefs } from '../../shared/ipc';
import { getPageChanges } from '../PageChanges';
import { findRelatedPages } from '../RelatedHistory';
import { searchStuff } from '../StuffSearch';
import { searchTabsByMeaning } from '../TabSearch';
import { isModelWarm } from '../TranslationService';
import { allContexts, broadcastToChrome, contextFromSender } from '../WindowRegistry';
import { ipcMain } from 'electron';
import type { IpcDeps } from './deps';

// Идёт ли прямо сейчас смысловой поиск вкладки (см. TABS_SEARCH_SMART) — один за раз на всё
// приложение, как и сама модель.
let smartTabSearchBusy = false;
// То же для подсказки «вы это уже читали»: один запрос за раз на приложение.
let relatedBusy = false;

export function registerTabsIpc(d: IpcDeps): void {
  const { bookmarks, broadcastChromeTheme, currentThemePrefs, downloads, history, settings, tabsOf } = d;


  ipcMain.handle(IPC.SYNC_GET, (e) => ({
    tabs:  tabsOf(e)?.snapshot()              ?? [],
    nodes: tabsOf(e)?.sidebarNodesSnapshot() ?? [],
    hasOrganizeSnapshot: tabsOf(e)?.hasOrganizeSnapshot() ?? false,
    hasRenameSnapshot: tabsOf(e)?.hasRenameSnapshot() ?? false,
  }));
  ipcMain.handle(IPC.TABS_GET_ALL, (e) => tabsOf(e)?.snapshot() ?? []);
  // Тема chrome (light/dark + инкогнито + палитра) от главного рендерера → раскидываем во все наши вью.
  ipcMain.handle(IPC.CHROME_THEME_SET, (_e, dark: boolean, incognito: boolean, palette: ThemePaletteId) => {
    d.setChromeTheme({
      dark: !!dark,
      incognito: !!incognito,
      // Пришло из рендерера — значит недоверенное; промах гасим базовой палитрой, а не пишем
      // в атрибут произвольную строку.
      palette: (THEME_PALETTE_IDS as readonly string[]).includes(palette) ? palette : 'charcoal',
    });
    broadcastChromeTheme();
  });
  // Выбор темы: читает настройки, пишет настройки, рассылает всем окнам. Применяет по-прежнему
  // рендерер у себя (см. App.tsx) — main только владеет значением и системным признаком.
  ipcMain.handle(IPC.THEME_GET, (): ThemePrefs => currentThemePrefs());
  ipcMain.handle(IPC.THEME_SET, (_e, mode: ThemeMode, palette: ThemePaletteId) => {
    settings.setTheme(mode, palette);
    broadcastToChrome(IPC.THEME_CHANGED, currentThemePrefs());
  });
  ipcMain.handle(IPC.TAB_CREATE, (e, url?: string) => tabsOf(e)?.createTab(url));
  ipcMain.handle(IPC.TAB_CREATE_INCOGNITO, (e, url?: string) => tabsOf(e)?.createTab(url, false, false, true));
  ipcMain.handle(IPC.TAB_CREATE_SPECIAL, (e, kind: SpecialTabKind, section?: string) => tabsOf(e)?.createSpecialTab(kind, section));
  ipcMain.handle(IPC.TAB_CLOSE, (e, id: string) => tabsOf(e)?.closeTab(id));
  ipcMain.handle(IPC.TAB_ACTIVATE, (e, id: string) => tabsOf(e)?.activate(id));
  ipcMain.handle(IPC.TAB_NAVIGATE, (e, id: string, input: string) => tabsOf(e)?.navigate(id, input));
  ipcMain.handle(IPC.TAB_GO_BACK, (e, id: string) => tabsOf(e)?.goBack(id));
  ipcMain.handle(IPC.TAB_GO_FORWARD, (e, id: string) => tabsOf(e)?.goForward(id));
  ipcMain.handle(IPC.TAB_RELOAD, (e, id: string) => tabsOf(e)?.reload(id));
  // Поиск вкладки по смыслу (см. TabSearch.ts). ⚠️ ОДИН запрос за раз: очередь генерации в
  // проекте общая и FIFO (withQwenQueue), а человек в омнибоксе печатает быстрее, чем модель
  // отвечает. Без этого гварда каждая буква превращалась бы в отдельный прогон, и они выстроились
  // бы в хвост, заняв модель на десятки секунд ради подсказки, которая давно устарела.
  ipcMain.handle(IPC.TABS_SEARCH_SMART, async (e, query: string): Promise<SmartTabHit[]> => {
    const from = contextFromSender(e.sender);
    // ⚠️ Только на ТЁПЛОЙ модели. Замерено: холодная загрузка 9B — 31 секунда и ~6 ГБ VRAM.
    // Человек, печатающий фразу в омнибоксе, этого не заказывал; подсказка не стоит того, чтобы
    // поднимать модель. Пока она холодная, фича просто молчит — а после первого явного обращения
    // к AI (перевод, панель, правка текста) начинает работать сама собой.
    if (!from || smartTabSearchBusy || !isModelWarm()) return [];
    smartTabSearchBusy = true;
    try {
      // ⚠️ Кандидаты — со ВСЕХ окон (AI-IDEAS.md №8). Своё окно идёт первым: при равной
      // уверенности модели человеку ближе то, что у него перед глазами, а порядок списка —
      // единственное, чем мы можем это выразить.
      const own = allContexts().filter((c) => c.win.id === from.win.id);
      const others = allContexts().filter((c) => c.win.id !== from.win.id);
      const candidates = [...own, ...others].flatMap((ctx) =>
        ctx.tabs.snapshot().map((tab) => ({ tab, windowId: ctx.win.id })),
      );
      const picked = await searchTabsByMeaning(query, candidates);
      return picked.map((c) => ({
        tabId: c.tab.id,
        windowId: c.windowId,
        title: c.tab.title,
        url: c.tab.url,
        // Считаем ЗДЕСЬ: «в другом окне» — факт про спрашивающего, и renderer своего id не знает.
        otherWindow: c.windowId !== from.win.id,
      }));
    } catch (err) {
      console.warn('[tab-search] ошибка:', err);
      return [];
    } finally {
      smartTabSearchBusy = false;
    }
  });
  // Переход к вкладке в ДРУГОМ окне: поднимаем то окно и делаем вкладку активной в нём.
  // ⚠️ Окно ищем в реестре по id, а не доверяем присланному числу как индексу: окно могли
  // закрыть, пока человек читал подсказку.
  ipcMain.handle(IPC.TAB_ACTIVATE_IN_WINDOW, (_e, windowId: number, tabId: string) => {
    const ctx = allContexts().find((c) => c.win.id === windowId);
    if (!ctx || ctx.win.isDestroyed()) return;
    ctx.tabs.activate(tabId);
    if (ctx.win.isMinimized()) ctx.win.restore();
    ctx.win.focus();
  });
  // «Вы это уже читали» — связанное из своей истории для АКТИВНОЙ вкладки (см. RelatedHistory.ts).
  // ⚠️ Адрес и заголовок берём из менеджера вкладок окна-отправителя, а не из аргументов: рендерер
  // мог отстать от навигации, и подсказка тогда относилась бы к предыдущей странице.
  ipcMain.handle(IPC.HISTORY_RELATED, async (e): Promise<SemanticSearchResult[]> => {
    const tabs = tabsOf(e);
    const active = tabs?.snapshot().find((t) => t.isActive && !t.isHub);
    if (!active?.url || relatedBusy) return [];
    relatedBusy = true;
    try {
      return await findRelatedPages(history, active.url, active.title || '');
    } catch (err) {
      console.warn('[related] ошибка:', err);
      return [];
    } finally {
      relatedBusy = false;
    }
  });
  // «Что изменилось с прошлого раза» (AI-IDEAS.md №7, см. PageChanges.ts) — для АКТИВНОЙ вкладки.
  // ⚠️ Адрес и живая вью берутся из менеджера вкладок окна-отправителя, а не из аргументов: то же
  // правило, что у «вы это уже читали» — рендерер мог отстать от навигации.
  // ⚠️ Приватную вкладку не трогаем: её визитов нет в истории, сравнивать не с чем по построению,
  // а лезть в неё за текстом страницы тем более незачем.
  ipcMain.handle(IPC.PAGE_CHANGES_GET, async (e): Promise<PageChangesResult> => {
    const tabs = tabsOf(e);
    const active = tabs?.snapshot().find((t) => t.isActive && !t.isHub);
    if (!tabs || !active?.url || tabs.isIncognito(active.id)) return { changed: false };
    return getPageChanges(history, active.url, tabs.getActiveWebContents());
  });
  // «Куда я это дел» (AI-IDEAS.md №4) — один поиск по истории, закладкам и загрузкам.
  // Явное действие человека (Enter), поэтому без гейта тёплой модели и пользовательской полосой.
  ipcMain.handle(IPC.STUFF_SEARCH, (_e, query: string) => searchStuff(history, bookmarks, downloads, query));

}
