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
import { IPC } from '../shared/ipc';
import type { ContentBounds, DragCard, SplitSwapHint, TabDropResult, TabDropZone } from '../shared/ipc';
import { contextForWindow, allContexts } from './WindowRegistry';

// Что подсвечивать во вью. Стороны разделены только ради картинки: подсвечивать оба края разом
// и писать подпись дважды — врать про то, куда именно попадёт вкладка.
//
// 'adopt' — курсор ушёл на ДРУГОЕ окно Oblako, и вкладка переедет в него. Подсветка при этом
// рисуется в окне-приёмнике, а не в окне-источнике: человек смотрит туда, куда тащит.
type ZoneVisual = 'split-left' | 'split-right' | 'window' | 'adopt';

// Доля ширины контента с каждого края, отданная разделению экрана. Остаток посередине — новое
// окно. Так же разводят эти два жеста браузеры с вертикальными вкладками и сплитом.
const SPLIT_EDGE_RATIO = 0.35;
// Шаг опроса курсора. 30 мс — незаметно для глаза и дёшево: интервал живёт только во время драга.
const POLL_MS = 30;

interface WindowDropZones {
  win: BrowserWindow;
  view: WebContentsView | null;
  content: ContentBounds;
}

const perWindow = new Map<number, WindowDropZones>();

// Перетаскивание идёт ровно одно на всё приложение — мышь одна. Поэтому его состояние живёт
// здесь, а не в записи окна: в ходе одного жеста участвуют ДВА окна (откуда тащат и куда), и
// «чей это драг» иначе пришлось бы выяснять на каждом тике.
interface ActiveDrag {
  source: WindowDropZones;
  // Окно, в котором сейчас показан оверлей: своё при обычном дропе, чужое — при переносе в него.
  shown: WindowDropZones | null;
  zone: ZoneVisual | null;
  // Окно-приёмник для 'adopt'. Держим отдельно от shown: shown обнуляется при снятии оверлея,
  // а решение об исходе принимается в момент отпускания.
  target: WindowDropZones | null;
  timer: NodeJS.Timeout | null;
  // Что человек несёт в руке: оверлей рисует этим карточку под курсором (над областью контента
  // чром не виден, см. setSwapHint — жест половины сплита устроен так же). null — тащат папку,
  // у неё одной страницы нет.
  card: DragCard | null;
}

let drag: ActiveDrag | null = null;

function stateFor(win: BrowserWindow): WindowDropZones {
  const existing = perWindow.get(win.id);
  if (existing) return existing;
  const created: WindowDropZones = {
    win, view: null, content: { x: 0, y: 0, width: 0, height: 0 },
  };
  perWindow.set(win.id, created);
  win.once('closed', () => {
    // Окно закрылось посреди жеста — драг обрывается вместе с ним, иначе таймер продолжил бы
    // опрашивать курсор и слать сообщения в уничтоженную вью.
    if (drag && (drag.source.win.id === win.id || drag.shown?.win.id === win.id)) stopDrag();
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

// Курсор в координатах окна — или null, если он вне его.
function cursorInWindow(st: WindowDropZones): { x: number; y: number } | null {
  if (st.win.isDestroyed() || st.win.isMinimized()) return null;
  const cursor = screen.getCursorScreenPoint();
  const wb = st.win.getContentBounds();
  if (cursor.x < wb.x || cursor.x > wb.x + wb.width || cursor.y < wb.y || cursor.y > wb.y + wb.height) {
    return null;
  }
  return { x: cursor.x - wb.x, y: cursor.y - wb.y };
}

// Какое окно Oblako сейчас под курсором. Своё проверяем первым: при перекрытии окон человек,
// не уводивший мышь со своего окна, ожидает обычного исхода, а не переноса.
// ⚠️ Настоящего порядка окон по глубине Electron не отдаёт, поэтому среди ЧУЖИХ берём первое
// подходящее. Ошибка возможна только когда два окна лежат друг на друге и курсор попал в
// пересечение — там же, где и человеку не очевидно, куда он целится.
function windowUnderCursor(source: WindowDropZones): WindowDropZones | null {
  if (cursorInWindow(source)) return source;
  for (const ctx of allContexts()) {
    if (ctx.win.id === source.win.id) continue;
    const st = stateFor(ctx.win);
    if (cursorInWindow(st)) return st;
  }
  return null;
}

// Зона внутри СВОЕГО окна: край контента — разделить экран, середина — новое окно, шапка и
// сайдбар — обычное переупорядочивание.
function zoneInSource(st: WindowDropZones): ZoneVisual | null {
  const p = cursorInWindow(st);
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
  if (z === null) return null;
  if (z === 'adopt') return 'adopt';
  return z === 'window' ? 'window' : 'split';
}

// Показать оверлей в окне (своём или принимающем) и погасить его там, где он был до этого.
// full — накрыть ВСЁ окно, а не только область контента. Нужно перетаскиванию половины сплита:
// карточку в руке носят и над сайдбаром, и над тулбаром, а нарисовать её там мог бы только чром —
// который лежит ПОД нативными вьюхами страниц, и низ карточки уходил бы под страницу. Вью-оверлей
// лежит поверх всего, поэтому на время жеста он и растягивается на окно.
function showOverlayIn(st: WindowDropZones, full = false): void {
  if (st.content.width === 0 || st.content.height === 0) return; // контента нет (настройки/история)
  const view = ensureView(st);
  // ⚠️ Страж фокуса, как у выпадашки подсказок: новая вью на экране норовит забрать фокус
  // (electron/electron#42922 не даёт это запретить), а вместе с ним оборвалось бы само
  // перетаскивание — оно живёт на захвате указателя в слое хрома.
  const chrome = contextForWindow(st.win)?.chromeView;
  if (chrome && !view.webContents.listenerCount('focus')) {
    view.webContents.on('focus', () => {
      setImmediate(() => { if (!chrome.webContents.isDestroyed()) chrome.webContents.focus(); });
    });
  }
  const wb = st.win.getContentBounds();
  view.setBounds(full
    ? { x: 0, y: 0, width: wb.width, height: wb.height }
    : { x: st.content.x, y: st.content.y, width: st.content.width, height: st.content.height });
  if (!st.win.contentView.children.includes(view)) {
    st.win.contentView.addChildView(view); // последней → поверх нативной вью страницы
  }
  // ⚠️ Никакого view.webContents.focus(): фокус обязан остаться в чроме, иначе перетаскивание
  // оборвётся на полуслове (тот же инвариант, что у выпадашки подсказок).
}

function hideOverlayIn(st: WindowDropZones | null): void {
  if (!st?.view || st.win.isDestroyed()) return;
  if (!st.win.contentView.children.includes(st.view)) return;
  try { st.win.contentView.removeChildView(st.view); } catch { /* окно могло закрыться */ }
}

function sendZone(st: WindowDropZones | null, zone: ZoneVisual | null): void {
  const wc = st?.view?.webContents;
  if (wc && !wc.isDestroyed()) wc.send('dropzones:zone', zone);
}

function sendSwapHint(st: WindowDropZones | null, hint: SplitSwapHint | null): void {
  const wc = st?.view?.webContents;
  if (wc && !wc.isDestroyed()) wc.send('dropzones:swap', hint);
}

// Подсветка панели-ЦЕЛИ, пока половину сплита тащат за её шапку. Второй жест на том же оверлее —
// но БЕЗ опроса курсора: этот драг держит указатель через setPointerCapture, и зону считает сам
// чром (см. shared/ipc.ts::SplitSwapHint). Отсюда наружу нужна ровно одна услуга — «нарисуй вот
// этот прямоугольник поверх страницы», потому что чром над областью контента не виден.
//
// ⚠️ Пока идёт перетаскивание вкладки (startTabDrag), подсветку не трогаем: мышь одна, два жеста
// одновременно невозможны, а вот перебить чужой оверлей на полпути — вполне.
export function setSwapHint(win: BrowserWindow, hint: SplitSwapHint | null): void {
  if (drag) return;
  const st = stateFor(win);
  if (!hint) {
    // Гасим ПЕРЕД снятием вью: она переживает жест и в следующий раз показалась бы с прошлой
    // подсветкой ещё до первого сообщения (тот же порядок, что в updateDrag).
    sendSwapHint(st, null);
    setSwapCursor(win, null);
    hideOverlayIn(st);
    return;
  }
  showOverlayIn(st, true); // на всё окно: карточку носят и над сайдбаром, и над тулбаром
  // Вью переживает жесты, поэтому обнуляем ВСЁ, что могло остаться с прошлого раза: и чужую
  // подсветку, и позицию призрака (иначе он на один кадр мелькнёт там, где его отпустили).
  sendZone(st, null);
  setSwapCursor(win, null);
  sendSwapHint(st, hint);
}

// Курсор для карточки, которая едет ПОВЕРХ страницы (чром там не виден). Поток на каждый кадр
// драга — поэтому ничего, кроме пересылки: решения принимает renderer, вью только рисует.
export function setSwapCursor(win: BrowserWindow, pos: { x: number; y: number } | null): void {
  sendCursor(perWindow.get(win.id) ?? null, pos);
}

function sendCursor(st: WindowDropZones | null, pos: { x: number; y: number } | null): void {
  const wc = st?.view?.webContents;
  if (wc && !wc.isDestroyed()) wc.send('dropzones:cursor', pos);
}

// Перетаскивание ВКЛАДКИ: размер области контента (он же размер оверлея — зоны рисуются в нём) и
// что нести в руке. Размер уходит явно, потому что по нему оверлей считает доли зон, а курсор
// приходит уже пересчитанным в ту же систему координат.
function sendTabDrag(
  st: WindowDropZones | null,
  payload: { width: number; height: number; card: DragCard | null } | null,
): void {
  const wc = st?.view?.webContents;
  if (wc && !wc.isDestroyed()) wc.send('dropzones:tab', payload);
}

// Снимок несомой панели — та же карточка, что чром рисует над собой. Приходит позже подсветки
// (capturePage ждёт кадр), поэтому отдельным сообщением, а не полем в hint: иначе снимок в
// сто килобайт улетал бы заново на каждую смену зоны.
export function setSwapThumb(win: BrowserWindow, thumb: string | null): void {
  const wc = perWindow.get(win.id)?.view?.webContents;
  if (wc && !wc.isDestroyed()) wc.send('dropzones:thumb', thumb);
}

// Один тик слежения: где курсор, что из этого следует и в каком окне это рисовать.
function updateDrag(): void {
  if (!drag) return;
  const under = windowUnderCursor(drag.source);
  // Курсор вне любого окна Oblako — по-прежнему «вынести в новое окно»: привычный жест на
  // нескольких мониторах, и он не должен исчезнуть из-за появления зон.
  const overSource = under === null || under === drag.source;
  const shouldShowIn = overSource ? drag.source : under;
  const zone: ZoneVisual | null = overSource
    ? (under === null ? 'window' : zoneInSource(drag.source))
    : 'adopt';

  drag.target = overSource ? null : under;

  if (drag.shown !== shouldShowIn) {
    // Гасим подсветку на прежнем окне ПЕРЕД снятием: вью переживает драг и в следующий раз
    // показалась бы с чужой подсветкой ещё до первого тика.
    sendZone(drag.shown, null);
    sendTabDrag(drag.shown, null);
    hideOverlayIn(drag.shown);
    // ⚠️ Оверлей этого жеста накрывает ТОЛЬКО область контента, в отличие от жеста половины сплита
    // (см. setSwapHint). И это не мелочь: перетаскивание вкладки живёт на dnd-kit, а тот держится
    // на pointermove в чроме — нативная вью поверх их забирает. Растяни оверлей на всё окно, и
    // сортировка внутри сайдбара замёрзнет: чром перестанет видеть курсор даже над собой. Жест
    // половины сплита это себе позволяет только потому, что держит указатель через
    // setPointerCapture. Отсюда и разделение труда: над страницей карточку ведёт оверлей, над
    // сайдбаром — сам чром своим призраком.
    showOverlayIn(shouldShowIn);
    sendTabDrag(shouldShowIn, {
      width: shouldShowIn.content.width, height: shouldShowIn.content.height, card: drag.card,
    });
    drag.shown = shouldShowIn;
    drag.zone = null; // новое окно ещё ничего не знает — заставляем послать зону ниже
  }
  // Курсор — карточке в руке, в координатах ОВЕРЛЕЯ (то есть области контента). Считаем по тому
  // окну, где он сейчас показан: при переносе в соседнее окно карточка обязана ехать в НЁМ, туда
  // же, куда смотрит человек.
  const shownCursor = drag.shown ? cursorInWindow(drag.shown) : null;
  sendCursor(drag.shown, shownCursor && drag.shown
    ? { x: shownCursor.x - drag.shown.content.x, y: shownCursor.y - drag.shown.content.y }
    : null);
  if (zone !== drag.zone) {
    drag.zone = zone;
    // Чрому — чтобы он спрятал свой призрак, пока карточку ведёт оверлей (см. onTabDragZone).
    const chrome = contextForWindow(drag.source.win)?.chromeView;
    if (chrome && !chrome.webContents.isDestroyed()) {
      chrome.webContents.send(IPC.TAB_DRAG_ZONE, toAction(zone));
    }
    sendZone(drag.shown, zone);
  }
}

function stopDrag(): void {
  if (!drag) return;
  if (drag.timer) clearInterval(drag.timer);
  sendZone(drag.shown, null);
  sendTabDrag(drag.shown, null);
  sendCursor(drag.shown, null);
  const chrome = contextForWindow(drag.source.win)?.chromeView;
  if (chrome && !chrome.webContents.isDestroyed()) chrome.webContents.send(IPC.TAB_DRAG_ZONE, null);
  hideOverlayIn(drag.shown);
  drag = null;
}

// Начало перетаскивания вкладки: показываем зоны и начинаем следить за курсором.
export function startTabDrag(win: BrowserWindow, card: DragCard | null = null): void {
  stopDrag(); // предыдущий жест мог не закрыться штатно (окно закрылось, дроп отменили)
  const st = stateFor(win);
  if (st.content.width === 0 || st.content.height === 0) return; // контента нет (настройки/история)
  drag = { source: st, shown: null, zone: null, target: null, timer: null, card };
  // См. setSwapHint: вью общая на все жесты, и остатки прошлого надо обнулить до первого тика.
  sendSwapHint(st, null);
  setSwapThumb(win, null);
  updateDrag();
  drag.timer = setInterval(updateDrag, POLL_MS);
}

// Конец перетаскивания: прячем зоны и отдаём последнее посчитанное — по нему сайдбар и решает,
// что сделать (разделить экран, вынести в окно, отдать другому окну или просто переупорядочить).
export function endTabDrag(win: BrowserWindow): TabDropResult {
  if (!drag || drag.source.win.id !== win.id) return { zone: null };
  // Пересчитываем на месте: последний тик мог быть до 30 мс назад, а решает именно точка отпускания.
  updateDrag();
  const zone = toAction(drag.zone);
  const windowId = drag.target?.win.id;
  stopDrag();
  // 'adopt' без живого приёмника — не исход, а полпути: лучше ничего не делать, чем унести
  // вкладку неизвестно куда.
  if (zone === 'adopt' && windowId === undefined) return { zone: null };
  return windowId === undefined ? { zone } : { zone, windowId };
}
