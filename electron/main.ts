import { app, BrowserWindow, WebContentsView, ipcMain, Menu, shell, session } from 'electron';
import { registerSchemesAsPrivileged, registerModelProtocol, registerChromeProtocol } from './AppProtocol';

// ДО app.whenReady() — Electron требует это до события ready.
registerSchemesAsPrivileged();
import type { MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import { TabManager } from './TabManager';
import { SessionManager } from './SessionManager';
import { AdBlockManager } from './AdBlockManager';
import { HistoryManager } from './HistoryManager';
import { DownloadManager } from './DownloadManager';
import { PermissionManager } from './PermissionManager';
import { IPC } from '../shared/ipc';
import type { ContentBounds, TitleBarOpts, FindResult, HistoryClearPeriod, SidebarNode, GroupNode, OrganizeCluster } from '../shared/ipc';
import type { SavedNode } from './SessionManager';
import { showTranslatePopover, closeTranslatePopoverOnTabSwitch, closeTranslatePopoverForClosedTab } from './TranslatePopoverManager';
import { toggleAiPanel, onTabsSynced, setTabManager } from './AiPanelManager';

// Диагностика краша "Object has been destroyed" (exitSplit ← closeTab) на закрытии браузера со
// split — прошлый гард (isLiveHttpView в exitSplit, покрывающий self-close вкладки) НЕ закрыл
// проблему, значит падает ДРУГОЙ путь: массовый teardown при закрытии всего окна, не self-close
// одной вкладки. Полный стек + порядок destroyed-событий — см. также логи в TabManager.ts
// (wc.on('destroyed', ...), exitSplit, closeTab). Убрать после диагностики можно, но по духу
// проекта (сравни [perf]/[popover]-логи) — не обязательно, шума немного, срабатывает только
// на закрытии/split-событиях.
Error.stackTraceLimit = Infinity;
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection:', reason);
});

const isDev = process.env.NODE_ENV === 'development';
const DEV_URL = 'http://localhost:5173';

// Одно место: env OBLAKO_PRELOAD_EMBED=0 npm start → предзагрузка эмбеддинг-модели отключена.
// Используется в preload.ts (window.oblako.embedPreload) и для лога [startup] preload=on|off.
const EMBED_PRELOAD = process.env.OBLAKO_PRELOAD_EMBED !== '0';

// Изолированные стенды AI-инфраструктурных тестов (WebGPU-эксперименты, node-llama-cpp).
// OBLAKO_GPU_TEST=1 / OBLAKO_LLAMA_TEST=1 / OBLAKO_TRANSLATE_TEST=1 npm start → вместо боевого
// окна открывается только тестовое, боевой чром (TabManager/SessionManager/adblock/history)
// не инициализируется.
const GPU_TEST = process.env.OBLAKO_GPU_TEST === '1';
const LLAMA_TEST = process.env.OBLAKO_LLAMA_TEST === '1';
const TRANSLATE_TEST = process.env.OBLAKO_TRANSLATE_TEST === '1';

// html — страница из src/*.html (Vite multi-entry, см. vite.config.ts).
// logPrefix — ASCII-тег, по которому строки console.log форвардятся в main stdout как есть;
// всё остальное (шум ORT/браузера) помечается tag:console, чтобы не путать с результатами теста.
function runIsolatedTestWindow(html: string, logPrefix: string): void {
  const testWin = new BrowserWindow({ width: 900, height: 600, show: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  testWin.webContents.on('console-message', (event: any) => {
    const msg: string = event.message ?? '';
    if (msg.startsWith(logPrefix)) process.stdout.write(msg + '\n');
    else process.stdout.write(`${logPrefix}:console ${msg}\n`);
  });
  testWin.on('closed', () => app.quit());
  testWin.loadURL(`oblako-chrome://localhost/${html}`);
}

// Тест-мост перевода: нужен свой preload (contextBridge → window.translateTest) и IPC-хендлер
// в main (node-llama-cpp работает только там) — в отличие от runIsolatedTestWindow это не просто
// read-only лог, а живое окно с вводом. Отдельный от боевого preload.ts/shared/ipc.ts.
async function runTranslateTestWindow(): Promise<void> {
  const { initTranslateTestBridge } = await import('./translateTestBridge');
  initTranslateTestBridge();

  const testWin = new BrowserWindow({
    width: 900,
    height: 700,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-translatetest.js'),
      contextIsolation: true,
      sandbox: false, // preload использует ipcRenderer
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  testWin.webContents.on('console-message', (event: any) => {
    process.stdout.write(`${event.message ?? ''}\n`);
  });
  testWin.on('closed', () => app.quit());
  testWin.loadURL('oblako-chrome://localhost/translatetest.html');
}

// t0 стартовых тайминов: фиксируем в app.whenReady, до createWindow.
let startT0 = 0;

let win: BrowserWindow | null = null;
let chromeView: WebContentsView | null = null; // слой нашего React-хрома
let tabs: TabManager | null = null;
let sess: SessionManager | null = null;
// Взводится ДО того, как tabs/sess начинают асинхронно обнуляться/дозакрываться (win.on('close')/
// before-quit) — сигнал побочным подписчикам onChange (сейчас только AiPanelManager.onTabsSynced)
// не синкаться во время выхода: AI-панель и так исчезает вместе с окном, а сама TabManager к этому
// моменту может уже дотла закрывать вкладки асинхронно. НЕ влияет на финальный автосейв — тот
// синхронный (win.on('close') ниже), от этого флага не зависит.
let isShuttingDown = false;
const adblock     = new AdBlockManager();
const history     = new HistoryManager();
const downloads   = new DownloadManager();
const permissions = new PermissionManager();

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#E7E9F4', // совпадает с --app-bg, чтобы не мигало белым
    // Кастомный titlebar: системные кнопки в своём оформлении (спека, тех.стек).
    show: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#E7E9F4',   // --app-bg светлой темы; обновляется через IPC при смене темы
      symbolColor: '#46443F',
      height: 56,
    },
  });

  // Слой хрома (сайдбар+тулбар+хаб) — обычный WebContentsView во всё окно.
  chromeView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload использует ipcRenderer — sandbox off только для хрома
    },
  });
  win.contentView.addChildView(chromeView);

  const layoutChrome = () => {
    if (!win || !chromeView) return;
    const { width, height } = win.getContentBounds();
    chromeView.setBounds({ x: 0, y: 0, width, height });
  };
  layoutChrome();
  win.on('resize', layoutChrome);

  // Орфография (ru+en): одна сессия на все вкладки — одного вызова достаточно.
  session.defaultSession.setSpellCheckerLanguages(['ru', 'en-US']);

  // Перехватываем все загрузки на дефолтной сессии (вкладки partition не задают).
  downloads.attach(session.defaultSession, (entries) => {
    chromeView?.webContents.send(IPC.DOWNLOADS_CHANGED, entries);
  });

  // Разрешения: оба хендлера на дефолтной сессии. Инкогнито (будущее) — отдельный attach.
  permissions.attach(session.defaultSession, (req) => {
    chromeView?.webContents.send(IPC.PERMISSION_REQUEST, req);
  });

  // Загружаем сохранённую сессию ДО создания TabManager.
  sess = new SessionManager();
  const restored = sess.load();

  // При любом изменении: обновляем UI и планируем сохранение сессии.
  // scheduleSave молча игнорирует вызовы до sess.enable() — это защита
  // от затирания: onChange стреляет во время restore, но сохранять ещё нельзя.
  tabs = new TabManager(
    win,
    () => {
      // РЕГРЕССИЯ (заход 3, починено): tabs!.snapshot() раньше жил ВНУТРИ chromeView?.webContents.send(...) —
      // optional chaining короткого замыкания там пропускал вычисление ВСЕХ аргументов целиком,
      // если chromeView===null (а он обнуляется синхронно вместе с tabs в win.on('closed')), так что
      // .snapshot() неявно никогда не звался на null. Вынос в отдельную const убрал эту неявную
      // защиту — .snapshot() стал звонить на tabs===null во время закрытия (часть вкладок
      // дозакрывается асинхронно уже ПОСЛЕ win.on('closed')). Явный гард вместо неявного:
      if (!tabs) return;
      // Атомарный push: tabs и nodes в одном сообщении → один рендер, нет рассинхрона.
      const tabsSnapshot = tabs.snapshot();
      chromeView?.webContents.send(IPC.SYNC_CHANGED, {
        tabs: tabsSnapshot,
        nodes: tabs.sidebarNodesSnapshot(),
        hasOrganizeSnapshot: tabs.hasOrganizeSnapshot(),
      });
      // Тот же снапшот — источник правды для привязки чата AI-панели к вкладке (переключение/
      // закрытие/смена URL), без новых колбэков в TabManager.ts (см. AiPanelManager.ts). Не во
      // время выхода — AI-панель и так исчезает вместе с окном, синкать её незачем.
      if (!isShuttingDown) onTabsSynced(tabsSnapshot);
      // sess?. — не «отменяет» финальное сохранение: оно гарантированно уже прошло синхронно
      // в win.on('close') ДО того, как sess обнуляется в win.on('closed') (см. ниже). Этот вызов
      // подчистую сработает во время закрытия окна — часть вкладок ещё дозакрывается асинхронно
      // (destroyed-события уже после win.on('closed')) и без ?. падал на null.scheduleSave.
      // tabs?. в колбэке — scheduleSave стреляет через debounce (1.5с), tabs может обнулиться
      // МЕЖДУ планированием и срабатыванием таймера (окно закрылось в этот промежуток).
      sess?.scheduleSave(() => tabs?.getSessionSnapshot() ?? null);
    },
    (r: FindResult) => chromeView?.webContents.send(IPC.FIND_RESULT, r),
    ()              => chromeView?.webContents.send(IPC.FIND_OPEN),
    ()              => chromeView?.webContents.send(IPC.FIND_CLOSE),
    ()              => chromeView?.webContents.send(IPC.OMNIBOX_FOCUS),
    ()              => chromeView?.webContents.focus(),
    (url, title)    => history.recordVisit(url, title),
    (url, title)    => history.updateTitle(url, title),
    ()              => chromeView?.webContents.send(IPC.HISTORY_OPEN),
    ()              => console.log(`[startup] firsttab ${Date.now() - startT0}ms`),
    (action, text, rect, wc) => {
      // Поповер у выделения, поверх контента (см. TranslatePopoverManager.ts) — не панель в чроме.
      // Ленивый: WebContentsView+preload поповера создаются только этим вызовом. Один поповер на
      // все AI-действия (перевод/выжимка/пересказ/объяснение) — action меняет только промпт.
      if (win) showTranslatePopover(win, action, text, rect, wc);
    },
    () => closeTranslatePopoverOnTabSwitch(),
    (wc) => closeTranslatePopoverForClosedTab(wc),
  );
  // Единственная точка, где AiPanelManager получает доступ к вкладкам — только для чтения
  // WebContents активной вкладки при извлечении текста страницы в чат (Заход 4), см.
  // TabManager.getActiveWebContents(). Не влияет на управление вкладками.
  setTabManager(tabs);

  // Восстанавливаем вкладки из session.json (v4: nodes[] с группами; v1/v2/v3 мигрированы).
  if (restored) {
    // Закреплённые сначала — стабильный порядок, всегда вверху сайдбара.
    const pinnedIds: string[] = [];
    const pinnedUrlToId = new Map<string, string>();
    for (const { url } of restored.pinnedTabs) {
      const id = tabs.createPinnedTab(url);
      pinnedIds.push(id);
      pinnedUrlToId.set(url, id);
    }

    // Рекурсивно создаём вкладки из дерева узлов и строим urlToIds (очередь на случай дублей URL).
    const urlToIds = new Map<string, string[]>();
    const collectTabs = (nodes: SavedNode[]) => {
      for (const node of nodes) {
        if (node.type === 'single') {
          const id = tabs!.createTab(node.url, true);
          const list = urlToIds.get(node.url) ?? [];
          list.push(id); urlToIds.set(node.url, list);
        } else if (node.type === 'split-pair') {
          const lId = tabs!.createTab(node.leftUrl,  true);
          const rId = tabs!.createTab(node.rightUrl, true);
          const lList = urlToIds.get(node.leftUrl)  ?? []; lList.push(lId); urlToIds.set(node.leftUrl,  lList);
          const rList = urlToIds.get(node.rightUrl) ?? []; rList.push(rId); urlToIds.set(node.rightUrl, rList);
        } else if (node.type === 'group') {
          collectTabs(node.children);
        }
      }
    };
    collectTabs(restored.nodes);

    // Перестраиваем дерево узлов по сохранённой структуре (с группами, парами).
    tabs.rebuildNodeTree(restored.nodes, urlToIds);

    // Активная вкладка по activeRef.
    const ref = restored.activeRef;
    let targetId: string | undefined;
    if (ref.type === 'pinned') {
      targetId = pinnedIds[ref.index];
    } else if (ref.type === 'url') {
      // v4-формат: URL уникально идентифицирует вкладку.
      targetId = urlToIds.get(ref.url)?.[0] ?? pinnedUrlToId.get(ref.url);
    } else if (ref.type === 'normal') {
      // v3-формат: плоский nodeIndex в сериализованном списке без групп.
      // Так как v3 не имел групп, flattenNodes() совпадает с порядком nodes.
      const flatNodes = tabs.snapshot().filter((t) => !t.isHub && !t.isPinned);
      targetId = flatNodes[ref.nodeIndex]?.id;
    } else if (ref.type === 'split') {
      // v3-формат: split с nodeIndex и side.
      const flatNodes = tabs.snapshot().filter((t) => !t.isHub && !t.isPinned);
      const paired = flatNodes.filter((t) => t.splitSide !== null);
      const target = ref.side === 'left'
        ? paired.find((t) => t.splitSide === 'left')
        : paired.find((t) => t.splitSide === 'right');
      targetId = target?.id;
    }
    // ref.type === 'hub' → остаёмся на хабе (дефолт TabManager).
    if (targetId) tabs.activate(targetId);
  }

  // Только после восстановления разрешаем автосейв.
  sess.enable();

  // Форвардинг логов воркера эмбеддингов из renderer → stdout.
  // Новый API Electron: событие console-message передаёт поля через Event-объект.
  const LOG_PREFIXES = ['[embed]'];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chromeView.webContents.on('console-message', (event: any) => {
    const msg: string = event.message ?? '';
    if (LOG_PREFIXES.some((p) => msg.startsWith(p))) process.stdout.write(msg + '\n');
  });

  // ПКМ в хром-слое (омнибокс, поле чата): только редактируемые поля и выделение.
  // Для обычных элементов управления (кнопки, сайдбар) меню НЕ показываем.
  chromeView.webContents.on('context-menu', (_e, p) => {
    const items: MenuItemConstructorOptions[] = [];
    if (p.isEditable) {
      items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' });
    } else if (p.selectionText.trim()) {
      items.push({ role: 'copy' });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win! });
  });

  // Хоткеи для хром-слоя (хаб, омнибокс). Вкладки получают их через wirePageEvents.
  tabs.registerHotkeyHandler(chromeView.webContents);

  // Таймер окна: did-finish-load chromeView = React-UI загружен и отрисован.
  chromeView.webContents.once('did-finish-load', () => {
    console.log(`[startup] window ${Date.now() - startT0}ms`);
  });

  if (isDev) {
    chromeView.webContents.loadURL(DEV_URL);
    chromeView.webContents.openDevTools({ mode: 'detach' });
  } else {
    // oblako-chrome:// вместо file:// → COOP/COEP заголовки → crossOriginIsolated=true → SAB → WASM-потоки
    chromeView.webContents.loadURL('oblako-chrome://localhost/index.html');
  }

  // Финальный синхронный снапшот СЮДА, а не в app.on('before-quit'): на Windows/Linux
  // window-all-closed зовёт app.quit() уже ПОСЛЕ того, как это окно закрылось — то есть
  // before-quit неизбежно видит win/tabs/sess уже обнулёнными (см. win.on('closed') ниже) и
  // реально ничего не сохраняет. 'close' — единственная точка, где всё ещё гарантированно живо.
  win.on('close', () => {
    isShuttingDown = true; // до сохранения — далее tabs/sess ещё какое-то время живы, но выходим
    console.log('[shutdown] win close: старт, isShuttingDown=true, сохраняю сессию');
    if (tabs && sess) sess.saveNow(tabs.getSessionSnapshot());
    console.log('[shutdown] win close: сессия сохранена');
  });

  win.on('closed', () => {
    console.log('[shutdown] win closed: обнуляю win/chromeView/tabs/sess');
    win = null; chromeView = null; tabs = null; sess = null;
  });
}

// ── IPC: renderer (хром) управляет движком вкладок ──
function registerIpc() {
  ipcMain.handle(IPC.SYNC_GET, () => ({
    tabs:  tabs?.snapshot()              ?? [],
    nodes: tabs?.sidebarNodesSnapshot() ?? [],
    hasOrganizeSnapshot: tabs?.hasOrganizeSnapshot() ?? false,
  }));
  ipcMain.handle(IPC.TABS_GET_ALL, () => tabs?.snapshot() ?? []);
  ipcMain.handle(IPC.TAB_CREATE, (_e, url?: string) => tabs?.createTab(url));
  ipcMain.handle(IPC.TAB_CLOSE, (_e, id: string) => tabs?.closeTab(id));
  ipcMain.handle(IPC.TAB_ACTIVATE, (_e, id: string) => tabs?.activate(id));
  ipcMain.handle(IPC.TAB_NAVIGATE, (_e, id: string, input: string) => tabs?.navigate(id, input));
  ipcMain.handle(IPC.TAB_GO_BACK, (_e, id: string) => tabs?.goBack(id));
  ipcMain.handle(IPC.TAB_GO_FORWARD, (_e, id: string) => tabs?.goForward(id));
  ipcMain.handle(IPC.TAB_RELOAD, (_e, id: string) => tabs?.reload(id));
  ipcMain.handle(IPC.CONTENT_SET_BOUNDS, (_e, b: ContentBounds) => tabs?.setContentBounds(b));
  ipcMain.handle(IPC.WINDOW_SET_OVERLAY, (_e, opts: TitleBarOpts) => win?.setTitleBarOverlay(opts));
  ipcMain.handle(IPC.FIND_START, (_e, q: string, fwd: boolean) => tabs?.findInPage(q, fwd));
  ipcMain.handle(IPC.FIND_NEXT,  (_e, fwd: boolean)            => tabs?.findNext(fwd));
  ipcMain.handle(IPC.FIND_STOP,  ()                            => tabs?.stopFind());

  ipcMain.handle(IPC.TAB_PIN_TOGGLE, (_e, id: string) => tabs?.togglePin(id));

  // Split View
  ipcMain.handle(IPC.TAB_ENTER_SPLIT, (_e, rightId: string)         => tabs?.enterSplit(rightId));
  ipcMain.handle(IPC.TAB_EXIT_SPLIT,  ()                            => tabs?.exitSplit());
  ipcMain.handle(IPC.TAB_SPLIT_FOCUS, (_e, side: 'left' | 'right') => tabs?.focusSplitPanel(side));
  ipcMain.handle(IPC.TAB_SPLIT_RATIO, (_e, ratio: number)           => tabs?.setSplitRatio(ratio));

  ipcMain.handle(IPC.TAB_REORDER,
    (_e, section: 'normal' | 'pinned', orderedIds: string[]) =>
      tabs?.reorderTabs(section, orderedIds),
  );

  ipcMain.handle(IPC.TAB_MOVE_SECTION,
    (_e, tabId: string, targetSection: 'pinned' | 'normal', targetIndex: number) =>
      tabs?.moveTabSection(tabId, targetSection, targetIndex),
  );

  // AdBlock
  ipcMain.handle(IPC.ADBLOCK_GET_STATE,      ()                    => adblock.getState());
  ipcMain.handle(IPC.ADBLOCK_SET_ENABLED,    (_e, v: boolean)      => adblock.setEnabled(v));
  ipcMain.handle(IPC.ADBLOCK_ADD_DOMAIN,     (_e, d: string)       => adblock.addDomain(d));
  ipcMain.handle(IPC.ADBLOCK_REMOVE_DOMAIN,  (_e, d: string)       => adblock.removeDomain(d));
  ipcMain.handle(IPC.ADBLOCK_RELOAD_TABS,    (_e, d?: string)      => tabs?.reloadTabsForDomain(d));

  // История посещений
  ipcMain.handle(IPC.HISTORY_GET,    (_e, limit?: number)           => history.getRecent(limit));
  ipcMain.handle(IPC.HISTORY_SEARCH, (_e, query: string)            => history.search(query));
  ipcMain.handle(IPC.HISTORY_DELETE, (_e, id: number)               => history.deleteEntry(id));
  ipcMain.handle(IPC.HISTORY_CLEAR,  (_e, period: HistoryClearPeriod) => history.clearHistory(period));

  // Разрешения сайтов
  ipcMain.handle(IPC.PERMISSION_RESPONSE,
    (_e, requestId: string, granted: boolean, remember: boolean) =>
      permissions.respond(requestId, granted, remember),
  );

  // Загрузки
  ipcMain.handle(IPC.DOWNLOADS_GET_ALL,    ()               => downloads.getAll());
  ipcMain.handle(IPC.DOWNLOAD_PAUSE,       (_e, id: string) => downloads.pause(id));
  ipcMain.handle(IPC.DOWNLOAD_RESUME,      (_e, id: string) => downloads.resume(id));
  ipcMain.handle(IPC.DOWNLOAD_CANCEL,      (_e, id: string) => downloads.cancel(id));
  ipcMain.handle(IPC.DOWNLOAD_CLEAR,       (_e, id: string) => downloads.clear(id));
  ipcMain.handle(IPC.DOWNLOAD_OPEN_FILE,   (_e, id: string) => downloads.openFile(id));
  ipcMain.handle(IPC.DOWNLOAD_SHOW_FOLDER, (_e, id: string) => downloads.showFolder(id));
  ipcMain.handle(IPC.DOWNLOAD_RETRY,       (_e, id: string) => downloads.retry(id));

  // AI-группировка вкладок (Phase 4)
  ipcMain.handle(IPC.TABS_ORGANIZE_APPLY,    (_e, clusters: OrganizeCluster[]) => tabs?.applyOrganize(clusters));
  ipcMain.handle(IPC.TABS_ORGANIZE_ROLLBACK, ()                                => tabs?.rollbackOrganize());

  // Правая AI-панель (см. AiPanelManager.ts)
  ipcMain.handle(IPC.AI_PANEL_TOGGLE, () => win ? toggleAiPanel(win) : false);

  // Нативное ПКМ-меню вкладки в сайдбаре.
  ipcMain.handle(IPC.TAB_SHOW_MENU, (_e, id: string) => {
    if (!tabs || !win) return;
    const isPinned = tabs.isTabPinned(id);
    const groupId  = tabs.getTabGroupId(id);

    const items: MenuItemConstructorOptions[] = [
      {
        label: isPinned ? 'Открепить вкладку' : 'Закрепить вкладку',
        click: () => tabs!.togglePin(id),
      },
      { type: 'separator' },
    ];

    if (!isPinned) {
      if (groupId) {
        items.push({
          label: 'Убрать из группы',
          click: () => tabs!.removeTabFromGroup(groupId, id),
        });
      } else {
        items.push({
          label: 'Создать группу',
          click: () => tabs!.createGroup(id),
        });
      }

      // Подменю «Добавить в группу» — только если есть группы.
      const allGroups = collectGroups(tabs.sidebarNodesSnapshot());
      const otherGroups = allGroups.filter((g) => g.id !== groupId);
      if (otherGroups.length > 0) {
        items.push({
          label: 'Добавить в группу',
          submenu: otherGroups.map((g) => ({
            label: g.label || 'Группа',
            click: () => tabs!.addTabToGroup(g.id, id),
          })),
        });
      }

      items.push({ type: 'separator' });
    }

    items.push({
      label: 'Закрыть вкладку',
      enabled: !isPinned,
      click: () => tabs!.closeTab(id),
    });
    Menu.buildFromTemplate(items).popup({ window: win });
  });

  // Нативное ПКМ-меню заголовка группы.
  ipcMain.handle(IPC.GROUP_SHOW_MENU, (_e, groupId: string) => {
    if (!tabs || !win || !chromeView) return;
    const GROUP_COLORS: Array<{ label: string; value: string }> = [
      { label: 'Без цвета',   value: '' },
      { label: 'Красный',     value: 'red' },
      { label: 'Оранжевый',   value: 'orange' },
      { label: 'Жёлтый',      value: 'yellow' },
      { label: 'Зелёный',     value: 'green' },
      { label: 'Синий',       value: 'blue' },
      { label: 'Фиолетовый',  value: 'purple' },
    ];
    const items: MenuItemConstructorOptions[] = [
      {
        label: 'Переименовать',
        click: () => chromeView?.webContents.send(IPC.GROUP_RENAME_PROMPT, groupId),
      },
      {
        label: 'Цвет',
        submenu: GROUP_COLORS.map(({ label, value }) => ({
          label,
          click: () => tabs!.setGroupColor(groupId, value || null),
        })),
      },
      { type: 'separator' },
      {
        label: 'Свернуть / развернуть',
        click: () => tabs!.toggleGroupCollapse(groupId),
      },
      { type: 'separator' },
      {
        label: 'Расформировать группу',
        click: () => tabs!.disbandGroup(groupId),
      },
    ];
    Menu.buildFromTemplate(items).popup({ window: win });
  });

  // Группо-операции.
  ipcMain.handle(IPC.SIDEBAR_NODES_GET,      ()                                => tabs?.sidebarNodesSnapshot() ?? []);
  ipcMain.handle(IPC.GROUP_CREATE,           (_e, tabId: string)               => tabs?.createGroup(tabId));
  ipcMain.handle(IPC.GROUP_ADD_TAB,          (_e, gId: string, tabId: string)  => tabs?.addTabToGroup(gId, tabId));
  ipcMain.handle(IPC.GROUP_REMOVE_TAB,       (_e, gId: string, tabId: string)  => tabs?.removeTabFromGroup(gId, tabId));
  ipcMain.handle(IPC.GROUP_RENAME,           (_e, gId: string, label: string)  => tabs?.renameGroup(gId, label));
  ipcMain.handle(IPC.GROUP_COLOR,            (_e, gId: string, color: string | null) => tabs?.setGroupColor(gId, color));
  ipcMain.handle(IPC.GROUP_TOGGLE_COLLAPSE,  (_e, gId: string)                 => tabs?.toggleGroupCollapse(gId));
  ipcMain.handle(IPC.GROUP_DISBAND,          (_e, gId: string)                 => tabs?.disbandGroup(gId));
  ipcMain.handle(IPC.GROUP_REORDER_CHILDREN, (_e, gId: string, ids: string[])  => tabs?.reorderGroupChildren(gId, ids));
}

// Собирает GroupNode[] плоским списком из верхнего уровня дерева.
function collectGroups(nodes: SidebarNode[]): GroupNode[] {
  const groups: GroupNode[] = [];
  for (const node of nodes) {
    if (node.type === 'group') groups.push(node as GroupNode);
  }
  return groups;
}

// Внешние протоколы (mailto:, tel:) -> отдаём ОС, не показываем ошибку навигации.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (e, url) => {
    if (/^(mailto|tel):/i.test(url)) {
      e.preventDefault();
      shell.openExternal(url).catch(() => { /* тихо игнорируем */ });
    }
  });
});

app.whenReady().then(async () => {
  startT0 = Date.now();
  console.log(`[startup] preload=${EMBED_PRELOAD ? 'on' : 'off'}`);
  Menu.setApplicationMenu(null); // прячем дефолтное меню — у нас свой хром
  registerModelProtocol();
  registerChromeProtocol();

  if (GPU_TEST) {
    runIsolatedTestWindow('gputest.html', '[gputest]');
    return;
  }
  if (LLAMA_TEST) {
    // node-llama-cpp работает только в main-процессе — своё окно не нужно, только stdout.
    const { runLlamaTest } = await import('./llamatest');
    await runLlamaTest().catch((e: unknown) => console.error('[llamatest] FATAL', e));
    app.quit();
    return;
  }
  if (TRANSLATE_TEST) {
    await runTranslateTestWindow();
    return;
  }

  registerIpc();

  // История: нативный модуль может отсутствовать — падение не блокирует запуск.
  await history.initialize().catch((e) =>
    console.error('[History] инициализация упала:', e),
  );

  // Разрешения: та же гарантия — падение не блокирует старт, браузер работает без персистенции.
  await permissions.initialize().catch((e) =>
    console.error('[Permissions] инициализация упала:', e),
  );

  // Ghostery ставит свой onBeforeRequest внутри initialize().
  // try/catch: падение адблока не должно блокировать запуск браузера.
  try {
    await adblock.initialize((state) => {
      chromeView?.webContents.send(IPC.ADBLOCK_STATE_CHANGED, state);
    });
  } catch (e) {
    console.error('[AdBlock] инициализация упала, браузер работает без блокировки:', e);
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Синхронная запись перед выходом — никаких await, иначе процесс умрёт раньше.
// На Windows/Linux это уже избыточно (win.on('close') в createWindow успевает раньше и обнуляет
// tabs/sess), но на macOS Cmd+Q шлёт before-quit ДО закрытия окна — здесь ещё всё живо, это тот
// путь, где сработает эта подстраховка. Оставлено ради будущего macOS-порта (см. CLAUDE.md).
app.on('before-quit', () => {
  isShuttingDown = true; // macOS Cmd+Q путь — здесь ещё раньше, чем win.on('close') выше
  if (tabs && sess) sess.saveNow(tabs.getSessionSnapshot());
});
