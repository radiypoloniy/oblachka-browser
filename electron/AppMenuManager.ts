import { BrowserWindow, ipcMain, screen } from 'electron';
import path from 'node:path';
import type { AppMenuItem } from '../shared/ipc';

// ── Меню приложения ───────────────────────────────────────────────────────────
//
// ⚠️ ЗАЧЕМ СВОЁ МЕНЮ. Контекстные меню и меню «⋯» рисовались через Menu.buildFromTemplate().popup(),
// то есть их рисует Windows. Ни один наш токен туда не доходит — ни материал, ни радиусы, ни
// шрифт, ни палитра, — и посреди окна оказывалась карточка из другой программы. Electron
// стилизовать нативное меню не позволяет вовсе, поэтому своё рисуют все: Chrome, Arc, VS Code.
//
// ⚠️ ЭТО ОТДЕЛЬНОЕ ОКНО, А НЕ WebContentsView, и первая версия на вью была ошибкой сразу по трём
// причинам:
//  • вью живёт ВНУТРИ окна — меню у нижнего или правого края обрезалось бы по его границе, а
//    системное меню в этом месте просто выходит за окно;
//  • вью не знает о кликах МИМО себя: клик по странице приходит в другой процесс, и меню
//    оставалось висеть, пока в него не ткнут;
//  • размер вью задаётся до того, как содержимое измерено, — на первом кадре карточка резалась по
//    прямоугольнику вью (ровно то, что было видно на скриншоте: обрезанный пункт и серое поле).
//
// Конструкция повторяет дропдаун омнибокса (SuggestDropdownManager) — она в проекте уже проверена:
// дочернее окно без рамы, прозрачное, без системной тени (её рисует сама карточка).
//
// ⚠️ В отличие от дропдауна, меню ЗАБИРАЕТ ФОКУС (focusable: true) — и это осознанно. Меню
// модально по смыслу: Esc и стрелки обязаны работать, а закрытие по blur — единственный надёжный
// способ поймать «кликнул куда-то ещё», включая клики по странице и по другому приложению.

const SHADOW_MARGIN = 24; // прозрачный запас под тень — см. shared/overlayMetrics.ts
const MIN_WIDTH = 200;

interface MenuState {
  owner: BrowserWindow;
  popup: BrowserWindow | null;
  loaded: boolean;
  /** Идентификатор пункта → действие. Живёт только пока меню открыто. */
  actions: Map<string, () => void>;
  /** Экранные координаты точки, в которой человек нажал. */
  anchor: { x: number; y: number };
}

const menus = new Map<number, MenuState>();
let ipcRegistered = false;

function stateFor(owner: BrowserWindow): MenuState {
  const found = menus.get(owner.id);
  if (found) return found;
  const created: MenuState = { owner, popup: null, loaded: false, actions: new Map(), anchor: { x: 0, y: 0 } };
  menus.set(owner.id, created);
  owner.once('closed', () => {
    const st = menus.get(owner.id);
    if (st?.popup && !st.popup.isDestroyed()) st.popup.destroy();
    menus.delete(owner.id);
  });
  return created;
}

function stateBySender(sender: Electron.WebContents): MenuState | null {
  for (const st of menus.values()) if (st.popup?.webContents === sender) return st;
  return null;
}

function ensureIpc(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;

  // Размер приходит ПОСЛЕ отрисовки: main не знает, сколько места займут подписи.
  ipcMain.on('app-menu:size', (e, size: { width: number; height: number }) => {
    const st = stateBySender(e.sender);
    if (!st?.popup || st.popup.isDestroyed()) return;
    place(st, size);
    if (!st.popup.isVisible()) {
      // ⚠️ Показываем ТОЛЬКО здесь — когда размер уже известен и окно поставлено на место.
      // Показ до измерения давал кадр с обрезанной карточкой и серым полем вокруг неё.
      st.popup.showInactive();
      st.popup.focus();
    }
  });

  ipcMain.on('app-menu:pick', (e, id: string) => {
    const st = stateBySender(e.sender);
    if (!st) return;
    const action = st.actions.get(id);
    closeAppMenu(st.owner);
    // Сначала закрываем, потом выполняем: действие может открыть окно или диалог, и меню поверх
    // него выглядело бы зависшим.
    action?.();
  });

  ipcMain.on('app-menu:close', (e) => {
    const st = stateBySender(e.sender);
    if (st) closeAppMenu(st.owner);
  });
}

/** Поставить окно так, чтобы меню целиком помещалось на экране. */
function place(st: MenuState, size: { width: number; height: number }): void {
  if (!st.popup || st.popup.isDestroyed()) return;
  const width = Math.round(Math.max(MIN_WIDTH, size.width)) + SHADOW_MARGIN * 2;
  const height = Math.round(Math.max(1, size.height)) + SHADOW_MARGIN * 2;
  const area = screen.getDisplayNearestPoint(st.anchor).workArea;

  // ⚠️ Отражаем от точки клика, а не прижимаем к краю: прижатое меню накрывает место, по которому
  // человек нажал. Так же ведут себя системные меню.
  let x = st.anchor.x - SHADOW_MARGIN;
  let y = st.anchor.y - SHADOW_MARGIN;
  if (x + width > area.x + area.width) x = st.anchor.x - width + SHADOW_MARGIN;
  if (y + height > area.y + area.height) y = st.anchor.y - height + SHADOW_MARGIN;

  st.popup.setBounds({
    x: Math.round(Math.max(area.x, x)),
    y: Math.round(Math.max(area.y, y)),
    width,
    height,
  });
}

function ensurePopup(st: MenuState): BrowserWindow {
  if (st.popup && !st.popup.isDestroyed()) return st.popup;
  ensureIpc();
  const popup = new BrowserWindow({
    parent: st.owner,
    frame: false,
    transparent: true,
    // Тень рисует сама карточка: системная легла бы по прямоугольнику окна, то есть по прозрачному
    // запасу вокруг неё.
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-appmenu.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });
  st.popup = popup;
  popup.setMenuBarVisibility(false);
  // Меню никуда не навигирует само; если что-то попробует — окно UI не должно стать страницей.
  popup.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('oblako-chrome://')) e.preventDefault();
  });
  popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // ⚠️ Закрытие по потере фокуса — единственный надёжный способ поймать «кликнул куда-то ещё»:
  // клик по странице или по другому приложению до рендерера меню не доходит вовсе.
  popup.on('blur', () => closeAppMenu(st.owner));
  popup.webContents.once('did-finish-load', () => { st.loaded = true; });
  void popup.loadURL('oblako-chrome://localhost/appmenu.html');
  return popup;
}

/** Пункты в том виде, в каком их рисует окно меню: без функций, только данные. */
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
 * ⚠️ Действия НЕ пересекают IPC: наружу уходят только подписи и идентификаторы, функции остаются
 * здесь. Иначе меню стало бы каналом исполнения произвольных замыканий по строке из рендерера.
 */
export function showAppMenu(owner: BrowserWindow, items: AppMenuItem[]): void {
  const st = stateFor(owner);
  st.actions.clear();
  const spec = toSpec(items, st.actions);
  st.anchor = screen.getCursorScreenPoint();

  const popup = ensurePopup(st);
  const send = () => popup.webContents.send('app-menu:show', spec);
  if (st.loaded) send();
  else popup.webContents.once('did-finish-load', send);
}

export function closeAppMenu(owner: BrowserWindow): void {
  const st = menus.get(owner.id);
  if (!st?.popup || st.popup.isDestroyed() || !st.popup.isVisible()) return;
  st.actions.clear();
  st.popup.hide();
}

/**
 * Перевод шаблона Electron в наши пункты.
 *
 * ⚠️ Существует ради того, чтобы НЕ ПЕРЕПИСЫВАТЬ готовые меню: их содержимое собрано с логикой
 * (подменю папок, состояния перевода, отслеживание цены), и переносить её вручную значило бы
 * завести второе место, где она может разойтись. Адаптер меняет только оболочку.
 *
 * ⚠️ Роли (role: 'copy' и подобные) сюда не проходят: их исполняет сам Chromium в нативном меню.
 * Места с ролями переводятся отдельно, с явными действиями через webContents, иначе пункт молча
 * ничего не сделает.
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
