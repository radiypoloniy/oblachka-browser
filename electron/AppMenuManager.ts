import { WebContentsView, ipcMain, screen } from 'electron';
import type { BrowserWindow } from 'electron';
import path from 'node:path';
import type { AppMenuItem } from '../shared/ipc';
import { closeWindowView } from './viewTeardown';

// ── Меню приложения ───────────────────────────────────────────────────────────
//
// ⚠️ ЗАЧЕМ СВОЁ МЕНЮ ВМЕСТО НАТИВНОГО. Контекстные меню и меню «⋯» рисовались через
// Menu.buildFromTemplate().popup() — то есть их рисует Windows. Ни один наш токен туда не
// доходит: ни материал, ни радиусы, ни шрифт, ни палитра. На цветной земле и в тёмной теме это
// выглядит как чужая программа посреди окна, и «поповеры не подчиняются общим законам» — ровно
// про них. Electron стилизовать нативное меню не даёт вовсе, поэтому единственный путь — рисовать
// своё, как это делают Chrome, Arc и все остальные.
//
// ⚠️ Меню живёт в СВОЕЙ WebContentsView, а не в слое хрома: оно обязано ложиться поверх страницы,
// а слой хрома лежит под вью вкладки в области контента — там меню обрезалось бы по её краю.
//
// ⚠️ Позиция — от курсора, как у нативного: меню открывается там, где человек нажал, а не там,
// где нам удобно. Экранные координаты переводим в оконные сами, потому что вью живёт в системе
// координат окна.

const SHADOW_MARGIN = 24; // прозрачный запас под тень — см. shared/overlayMetrics.ts
const MIN_WIDTH = 220;

interface MenuState {
  win: BrowserWindow;
  view: WebContentsView | null;
  loaded: boolean;
  open: boolean;
  /** Куда вернуть выбор: id пункта → действие. Живёт только пока меню открыто. */
  actions: Map<string, () => void>;
  anchor: { x: number; y: number };
  size: { width: number; height: number };
}

const menus = new Map<number, MenuState>();
let ipcRegistered = false;

function stateFor(win: BrowserWindow): MenuState {
  const found = menus.get(win.id);
  if (found) return found;
  const created: MenuState = {
    win, view: null, loaded: false, open: false,
    actions: new Map(), anchor: { x: 0, y: 0 }, size: { width: MIN_WIDTH, height: 40 },
  };
  menus.set(win.id, created);
  // Окно не уносит с собой дочерние вью — закрываем сами (разбор в viewTeardown.ts).
  win.once('closed', () => { closeWindowView(menus.get(win.id)?.view); menus.delete(win.id); });
  return created;
}

function stateBySender(sender: Electron.WebContents): MenuState | null {
  for (const st of menus.values()) if (st.view?.webContents === sender) return st;
  return null;
}

/** Раскладка: меню не должно вылезать за окно — при нехватке места отражаем от курсора. */
function layout(st: MenuState): void {
  if (!st.view) return;
  const bounds = st.win.getContentBounds();
  const w = st.size.width + SHADOW_MARGIN * 2;
  const h = st.size.height + SHADOW_MARGIN * 2;
  // ⚠️ Отражаем, а не прижимаем: прижатое меню накрывает точку клика, и человек теряет место,
  // по которому нажимал. Так же ведут себя системные меню.
  const x = st.anchor.x + st.size.width > bounds.width ? st.anchor.x - st.size.width : st.anchor.x;
  const y = st.anchor.y + st.size.height > bounds.height ? st.anchor.y - st.size.height : st.anchor.y;
  st.view.setBounds({
    x: Math.max(0, Math.round(x - SHADOW_MARGIN)),
    y: Math.max(0, Math.round(y - SHADOW_MARGIN)),
    width: Math.round(w),
    height: Math.round(h),
  });
}

function ensureIpc(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;

  ipcMain.on('app-menu:size', (e, size: { width: number; height: number }) => {
    const st = stateBySender(e.sender);
    if (!st) return;
    st.size = { width: Math.max(MIN_WIDTH, Math.round(size.width)), height: Math.max(1, Math.round(size.height)) };
    layout(st);
  });

  ipcMain.on('app-menu:pick', (e, id: string) => {
    const st = stateBySender(e.sender);
    if (!st) return;
    const action = st.actions.get(id);
    closeAppMenu(st.win);
    // ⚠️ Сначала закрываем, потом выполняем: действие может открыть другое окно или диалог, и
    // меню поверх него выглядело бы зависшим.
    action?.();
  });

  ipcMain.on('app-menu:close', (e) => {
    const st = stateBySender(e.sender);
    if (st) closeAppMenu(st.win);
  });
}

function ensureView(st: MenuState): WebContentsView {
  if (st.view) return st.view;
  ensureIpc();
  st.view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-appmenu.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });
  st.view.setBackgroundColor('#00000000');
  st.view.webContents.loadURL('oblako-chrome://localhost/appmenu.html');
  st.view.webContents.once('did-finish-load', () => { st.loaded = true; });
  return st.view;
}

/** Пункты в том виде, в каком их рисует вью: без функций, только данные. */
function toSpec(items: AppMenuItem[], actions: Map<string, () => void>, prefix = 'i'): AppMenuItem[] {
  return items.map((item, i) => {
    const id = `${prefix}${i}`;
    if (item.click) actions.set(id, item.click);
    return {
      ...item,
      id,
      click: undefined,
      submenu: item.submenu ? toSpec(item.submenu, actions, `${id}-`) : undefined,
    };
  });
}

/**
 * Показать меню в точке курсора.
 *
 * ⚠️ Действия НЕ пересекают IPC: наружу уходят только подписи и идентификаторы, а функции
 * остаются здесь, в main. Иначе меню превратилось бы в канал исполнения произвольных замыканий по
 * идентификатору из рендерера.
 */
export function showAppMenu(win: BrowserWindow, items: AppMenuItem[]): void {
  const st = stateFor(win);
  st.actions.clear();
  const spec = toSpec(items, st.actions);

  const cursor = screen.getCursorScreenPoint();
  const content = win.getContentBounds();
  st.anchor = { x: cursor.x - content.x, y: cursor.y - content.y };
  st.open = true;

  const view = ensureView(st);
  layout(st);
  if (!win.contentView.children.includes(view)) win.contentView.addChildView(view);
  const send = () => view.webContents.send('app-menu:show', spec);
  if (st.loaded) send();
  else view.webContents.once('did-finish-load', send);
}

export function closeAppMenu(win: BrowserWindow): void {
  const st = menus.get(win.id);
  if (!st?.view || !st.open) return;
  st.open = false;
  st.actions.clear();
  // Вью не уничтожаем — меню открывают часто, а создание вью стоит кадра. Просто убираем со сцены.
  if (win.contentView.children.includes(st.view)) win.contentView.removeChildView(st.view);
}

/**
 * Перевод шаблона Electron в наши пункты.
 *
 * ⚠️ Существует ради того, чтобы НЕ ПЕРЕПИСЫВАТЬ четыре готовых меню: их содержимое собрано с
 * логикой (подменю папок, состояния перевода, отслеживание цены), и переносить эту логику вручную
 * значило бы завести пятое место, где она может разойтись. Адаптер меняет только оболочку.
 *
 * ⚠️ Роли (role: 'copy' и подобные) сюда НЕ проходят: их исполняет сам Chromium в нативном меню, и
 * у нашего меню такого канала нет. Места с ролями переводятся отдельно, с явными действиями через
 * webContents — иначе пункт молча ничего не делал бы.
 */
export function fromTemplate(items: Electron.MenuItemConstructorOptions[]): AppMenuItem[] {
  return items.map((item) => ({
    type: item.type === 'separator' ? 'separator' : 'item',
    label: typeof item.label === 'string' ? item.label : '',
    enabled: item.enabled,
    checked: item.checked,
    click: typeof item.click === 'function' ? () => (item.click as () => void)() : undefined,
    submenu: Array.isArray(item.submenu) ? fromTemplate(item.submenu) : undefined,
  }));
}
