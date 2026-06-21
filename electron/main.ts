import { app, BrowserWindow, WebContentsView, ipcMain, Menu, shell, session } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import { TabManager } from './TabManager';
import { SessionManager } from './SessionManager';
import { AdBlockManager } from './AdBlockManager';
import { IPC } from '../shared/ipc';
import type { ContentBounds, TitleBarOpts, FindResult } from '../shared/ipc';

const isDev = process.env.NODE_ENV === 'development';
const DEV_URL = 'http://localhost:5173';

let win: BrowserWindow | null = null;
let chromeView: WebContentsView | null = null; // слой нашего React-хрома
let tabs: TabManager | null = null;
let sess: SessionManager | null = null;
const adblock = new AdBlockManager();

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

  // Загружаем сохранённую сессию ДО создания TabManager.
  sess = new SessionManager();
  const restored = sess.load();

  // При любом изменении: обновляем UI и планируем сохранение сессии.
  // scheduleSave молча игнорирует вызовы до sess.enable() — это защита
  // от затирания: onChange стреляет во время restore, но сохранять ещё нельзя.
  tabs = new TabManager(
    win,
    () => {
      chromeView?.webContents.send(IPC.TABS_CHANGED, tabs!.snapshot());
      sess!.scheduleSave(() => tabs!.snapshot(), () => tabs!.getActiveId());
    },
    (r: FindResult) => chromeView?.webContents.send(IPC.FIND_RESULT, r),
    ()              => chromeView?.webContents.send(IPC.FIND_OPEN),
    ()              => chromeView?.webContents.send(IPC.FIND_CLOSE),
    ()              => chromeView?.webContents.send(IPC.OMNIBOX_FOCUS),
    ()              => chromeView?.webContents.focus(),
  );

  // Восстанавливаем вкладки из session.json.
  if (restored) {
    // Закреплённые сначала — их порядок стабилен и они всегда вверху сайдбара.
    const pinnedIds: string[] = [];
    for (const { url } of restored.pinnedTabs) {
      pinnedIds.push(tabs.createPinnedTab(url));
    }
    const normalIds: string[] = [];
    for (const { url } of restored.tabs) {
      normalIds.push(tabs.createTab(url, /* background */ true));
    }

    // Восстанавливаем активную вкладку по типу + индексу.
    let targetId: string | undefined;
    if (restored.activeTabType === 'pinned') {
      targetId = pinnedIds[restored.activeTabIndex];
    } else if (restored.activeTabType === 'normal') {
      targetId = normalIds[restored.activeTabIndex];
    }
    // 'hub' или индекс вне диапазона — остаёмся на хабе (дефолт TabManager).
    if (targetId) tabs.activate(targetId);
  }

  // Только после восстановления разрешаем автосейв.
  sess.enable();

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

  if (isDev) {
    chromeView.webContents.loadURL(DEV_URL);
    chromeView.webContents.openDevTools({ mode: 'detach' });
  } else {
    chromeView.webContents.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  win.on('closed', () => {
    win = null; chromeView = null; tabs = null; sess = null;
  });
}

// ── IPC: renderer (хром) управляет движком вкладок ──
function registerIpc() {
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

  // AdBlock
  ipcMain.handle(IPC.ADBLOCK_GET_STATE,      ()                    => adblock.getState());
  ipcMain.handle(IPC.ADBLOCK_SET_ENABLED,    (_e, v: boolean)      => adblock.setEnabled(v));
  ipcMain.handle(IPC.ADBLOCK_ADD_DOMAIN,     (_e, d: string)       => adblock.addDomain(d));
  ipcMain.handle(IPC.ADBLOCK_REMOVE_DOMAIN,  (_e, d: string)       => adblock.removeDomain(d));
  ipcMain.handle(IPC.ADBLOCK_RELOAD_TABS,    (_e, d?: string)      => tabs?.reloadTabsForDomain(d));

  // Нативное ПКМ-меню вкладки в сайдбаре: Закрепить / Открепить.
  ipcMain.handle(IPC.TAB_SHOW_MENU, (_e, id: string) => {
    if (!tabs || !win) return;
    const isPinned = tabs.isTabPinned(id);
    const items: MenuItemConstructorOptions[] = [
      {
        label: isPinned ? 'Открепить вкладку' : 'Закрепить вкладку',
        click: () => tabs!.togglePin(id),
      },
      { type: 'separator' },
      {
        label: 'Закрыть вкладку',
        enabled: !isPinned, // закреплённую через меню тоже нельзя закрыть
        click: () => tabs!.closeTab(id),
      },
    ];
    Menu.buildFromTemplate(items).popup({ window: win });
  });
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
  Menu.setApplicationMenu(null); // прячем дефолтное меню — у нас свой хром
  registerIpc();

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
app.on('before-quit', () => {
  if (tabs && sess) sess.saveNow(tabs.snapshot(), tabs.getActiveId());
});
