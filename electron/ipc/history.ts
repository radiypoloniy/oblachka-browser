// История, бэкфилл содержимого, закладки, импорт из других браузеров
//
// Часть контракта IPC, вынесенная из main.ts (см. electron/ipc/deps.ts — почему нарезано
// непрерывными кусками, а не по доменам). Тела обработчиков перенесены дословно.
import { IPC } from '../../shared/ipc';
import type { BackfillProgress, BookmarkFolderProposal, HistoryClearPeriod, ImportDataType } from '../../shared/ipc';
import { suggestBookmarkFolders } from '../BookmarkOrganizer';
import { cancelContentBackfill, setContentBackfillProgressListener, startContentBackfill } from '../HistoryContentBackfill';
import { searchHistorySmart } from '../HistorySearch';
import { fetchSearchSuggestions } from '../SearchSuggestFetcher';
import { broadcastToChrome, contextFromSender } from '../WindowRegistry';
import { ipcMain } from 'electron';
import type { IpcDeps } from './deps';

export function registerHistoryIpc(d: IpcDeps): void {
  const { bookmarkImporters, bookmarks, history, importManager, settings, showBookmarkMenu, winOf } = d;

  // не подписка: панель настроек открывают редко, push-канал ради этого избыточен.
  ipcMain.handle(IPC.HISTORY_CONTENT_COVERAGE, () => ({
    withContent: history.countHistoryWithContent(),
    total: history.countAll(),
  }));

  // Рискованный бэкфилл полного текста (electron/HistoryContentBackfill.ts) — тихое переоткрытие
  // старых URL, отдельная секция в Settings.tsx с явным предупреждением. Нужен win (создаёт
  // скрытые WebContentsView) — если окна уже нет, просто no-op.
  let lastContentBackfillProgress: BackfillProgress = { processed: 0, total: 0, running: false, cancelled: false };
  setContentBackfillProgressListener((p) => {
    lastContentBackfillProgress = p;
    broadcastToChrome(IPC.HISTORY_CONTENT_BACKFILL_PROGRESS, p);
  });
  ipcMain.on(IPC.HISTORY_CONTENT_BACKFILL_START, (e) => {
    const w = winOf(e); if (w) void startContentBackfill(history, w); });
  ipcMain.on(IPC.HISTORY_CONTENT_BACKFILL_CANCEL, () => { cancelContentBackfill(); });
  ipcMain.handle(IPC.HISTORY_CONTENT_BACKFILL_STATUS, () => lastContentBackfillProgress);

  // Заход 10: живые suggest-подсказки — движок берём из settings (тот же источник истины, что
  // капсула выбора поисковика), а не отдельным параметром от renderer — не может разойтись.
  ipcMain.handle(IPC.SEARCH_SUGGEST, (_e, query: string) => fetchSearchSuggestions(query, settings.getSearchEngine()));

  // История посещений
  ipcMain.handle(IPC.HISTORY_GET,    (_e, limit?: number)           => history.getRecent(limit));
  ipcMain.handle(IPC.HISTORY_SEARCH, (_e, query: string)            => history.search(query));
  ipcMain.handle(IPC.HISTORY_DELETE, (_e, id: number)               => history.deleteEntry(id));
  ipcMain.handle(IPC.HISTORY_CLEAR,  (_e, period: HistoryClearPeriod) => history.clearHistory(period));
  // Умный поиск — Qwen-реранк, только по явному Enter (см. HistorySearch.ts::searchHistorySmart).
  ipcMain.handle(IPC.HISTORY_SEARCH_SMART, (_e, query: string) => searchHistorySmart(history, query));

  // Закладки — пуш BOOKMARK_CHANGED во все окна после каждой успешной мутации, тот же
  // приём, что уже используется для PASSWORDS_CHANGED (инлайн, не через конструктор-колбэк).
  ipcMain.handle(IPC.BOOKMARK_ADD, (_e, url: string, title: string) => {
    const entry = bookmarks.add(url, title);
    if (entry) broadcastToChrome(IPC.BOOKMARK_CHANGED);
    return entry;
  });
  ipcMain.handle(IPC.BOOKMARK_REMOVE, (_e, id: number) => {
    bookmarks.remove(id);
    broadcastToChrome(IPC.BOOKMARK_CHANGED);
  });
  ipcMain.handle(IPC.BOOKMARK_REMOVE_BY_URL, (_e, url: string) => {
    bookmarks.removeByUrl(url);
    broadcastToChrome(IPC.BOOKMARK_CHANGED);
  });
  ipcMain.handle(IPC.BOOKMARK_LIST, () => bookmarks.list());
  ipcMain.handle(IPC.BOOKMARK_LIST_TREE, () => bookmarks.listTree());
  ipcMain.handle(IPC.BOOKMARK_SHOW_MENU, (e) => {
    const ctx = contextFromSender(e.sender);
    if (ctx) void showBookmarkMenu(ctx.win, ctx.tabs);
  });
  // Правки дерева. broadcastToChrome, а не ответ вызывающему: закладки — общее состояние
  // приложения, файл на диске один, а копия дерева своя у КАЖДОГО окна (см. WindowRegistry).
  ipcMain.handle(IPC.BOOKMARK_CREATE_FOLDER, (_e, title: string, parentId: number | null) => {
    const entry = bookmarks.createFolder(title, parentId);
    if (entry) broadcastToChrome(IPC.BOOKMARK_CHANGED);
    return entry;
  });
  ipcMain.handle(IPC.BOOKMARK_RENAME, (_e, id: number, title: string) => {
    const ok = bookmarks.rename(id, title);
    if (ok) broadcastToChrome(IPC.BOOKMARK_CHANGED);
    return ok;
  });
  ipcMain.handle(IPC.BOOKMARK_MOVE, (_e, id: number, parentId: number | null) => {
    const ok = bookmarks.move(id, parentId);
    if (ok) broadcastToChrome(IPC.BOOKMARK_CHANGED);
    return ok;
  });
  // Умная раскладка. ⚠️ SUGGEST ничего не меняет — только считает; APPLY выполняет уже
  // одобренное человеком. Разделение не формальность: между вызовами стоит его согласие, и
  // склеить их в один канал значило бы разложить чужие закладки без спроса.
  ipcMain.handle(IPC.BOOKMARK_ORGANIZE_SUGGEST, () => suggestBookmarkFolders(bookmarks.listTree()));
  ipcMain.handle(IPC.BOOKMARK_ORGANIZE_APPLY, (_e, proposals: BookmarkFolderProposal[]) => {
    let moved = 0;
    for (const p of proposals) {
      const folder = bookmarks.createFolder(p.label, null);
      if (!folder) continue;
      for (const id of p.ids) if (bookmarks.move(id, folder.id)) moved++;
    }
    if (moved > 0) broadcastToChrome(IPC.BOOKMARK_CHANGED);
    return moved;
  });
  ipcMain.handle(IPC.BOOKMARK_REORDER, (_e, parentId: number | null, orderedIds: number[]) => {
    const ok = bookmarks.reorder(parentId, orderedIds);
    if (ok) broadcastToChrome(IPC.BOOKMARK_CHANGED);
    return ok;
  });
  ipcMain.handle(IPC.BOOKMARK_IS_BOOKMARKED, (_e, url: string) => bookmarks.isBookmarked(url));
  // Импорт — isAvailable() зовётся заново на каждый список (профиль браузера-источника мог
  // появиться/пропасть между вызовами, не кэшируем факт наличия).
  ipcMain.handle(IPC.BOOKMARK_IMPORT_LIST_SOURCES, () =>
    bookmarkImporters.filter((imp) => imp.isAvailable()).map((imp) => ({ id: imp.id, label: imp.label })));
  ipcMain.handle(IPC.BOOKMARK_IMPORT_RUN, async (_e, sourceId: string) => {
    const importer = bookmarkImporters.find((imp) => imp.id === sourceId);
    if (!importer) return null;
    const result = await importer.import();
    broadcastToChrome(IPC.BOOKMARK_CHANGED);
    return result;
  });

  // Общий мультитиповый импорт (закладки/история/пароли) — диалог импорта + онбординг.
  ipcMain.handle(IPC.IMPORT_LIST_SOURCES, () => importManager.listSources());
  ipcMain.handle(IPC.IMPORT_RUN, async (_e, sourceId: string, dataTypes: ImportDataType[]) => {
    const result = await importManager.run(sourceId, Array.isArray(dataTypes) ? dataTypes : []);
    // Любой перенос мог задеть закладки/историю/сейф — толкаем их слушателей перечитать.
    if (result.bookmarks) broadcastToChrome(IPC.BOOKMARK_CHANGED);
    return result;
  });
  // ⚠️ Наличие браузеров для импорта здесь БОЛЬШЕ НЕ ПРОВЕРЯЕТСЯ: раньше экран первого запуска
}
