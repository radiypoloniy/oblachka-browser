// Итоги дня, геометрия контента и поповеры: подсказки, пароли, VPN, загрузки, сайт
//
// Часть контракта IPC, вынесенная из main.ts (см. electron/ipc/deps.ts — почему нарезано
// непрерывными кусками, а не по доменам). Тела обработчиков перенесены дословно.
import { IPC } from '../../shared/ipc';
import type { ContentBounds, DayDigestState, OmniboxPanel, SuggestDropdownItem } from '../../shared/ipc';
import { buildDigest, getDigest, shouldRefresh } from '../DayDigest';
import { closeDownloadsPopover, showDownloadsPopover, syncDownloadsPopoverAnchorBounds } from '../DownloadsPopoverManager';
import { syncDropZoneBounds } from '../DropZoneManager';
import { syncFindBarBounds } from '../FindBarManager';
import { closePasswordPopover, showPasswordPopover, syncPasswordPopoverAnchorBounds } from '../PasswordPopoverManager';
import { syncPermissionPopoverBounds } from '../PermissionPopoverManager';
import { syncScreenshotBounds } from '../ScreenshotManager';
import { syncSearchPopoverBounds } from '../SearchPopoverManager';
import { closeSitePopover, isSitePopoverOpen, showSitePopover, syncSitePopoverAnchorBounds } from '../SitePopoverManager';
import { closeSuggestDropdown, sendSuggestItems, sendSuggestPanel, showSuggestDropdown, syncOmniboxBounds, onPick as onSuggestDropdownPick, onSiteInfo as onSuggestDropdownSiteInfo, onRecommend as onSuggestDropdownRecommend, setHighlight as setSuggestDropdownHighlight } from '../SuggestDropdownManager';
import { closeVpnPopover, showVpnPopover, syncVpnPopoverActiveUrl, syncVpnPopoverAnchorBounds } from '../VpnPopoverManager';
import { contextForWindow } from '../WindowRegistry';
import { ipcMain } from 'electron';
import type { IpcDeps } from './deps';

export function registerOverlaysIpc(d: IpcDeps): void {
  const { history, tabsOf, winOf } = d;


  // «Итоги дня» (см. DayDigest.ts). GET модель не трогает вовсе — отдаёт готовое или «нет».
  ipcMain.handle(IPC.DIGEST_GET, (): DayDigestState => {
    // Заодно решаем, не пора ли обновить фоном: условие внутри (прошёл час И прибавилось
    // страниц) и только на тёплой модели, так что обычно это дешёвая проверка без последствий.
    if (shouldRefresh((since) => history.getSince(since))) {
      // ⚠️ Результат НИКУДА не пушим намеренно. Виджет спрашивает итог сам при каждом открытии
      // новой вкладки, а открывают её десятки раз в день — пересобранный фоном итог доедет до
      // экрана без единого лишнего канала. Пуш здесь был бы каналом, который слушать некому:
      // именно так и появляются «живые» сообщения, уходящие в пустоту.
      void buildDigest((since) => history.getSince(since), false)
        .catch(() => { /* фоновая пересборка — не повод шуметь */ });
    }
    return getDigest();
  });
  // Явное «собрать» — человек нажал кнопку и готов подождать загрузку модели.
  ipcMain.handle(IPC.DIGEST_BUILD, (): Promise<DayDigestState> =>
    buildDigest((since) => history.getSince(since), true));
  ipcMain.handle(IPC.CONTENT_SET_BOUNDS, (e, b: ContentBounds) => {
    tabsOf(e)?.setContentBounds(b);
    // Та же геометрия двигает FindBar — центрирование по контентной зоне (учитывает сайдбар) и
    // авто-скрытие при настройках/истории/загрузках (нулевые bounds — тот же сентинел, см. FindBarManager.ts).
    const fbWin = winOf(e);
    if (fbWin) {
      syncFindBarBounds(fbWin, b);
      syncDropZoneBounds(fbWin, b); // та же геометрия — зоны дропа рисуются ровно по контенту
      syncScreenshotBounds(fbWin, b); // карточка снимка сидит в правом нижнем углу контента
      syncPermissionPopoverBounds(fbWin, b); // и запрос разрешения — он тоже привязан к контенту
    }
    syncSearchPopoverBounds(b); // тот же сентинел нулевых bounds — прячем поповер вместе с контентом
  });
  // Прямоугольник омнибокса — двигает нативную вью дропдауна подсказок (см.
  // shared/ipc.ts::IPC.OMNIBOX_SET_BOUNDS, SuggestDropdownManager.ts) — старый chrome-DOM
  // дропдаун этот канал не читает, продолжает позиционироваться от toolbarRef как раньше.
  ipcMain.handle(IPC.OMNIBOX_SET_BOUNDS, (e, b: ContentBounds) => {
    // Лог убран: канал горячий (ResizeObserver омнибокса + смена ширины тулбара), в проде это
    // поток строк ни о чём — см. CLAUDE.md, «уровни логирования; в prod — без URL/текстов».
    const w = winOf(e);
    if (w) syncOmniboxBounds(w, b);
  });
  // Тумблер показа вью дропдауна — вешается на тот же момент, что и старый React-дропдаун
  // (Toolbar.tsx::openDropdown/closeDropdown), который пока не заменяет (работают параллельно).
  ipcMain.handle(IPC.SUGGEST_DROPDOWN_TOGGLE, (e, open: boolean) => {
    const w = winOf(e);
    // ⚠️ Возврата фокуса чрому здесь больше НЕТ и быть не должно. Он компенсировал перехват
    // фокуса вью-дропдауном, а дропдаун теперь неактивируемое дочернее окно и перехватить фокус
    // не может в принципе (см. шапку SuggestDropdownManager.ts). Прежний вызов был не безобидным:
    // канал дёргается на КАЖДУЮ букву, а focus() доходит до нативного SetFocus и сбрасывает захват
    // мыши — то есть обрывал протяжку выделения в адресной строке прямо посреди неё.
    if (open) {
      if (w) showSuggestDropdown(w);
    } else {
      closeSuggestDropdown(w);
    }
  });
  ipcMain.handle(IPC.PASSWORD_POPOVER_SET_BOUNDS, (e, b: ContentBounds) => {
    const w = winOf(e);
    if (w) syncPasswordPopoverAnchorBounds(w, b);
  });
  ipcMain.handle(IPC.PASSWORD_POPOVER_SHOW, (e, state) => {
    const w = winOf(e);
    if (w) showPasswordPopover(w, state);
  });
  ipcMain.handle(IPC.PASSWORD_POPOVER_CLOSE, (e) => {
    closePasswordPopover(winOf(e));
  });
  ipcMain.handle(IPC.VPN_POPOVER_SET_BOUNDS, (_e, b: ContentBounds) => {
    syncVpnPopoverAnchorBounds(b);
  });
  ipcMain.handle(IPC.VPN_POPOVER_SHOW, (e) => {
    const w = winOf(e);
    if (w) showVpnPopover(w);
  });
  ipcMain.handle(IPC.VPN_POPOVER_CLOSE, () => {
    closeVpnPopover();
  });
  ipcMain.handle(IPC.VPN_POPOVER_SET_ACTIVE_URL, (_e, url: string) => {
    syncVpnPopoverActiveUrl(url);
  });
  ipcMain.handle(IPC.DOWNLOADS_POPOVER_SET_BOUNDS, (_e, b: ContentBounds) => {
    syncDownloadsPopoverAnchorBounds(b);
  });
  ipcMain.handle(IPC.DOWNLOADS_POPOVER_SHOW, (e) => {
    const w = winOf(e);
    if (w) showDownloadsPopover(w);
  });
  ipcMain.handle(IPC.DOWNLOADS_POPOVER_CLOSE, () => {
    closeDownloadsPopover();
  });
  // ── Поповер сведений о сайте (замочек в омнибоксе) ──
  ipcMain.handle(IPC.SITE_POPOVER_BOUNDS, (_e, b: ContentBounds) => {
    syncSitePopoverAnchorBounds(b);
  });
  // Один канал на открыть/закрыть: кнопка-замок работает переключателем, и держать для этого два
  // канала значит однажды разъехаться в том, кто из них считает состояние (тот же приём, что у
  // остальных поповеров тулбара).
  ipcMain.handle(IPC.SITE_POPOVER_TOGGLE, (e) => {
    const w = winOf(e);
    if (!w) return false;
    if (isSitePopoverOpen()) { closeSitePopover(); return false; }
    showSitePopover(w);
    return true;
  });
  // Адрес активной вкладки для самого поповера. ⚠️ Берём у менеджера вкладок окна-отправителя, а
  // не из аргумента: вью поповера живёт между показами и легко отстаёт от навигации.
  ipcMain.handle(IPC.SITE_POPOVER_ACTIVE_TAB, (e): { url: string; title: string } | null => {
    const active = tabsOf(e)?.snapshot().find((t) => t.isActive && !t.isHub);
    return active ? { url: active.url, title: active.title } : null;
  });
  // Живой список подсказок (заход 3/5) — buildSuggestions в Toolbar.tsx шлёт тот же массив,
  // что кладёт в setSuggestions() для старого дропдауна; main пересылает его во вью.
  ipcMain.handle(IPC.SUGGEST_DROPDOWN_SET_ITEMS, (e, items: SuggestDropdownItem[]) => {
    const w = winOf(e);
    if (w) sendSuggestItems(w, items);
  });
  // Панель по нетронутой строке (заход 11) — второй режим той же вью, см. OmniboxPanel.
  ipcMain.handle(IPC.SUGGEST_DROPDOWN_SET_PANEL, (e, panel: OmniboxPanel) => {
    const w = winOf(e);
    if (w) sendSuggestPanel(w, panel);
  });
  // Клик по полоске сайта в панели — в чром того же окна, где кликнули: там Toolbar.tsx откроет
  // поповер замочка своим обычным путём (панель управлением не занимается).
  onSuggestDropdownSiteInfo((w) => {
    contextForWindow(w)?.chromeView.webContents.send(IPC.SUGGEST_DROPDOWN_SITE_INFO);
  });
  // Правка «Рекомендуемых» карандашом — намерение уходит в чром, там Toolbar.tsx его применяет,
  // сохраняет набор и пересобирает панель (владелец содержимого панели один, см. OmniboxPanel).
  onSuggestDropdownRecommend((w, edit) => {
    contextForWindow(w)?.chromeView.webContents.send(IPC.SUGGEST_DROPDOWN_RECOMMEND, edit);
  });
  // Клик по строке ВО вью дропдауна (другой webContents) — пересылаем в chrome, где Toolbar.tsx
  // вызывает свой существующий pickSuggestion(), не дублируя его поведение (activateTab/навигация).
  // Выбор возвращается в омнибокс ТОГО окна, где кликнули, — дропдаун теперь свой у каждого.
  onSuggestDropdownPick((w, item) => {
    contextForWindow(w)?.chromeView.webContents.send(IPC.SUGGEST_DROPDOWN_PICKED, item);
  });
  // Страж фокуса дропдауна (см. блок «ФОКУС» в шапке SuggestDropdownManager.ts). Electron не даёт
  // запретить вью забирать фокус (electron/electron#42922 открыт), поэтому единственная надёжная
  // защита — откатывать КАЖДЫЙ перехват, а не компенсировать отдельные известные моменты. Заменяет
  // прежние точечные заплатки (onFirstLoad + разовый focus() при открытии).
  // Клавиатурная подсветка (заход 4/5) — омнибокс шлёт номер строки (-1 снимает), main просто
  // пересылает во вью; выбор (Enter) остаётся локальным в омнибоксе, эта вью в нём не участвует.
  ipcMain.handle(IPC.SUGGEST_DROPDOWN_HIGHLIGHT, (e, idx: number) => {
    const w = winOf(e);
    if (w) setSuggestDropdownHighlight(w, idx);
  });
}
