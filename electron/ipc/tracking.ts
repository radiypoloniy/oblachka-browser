// Отслеживание товаров и буфер скопированного со страниц
//
// Часть контракта IPC, вынесенная из main.ts (см. electron/ipc/deps.ts — почему нарезано
// непрерывными кусками, а не по доменам). Тела обработчиков перенесены дословно.
import { IPC } from '../../shared/ipc';
import type { ClipboardRevealResult, ContentBounds, TrackedProduct } from '../../shared/ipc';
import * as clipboardBuffer from '../ClipboardBuffer';
import { closeClipboardPopover, syncClipboardPopoverAnchor, toggleClipboardPopover, windowOfClipboardPopover } from '../ClipboardPopoverManager';
import { sendFindResult, showFindBar } from '../FindBarManager';
import { highlightCandidates } from '../SmartFind';
import { checkAllNow } from '../TrackingChecker';
import { broadcastToChrome, contextForWindow, contextFromSender } from '../WindowRegistry';
import { clipboard, ipcMain } from 'electron';
import type { IpcDeps } from './deps';

export function registerTrackingIpc(d: IpcDeps): void {
  const { pushProductState, showProductMenu, tracking } = d;

  // Отслеживание товаров (PRICE-TRACKING.md, срез 1).
  ipcMain.handle(IPC.PRODUCT_MENU, (e) => {
    const ctx = contextFromSender(e.sender);
    if (ctx) showProductMenu(ctx.win);
  });
  ipcMain.handle(IPC.TRACKING_LIST, (): TrackedProduct[] => tracking.list());
  ipcMain.handle(IPC.TRACKING_EVENTS, () => tracking.listEvents());
  ipcMain.handle(IPC.TRACKING_NOTIFY_GET, () => tracking.notificationsEnabled());
  ipcMain.handle(IPC.TRACKING_NOTIFY_SET, (_e, on: boolean) => { tracking.setNotificationsEnabled(on); });
  ipcMain.handle(IPC.TRACKING_SUGGESTIONS, () => tracking.listSuggestions());

  // ── Буфер скопированного со страниц ─────────────────────────────────────────
  // Копия, сделанная в самом интерфейсе (адресная строка, история, закладки). Источником считаем
  // АКТИВНУЮ ВКЛАДКУ: скопированный из строки адрес принадлежит именно ей, и в списке запись должна
  // встать в группу того сайта, а не «без адреса».
  // ⚠️ Инкогнито отсекаем ровно так же, как для копий со страниц: приватная вкладка не оставляет
  // следов нигде, и адрес приватной страницы — такой же след, как история.
  ipcMain.on(IPC.CLIPBOARD_COPIED_UI, (e, payload: { text: string }) => {
    const ctx = contextFromSender(e.sender);
    if (!ctx) return;
    const activeId = ctx.tabs.getActiveId();
    if (ctx.tabs.isIncognito(activeId)) return;
    const wc = ctx.tabs.getActiveWebContents();
    const url = wc && !wc.isDestroyed() ? wc.getURL() : '';
    const title = wc && !wc.isDestroyed() ? wc.getTitle() : '';
    clipboardBuffer.recordCopy(payload?.text ?? '', url, title);
    broadcastToChrome(IPC.CLIPBOARD_CHANGED, clipboardBuffer.listCopies().length);
  });
  ipcMain.handle(IPC.CLIPBOARD_LIST, () => clipboardBuffer.listCopies());
  // ⚠️ Кладём в буфер ОС и РАЗМЕТКУ, если она есть. Раньше здесь был только writeText, и повторная
  // копия из списка приезжала голым текстом — «скопировал ссылку, вставил, а ссылки нет». При
  // обычном копировании со страницы text/html кладёт сам Chromium, так что расхождение видел
  // только тот, кто пользовался нашим списком.
  // text остаётся ОБЯЗАТЕЛЬНЫМ: место вставки может не понимать html (поле ввода, терминал), и без
  // текстовой части там не появилось бы вообще ничего.
  ipcMain.handle(IPC.CLIPBOARD_PUT, (_e, id: number) => {
    const entry = clipboardBuffer.entryById(id);
    if (!entry) return;
    if (entry.html) clipboard.write({ text: entry.text, html: entry.html });
    else clipboard.writeText(entry.text);
  });
  // Один адрес из записи. ⚠️ Пришедший url СВЕРЯЕТСЯ со списком ссылок этой записи и только потом
  // попадает в системный буфер: канал не должен превращаться в «запиши в буфер ОС что скажу» —
  // поповер хоть и наш, но это отдельная вью, и доверять её строке на слово незачем.
  ipcMain.handle(IPC.CLIPBOARD_PUT_LINK, (_e, id: number, url: string) => {
    const entry = clipboardBuffer.entryById(id);
    if (entry?.links?.some((l) => l.url === url)) clipboard.writeText(url);
  });
  // Переход к источнику: открыть страницу, где текст скопировали, и подсветить его.
  // ⚠️ Своей подсветки не изобретаем — те же highlightCandidates + findQuoteInPage, что у
  // смыслового Ctrl+F: лесенка кандидатов от длинного к короткому уже умеет то, обо что здесь
  // споткнулись бы первым делом (текст на странице разорван вёрсткой, в копии пробелы схлопнуты).
  // ⚠️ Поповер закрываем ДО перехода: он висит поверх контента, и подсвеченное место оказалось бы
  // ровно под ним.
  ipcMain.handle(IPC.CLIPBOARD_OPEN_SOURCE, async (e, id: number): Promise<ClipboardRevealResult> => {
    const entry = clipboardBuffer.entryById(id);
    if (!entry || !/^https?:\/\//i.test(entry.url)) return 'no-source';
    const win = windowOfClipboardPopover(e.sender);
    const tabs = win ? contextForWindow(win)?.tabs : null;
    if (!win || !tabs) return 'no-source';
    closeClipboardPopover(win);
    const found = await tabs.revealCopiedText(entry.url, clipboardBuffer.highlightSteps(entry.text, highlightCandidates));
    // ⚠️ Открываем панель поиска с этим запросом — и это не украшение, а ЕДИНСТВЕННЫЙ способ снять
    // подсветку. Chromium держит её до stopFindInPage, а у человека без панели нет ни Esc, ни
    // крестика: живая жалоба — «подсветку можно убрать только перезагрузкой страницы». Заодно
    // появляются счётчик и стрелки по совпадениям — ровно то, чего от «как Ctrl+F» и ждут.
    // ⚠️ Счётчик шлём САМИ, а не повторным поиском: повторный findInPage с тем же запросом — это
    // «продолжить», то есть прыжок на СЛЕДУЮЩЕЕ совпадение, и человек уехал бы с найденного места.
    if (found.matches > 0) {
      showFindBar(win, found.query);
      // Флаг «панель открыта» ставил только Ctrl+F — без него Esc НА СТРАНИЦЕ её не закрывает,
      // а значит и подсветку не снимает.
      tabs.markFindBarOpen();
      sendFindResult(win, { activeMatch: 1, count: found.matches });
    }
    // Без лога «страница открылась, но ничего не подсветилось» неотличимо от «переход не сработал»,
    // а это два разных дефекта: первый — страница с тех пор изменилась, второй — наш код.
    console.log(`[clipboard] переход к источнику ${entry.host} → ${found.matches} совпад.`);
    return found.matches > 0 ? 'highlighted' : 'opened';
  });
  // Возвращаем результат: полка закреплённого не резиновая, и «нажал — ничего не произошло» тут
  // самый вредный исход (человек уверен, что запись переживёт перезапуск, а она нет).
  ipcMain.handle(IPC.CLIPBOARD_PIN, (_e, id: number, on: boolean) => {
    const ok = clipboardBuffer.setPinned(id, on);
    broadcastToChrome(IPC.CLIPBOARD_CHANGED, clipboardBuffer.listCopies().length);
    return ok;
  });
  ipcMain.handle(IPC.CLIPBOARD_REMOVE, (_e, id: number) => {
    clipboardBuffer.removeCopy(id);
    broadcastToChrome(IPC.CLIPBOARD_CHANGED, clipboardBuffer.listCopies().length);
  });
  ipcMain.handle(IPC.CLIPBOARD_CLEAR, () => {
    clipboardBuffer.clearCopies();
    broadcastToChrome(IPC.CLIPBOARD_CHANGED, 0);
  });
  ipcMain.handle(IPC.CLIPBOARD_ENABLED_GET, () => clipboardBuffer.isClipboardBufferEnabled());
  ipcMain.handle(IPC.CLIPBOARD_ENABLED_SET, (_e, on: boolean) => {
    clipboardBuffer.setClipboardBufferEnabled(on);
    broadcastToChrome(IPC.CLIPBOARD_CHANGED, clipboardBuffer.listCopies().length);
  });
  ipcMain.handle(IPC.CLIPBOARD_POPOVER_TOGGLE, (e) => {
    const ctx = contextFromSender(e.sender);
    if (ctx) toggleClipboardPopover(ctx.win);
  });
  ipcMain.on(IPC.CLIPBOARD_POPOVER_BOUNDS, (e, b: ContentBounds) => {
    const ctx = contextFromSender(e.sender);
    if (ctx) syncClipboardPopoverAnchor(ctx.win, b);
  });
  ipcMain.handle(IPC.TRACKING_MERGE, (_e, aId: number, bId: number) => {
    tracking.joinGroup(aId, bId);
    broadcastToChrome(IPC.TRACKING_CHANGED);
  });
  ipcMain.handle(IPC.TRACKING_MERGE_DISMISS, (_e, aId: number, bId: number) => {
    tracking.dismissSuggestion(aId, bId);
    broadcastToChrome(IPC.TRACKING_CHANGED);
  });
  ipcMain.handle(IPC.TRACKING_UNGROUP, (_e, id: number) => {
    tracking.leaveGroup(id);
    broadcastToChrome(IPC.TRACKING_CHANGED);
  });
  // ⚠️ Проверка по кнопке идёт БЕЗ пауз и без гейта «давно не проверяли»: человек нажал и ждёт.
  // Фоновая, наоборот, редкая и с паузами — см. TrackingChecker.
  ipcMain.handle(IPC.TRACKING_CHECK_NOW, async () => {
    const res = await checkAllNow();
    broadcastToChrome(IPC.TRACKING_CHANGED);
    return res;
  });
  ipcMain.handle(IPC.TRACKING_UNTRACK, (e, id: number) => {
    tracking.untrack(id);
    broadcastToChrome(IPC.TRACKING_CHANGED);
    const ctx = contextFromSender(e.sender);
    if (ctx) pushProductState(ctx.win);
  });
}
