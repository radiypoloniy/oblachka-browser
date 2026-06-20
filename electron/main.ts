import { app, BrowserWindow, WebContentsView, ipcMain, Menu, shell } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import { TabManager } from './TabManager';
import { SessionManager } from './SessionManager';
import { IPC } from '../shared/ipc';
import type { ContentBounds, TitleBarOpts, FindResult } from '../shared/ipc';

const isDev = process.env.NODE_ENV === 'development';
const DEV_URL = 'http://localhost:5173';

let win: BrowserWindow | null = null;
let chromeView: WebContentsView | null = null; // слой нашего React-хрома
let tabs: TabManager | null = null;
let session: SessionManager | null = null;

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
  session = new SessionManager();
  const restored = session.load();

  // При любом изменении: обновляем UI и планируем сохранение сессии.
  // scheduleSave молча игнорирует вызовы до session.enable() — это защита
  // от затирания: onChange стреляет во время restore, но сохранять ещё нельзя.
  tabs = new TabManager(
    win,
    () => {
      chromeView?.webContents.send(IPC.TABS_CHANGED, tabs!.snapshot());
      session!.scheduleSave(() => tabs!.snapshot(), () => tabs!.getActiveId());
    },
    (r: FindResult) => chromeView?.webContents.send(IPC.FIND_RESULT, r),
    ()              => chromeView?.webContents.send(IPC.FIND_OPEN),
    ()              => chromeView?.webContents.send(IPC.FIND_CLOSE),
    ()              => chromeView?.webContents.send(IPC.OMNIBOX_FOCUS),
    ()              => chromeView?.webContents.focus(),
  );

  // Восстанавливаем вкладки из session.json.
  if (restored && restored.tabs.length > 0) {
    const restoredIds: string[] = [];
    for (const { url } of restored.tabs) {
      restoredIds.push(tabs.createTab(url));
    }
    const targetId = restoredIds[restored.activeTabIndex];
    if (targetId) tabs.activate(targetId);
  }

  // Только после восстановления разрешаем автосейв.
  session.enable();

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
    win = null; chromeView = null; tabs = null; session = null;
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

app.whenReady().then(() => {
  Menu.setApplicationMenu(null); // прячем дефолтное меню — у нас свой хром
  registerIpc();
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
  if (tabs && session) session.saveNow(tabs.snapshot(), tabs.getActiveId());
});
