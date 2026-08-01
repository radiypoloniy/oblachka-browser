// Зоны дропа при перетаскивании вкладки — прозрачная WebContentsView поверх страницы.
//
// ⚠️ Зачем отдельная вью, а не разметка в чроме. Нативная вью страницы лежит ПОВЕРХ React-слоя,
// поэтому всё, что чром рисует в области контента, физически не видно (тот же закон, что у
// FindBar, поповеров и окон веб-приложений графа). Первая версия подсказки рисовалась в App.tsx
// и была невидима — отсюда «никаких указателей не увидел».
//
// ⚠️ Зачем main следит за курсором. Как только указатель уходит с сайдбара на страницу, чром
// перестаёт получать pointermove — их забирает нативная вью. Renderer видел только последнюю
// позицию у самой кромки контента, то есть всегда «край», и дроп всегда получался разделением
// экрана. Поэтому зону считает main по screen.getCursorScreenPoint(), пока идёт перетаскивание.
// Опрос живёт РОВНО столько, сколько тянут вкладку.
import { WebContentsView, screen } from 'electron';
import type { BrowserWindow } from 'electron';
import path from 'node:path';
import type { ContentBounds, TabDropZone } from '../shared/ipc';
import { contextForWindow } from './WindowRegistry';

// Что подсвечивать во вью. Стороны разделены только ради картинки: подсвечивать оба края разом
// и писать подпись дважды — врать про то, куда именно попадёт вкладка.
type ZoneVisual = 'split-left' | 'split-right' | 'window';

// Доля ширины контента с каждого края, отданная разделению экрана. Остаток посередине — новое
// окно. Так же разводят эти два жеста браузеры с вертикальными вкладками и сплитом.
const SPLIT_EDGE_RATIO = 0.35;
// Шаг опроса курсора. 30 мс — незаметно для глаза и дёшево: интервал живёт только во время драга.
const POLL_MS = 30;

interface WindowDropZones {
  win: BrowserWindow;
  view: WebContentsView | null;
  content: ContentBounds;
  timer: NodeJS.Timeout | null;
  zone: ZoneVisual | null;
}

const perWindow = new Map<number, WindowDropZones>();

function stateFor(win: BrowserWindow): WindowDropZones {
  const existing = perWindow.get(win.id);
  if (existing) return existing;
  const created: WindowDropZones = {
    win, view: null, content: { x: 0, y: 0, width: 0, height: 0 }, timer: null, zone: null,
  };
  perWindow.set(win.id, created);
  win.once('closed', () => {
    const st = perWindow.get(win.id);
    if (st?.timer) clearInterval(st.timer);
    perWindow.delete(win.id);
  });
  return created;
}

// Та же геометрия контентной зоны, что двигает FindBar (см. CONTENT_SET_BOUNDS): она уже
// учитывает сайдбар и панели, main сам этого из getContentBounds() не знает.
export function syncDropZoneBounds(win: BrowserWindow, b: ContentBounds): void {
  stateFor(win).content = b;
}

function ensureView(st: WindowDropZones): WebContentsView {
  if (st.view) return st.view;
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-dropzones.js'),
      contextIsolation: true,
      sandbox: false, // preload использует ipcRenderer
    },
  });
  st.view = view;
  // Прозрачность обязательна на самой вью, не только в CSS — иначе поверх страницы висел бы
  // непрозрачный прямоугольник (тот же инвариант, что у FindBar и поповеров).
  view.setBackgroundColor('#00000000');
  view.webContents.loadURL('oblako-chrome://localhost/dropzones.html');
  return view;
}

// Курсор в координатах контентной зоны — или null, если он вне окна.
function cursorInContent(st: WindowDropZones): { x: number; y: number } | null {
  if (st.win.isDestroyed()) return null;
  const cursor = screen.getCursorScreenPoint();
  const wb = st.win.getContentBounds();
  if (cursor.x < wb.x || cursor.x > wb.x + wb.width || cursor.y < wb.y || cursor.y > wb.y + wb.height) {
    return null;
  }
  return { x: cursor.x - wb.x, y: cursor.y - wb.y };
}

function zoneNow(st: WindowDropZones): ZoneVisual | null {
  const p = cursorInContent(st);
  // Курсор вообще вне окна — это по-прежнему «вынести в окно»: привычный жест на нескольких
  // мониторах, и он не должен исчезнуть из-за появления зон.
  if (!p) return 'window';
  const c = st.content;
  if (p.x < c.x || p.x > c.x + c.width || p.y < c.y || p.y > c.y + c.height) return null; // сайдбар/тулбар
  const edge = c.width * SPLIT_EDGE_RATIO;
  if (p.x < c.x + edge) return 'split-left';
  if (p.x > c.x + c.width - edge) return 'split-right';
  return 'window';
}

// Наружу отдаём ДЕЙСТВИЕ, а не картинку: сайдбару всё равно, за какой край тянули.
function toAction(z: ZoneVisual | null): TabDropZone | null {
  return z === null ? null : z === 'window' ? 'window' : 'split';
}

// Начало перетаскивания вкладки: показываем зоны и начинаем следить за курсором.
export function startTabDrag(win: BrowserWindow): void {
  const st = stateFor(win);
  if (st.content.width === 0 || st.content.height === 0) return; // контента нет (настройки/история)
  const view = ensureView(st);
  // ⚠️ Страж фокуса, как у выпадашки подсказок: новая вью на экране норовит забрать фокус
  // (electron/electron#42922 не даёт это запретить), а вместе с ним оборвалось бы само
  // перетаскивание — оно живёт на захвате указателя в слое хрома.
  const chrome = contextForWindow(win)?.chromeView;
  if (chrome && !view.webContents.listenerCount('focus')) {
    view.webContents.on('focus', () => {
      setImmediate(() => { if (!chrome.webContents.isDestroyed()) chrome.webContents.focus(); });
    });
  }
  view.setBounds({ x: st.content.x, y: st.content.y, width: st.content.width, height: st.content.height });
  if (!win.contentView.children.includes(view)) {
    win.contentView.addChildView(view); // последней → поверх нативной вью страницы
  }
  // ⚠️ Никакого view.webContents.focus(): фокус обязан остаться в чроме, иначе перетаскивание
  // оборвётся на полуслове (тот же инвариант, что у выпадашки подсказок).
  const push = () => {
    const zone = zoneNow(st);
    if (zone === st.zone) return;
    st.zone = zone;
    if (!view.webContents.isDestroyed()) view.webContents.send('dropzones:zone', zone);
  };
  st.zone = null;
  push();
  if (st.timer) clearInterval(st.timer);
  st.timer = setInterval(push, POLL_MS);
}

// Конец перетаскивания: прячем зоны и отдаём последнюю посчитанную — по ней сайдбар и решает,
// что сделать (разделить экран, вынести в окно или просто переупорядочить).
export function endTabDrag(win: BrowserWindow): TabDropZone | null {
  const st = perWindow.get(win.id);
  if (!st) return null;
  if (st.timer) { clearInterval(st.timer); st.timer = null; }
  // Пересчитываем на месте: последний тик мог быть до 30 мс назад, а решает именно точка отпускания.
  const zone = toAction(zoneNow(st));
  st.zone = null;
  if (st.view && !st.win.isDestroyed() && st.win.contentView.children.includes(st.view)) {
    try { st.win.contentView.removeChildView(st.view); } catch { /* окно могло закрыться */ }
  }
  return zone;
}
