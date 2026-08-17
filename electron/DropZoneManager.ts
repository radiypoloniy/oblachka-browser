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
//
// 'replace-*' появляются ТОЛЬКО когда сплит уже на экране: делить пополам то, что и так поделено,
// нечего, и единственный осмысленный исход над панелью — занять её место.
type ZoneVisual = 'split-left' | 'split-right' | 'window' | 'adopt' | 'replace-left' | 'replace-right';

// Доля ширины контента с каждого края, отданная разделению экрана. Остаток посередине — новое
// окно. Так же разводят эти два жеста браузеры с вертикальными вкладками и сплитом.
const SPLIT_EDGE_RATIO = 0.35;
// Шаг опроса курсора. 30 мс — незаметно для глаза и дёшево: интервал живёт только во время драга.
const POLL_MS = 30;

// Каналы во вью-оверлей. Перечислены явно, потому что по ним же идёт повтор после загрузки
// (см. post): в Map должен попадать ровно этот набор, а не произвольная строка.
type OverlayChannel = 'dropzones:zone' | 'dropzones:swap' | 'dropzones:cursor' | 'dropzones:thumb' | 'dropzones:tab';

interface WindowDropZones {
  win: BrowserWindow;
  view: WebContentsView | null;
  content: ContentBounds;
  // Страница оверлея закончила грузиться и слушатели в ней есть (см. post).
  ready: boolean;
  // Последнее посланное по каждому каналу — чтобы повторить его после загрузки.
  last: Map<OverlayChannel, unknown>;
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
    ready: false, last: new Map(),
  };
  perWindow.set(win.id, created);
  win.once('closed', () => {
    // Окно закрылось посреди жеста — драг обрывается вместе с ним, иначе таймер продолжил бы
    // опрашивать курсор и слать сообщения в уничтоженную вью.
    if (drag && (drag.source.win.id === win.id || drag.shown?.win.id === win.id)) stopDrag();
    // ⚠️ Вью закрываем руками. Окно уносит с собой только то, что реально лежит в его
    // contentView, а прогретая (prewarmDropZones) вью до первого жеста туда не добавлена — и
    // пережила бы своё окно осиротевшим процессом рендерера. Пока вью создавалась лениво, на
    // первый жест, это было почти незаметно; с прогревом такой процесс был бы у КАЖДОГО
    // закрытого окна.
    const view = perWindow.get(win.id)?.view;
    if (view && !view.webContents.isDestroyed()) {
      (view.webContents as unknown as { close?: () => void }).close?.();
    }
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
  // .on, а не .once: после падения рендерера вью перезагружается, и повторить состояние надо
  // на КАЖДУЮ загрузку, иначе оверлей оживёт пустым.
  view.webContents.on('did-finish-load', () => {
    st.ready = true;
    for (const [channel, payload] of st.last) view.webContents.send(channel, payload);
  });
  view.webContents.loadURL('oblako-chrome://localhost/dropzones.html');
  return view;
}

// ⚠️ Все пуши в оверлей идут через эту дверь, а не через wc.send напрямую. Причина: вью может
// быть ещё не загружена (её создаёт первый же жест — см. ensureView), а send в незагруженный
// документ пропадает молча, слушателей в нём просто нет. Для потоковых сообщений это незаметно
// (следующий тик курсора всё поправит), но dropzones:tab уходит РОВНО ОДИН РАЗ за жест — и
// пропав, оставлял человека без карточки в руке до конца жеста. Отсюда запоминание последнего
// значения по каналу и повтор его на did-finish-load: к моменту, когда страница готова, она
// получает не историю, а текущее состояние.
function post(st: WindowDropZones | null, channel: OverlayChannel, payload: unknown): void {
  if (!st) return;
  st.last.set(channel, payload);
  const wc = st.view?.webContents;
  if (!st.ready || !wc || wc.isDestroyed()) return;
  wc.send(channel, payload);
}

// Прогрев оверлея — вызывается из main.ts после показа окна, с задержкой (тем же приёмом, что
// AiPanelManager.prewarmPanel). Только спавн WebContentsView и запуск загрузки её бандла: на
// экран ничего не кладём, addChildView остаётся делом самого жеста.
//
// Зачем: без прогрева первый за сессию жест платил полной холодной ценой — новый процесс
// рендерера, React, вся global.css со шрифтами. Это и была та «почти секунда», после которой
// все следующие жесты работают мгновенно (вью переживает жест и остаётся загруженной).
// Прогрев на КАЖДОЕ окно, а не один на приложение: вью здесь своя у каждого окна.
export function prewarmDropZones(win: BrowserWindow): void {
  try {
    ensureView(stateFor(win));
  } catch (e) {
    console.error('[dropzones] прогрев упал:', e); // не роняем старт — жест просто останется ленивым
  }
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

// Раскладка зон окна — один источник и для попадания курсора, и для картинки в оверлее.
// Прямоугольники в ОКОННЫХ координатах (как st.content); в координаты оверлея их переводит
// zonesForOverlay ниже.
//
// ⚠️ Две разные раскладки, а не одна с поправкой. Пока сплита нет, делить нечего: края области
// контента отданы разделению экрана по фиксированной доле, середина — новому окну. Как только
// панели на экране, доли теряют смысл — человек целится в КОНКРЕТНУЮ панель, а её ширину он сам
// же и задал разделителем. Отсюда прямоугольники берутся у TabManager, а не считаются здесь.
interface ZoneRect { zone: ZoneVisual; rect: ContentBounds }

// Доля ширины контента вокруг шва между панелями, оставленная «новому окну». Без неё исход
// «вынести в окно» в режиме сплита пропал бы вовсе: панели покрывают область контента целиком,
// и середины, за которую его брали, просто нет. Шов — единственное место, куда человек и так не
// целится панелью, и он же визуально читается как «между».
const SEAM_BAND_RATIO = 0.14;

function zoneLayout(st: WindowDropZones): ZoneRect[] {
  const c = st.content;
  const panels = contextForWindow(st.win)?.tabs.splitPanelRects() ?? null;
  if (panels) {
    const seamCenter = (panels.left.x + panels.left.width + panels.right.x) / 2;
    const half = (c.width * SEAM_BAND_RATIO) / 2;
    // Полосу шва вычитаем из панелей, а не рисуем поверх: зоны не должны накладываться, иначе
    // подсветка и попадание разойдутся ровно на ширину перекрытия.
    const leftW = Math.max(0, seamCenter - half - panels.left.x);
    const rightX = seamCenter + half;
    return [
      { zone: 'replace-left', rect: { x: panels.left.x, y: c.y, width: leftW, height: c.height } },
      { zone: 'window', rect: { x: seamCenter - half, y: c.y, width: half * 2, height: c.height } },
      { zone: 'replace-right', rect: { x: rightX, y: c.y, width: Math.max(0, panels.right.x + panels.right.width - rightX), height: c.height } },
    ];
  }
  const edge = c.width * SPLIT_EDGE_RATIO;
  return [
    { zone: 'split-left', rect: { x: c.x, y: c.y, width: edge, height: c.height } },
    { zone: 'window', rect: { x: c.x + edge, y: c.y, width: c.width - edge * 2, height: c.height } },
    { zone: 'split-right', rect: { x: c.x + c.width - edge, y: c.y, width: edge, height: c.height } },
  ];
}

// ⚠️ Сами прямоугольники ЗОН оверлею не уходят, и это не забывчивость. Он рисует не зоны, а
// превью раскладки: острова там, где они окажутся после дропа (см. src/dropzones.tsx). Какая
// зона под курсором — приходит отдельным сообщением ('dropzones:zone'), а её границы человеку
// показывать незачем: он видит исход, а не разметку, по которой тот вычислен.
function toOverlay(c: ContentBounds, r: ContentBounds): ContentBounds {
  return { x: r.x - c.x, y: r.y - c.y, width: r.width, height: r.height };
}

// Как область контента выглядит СЕЙЧАС: один остров или два (сплит). Оверлею это нужно, чтобы
// рисовать превью раскладки — что человек получит, если отпустит, — а не абстрактный пунктир
// поверх страницы. Он же исходное положение анимации: острова из текущей раскладки переезжают
// в будущую, а не появляются на пустом месте.
function islandsForOverlay(st: WindowDropZones): ContentBounds[] {
  const c = st.content;
  const panels = contextForWindow(st.win)?.tabs.splitPanelRects() ?? null;
  if (!panels) return [{ x: 0, y: 0, width: c.width, height: c.height }];
  return [toOverlay(c, panels.left), toOverlay(c, panels.right)];
}

// Зона внутри СВОЕГО окна. Вне области контента (шапка, сайдбар) — обычное переупорядочивание;
// вне окна вовсе — новое окно.
function zoneInSource(st: WindowDropZones): ZoneVisual | null {
  const p = cursorInWindow(st);
  if (!p) return 'window';
  const c = st.content;
  if (p.x < c.x || p.x > c.x + c.width || p.y < c.y || p.y > c.y + c.height) return null; // сайдбар/тулбар
  const layout = zoneLayout(st);
  for (const { zone, rect } of layout) {
    if (p.x >= rect.x && p.x < rect.x + rect.width) return zone;
  }
  // Ровно на правой кромке контента ни один полуинтервал не срабатывает — отдаём последнюю зону
  // (она и есть правая), иначе крайний столбец пикселей вёл бы себя не как соседний с ним.
  return layout[layout.length - 1]?.zone ?? 'window';
}

// Наружу отдаём ДЕЙСТВИЕ, а не картинку: сайдбару всё равно, за какой край тянули.
function toAction(z: ZoneVisual | null): TabDropZone | null {
  if (z === null) return null;
  if (z === 'adopt') return 'adopt';
  if (z === 'window') return 'window';
  return z === 'replace-left' || z === 'replace-right' ? 'replace' : 'split';
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
  post(st, 'dropzones:zone', zone);
}

function sendSwapHint(st: WindowDropZones | null, hint: SplitSwapHint | null): void {
  post(st, 'dropzones:swap', hint);
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
  post(st, 'dropzones:cursor', pos);
}

// Перетаскивание ВКЛАДКИ: размер области контента (он же размер оверлея — зоны рисуются в нём) и
// что нести в руке. Размер уходит явно, потому что по нему оверлей считает доли зон, а курсор
// приходит уже пересчитанным в ту же систему координат.
function sendTabDrag(
  st: WindowDropZones | null,
  payload: { width: number; height: number; card: DragCard | null; islands: ContentBounds[] } | null,
): void {
  post(st, 'dropzones:tab', payload);
}

// Снимок несомой панели — та же карточка, что чром рисует над собой. Приходит позже подсветки
// (capturePage ждёт кадр), поэтому отдельным сообщением, а не полем в hint: иначе снимок в
// сто килобайт улетал бы заново на каждую смену зоны.
export function setSwapThumb(win: BrowserWindow, thumb: string | null): void {
  post(perWindow.get(win.id) ?? null, 'dropzones:thumb', thumb);
}

// Другое окно Oblako под курсором — НЕЗАВИСИМО от того, лежит ли под ним же источник. Нужно, чтобы
// вернуть вкладку в родное окно, ПЕРЕКРЫТОЕ оторванным (см. adoptOther в updateDrag): решение
// «источник или чужое окно» принимает сам updateDrag по зоне, а не эта функция.
// ⚠️ Настоящего порядка окон по глубине Electron не отдаёт, поэтому среди чужих берём первое
// подходящее. Ошибка возможна только когда два ЧУЖИХ окна лежат друг на друге и курсор попал в их
// пересечение — там же, где и человеку не очевидно, куда он целится.
function otherWindowUnderCursor(source: WindowDropZones): WindowDropZones | null {
  for (const ctx of allContexts()) {
    if (ctx.win.id === source.win.id) continue;
    const st = stateFor(ctx.win);
    if (cursorInWindow(st)) return st;
  }
  return null;
}

// Один тик слежения: где курсор, что из этого следует и в каком окне это рисовать.
function updateDrag(): void {
  if (!drag) return;
  const inSource = !!cursorInWindow(drag.source);
  const other = otherWindowUnderCursor(drag.source);
  // Зона внутри источника (если курсор в нём). 'window' здесь = «вынести в новое окно», null —
  // курсор над сайдбаром/тулбаром источника (обычное переупорядочивание).
  const srcZone = inSource ? zoneInSource(drag.source) : null;
  // ⚠️ Курсор в источнике, его зона — «новое окно», а под курсором ЛЕЖИТ другое окно Oblako:
  // предпочитаем перенос в него. Иначе вернуть вкладку в родное окно, перекрытое оторванным, можно
  // было только уведя курсор в НЕперекрытую его часть — узкая мишень, отсюда живая жалоба «вкладка
  // очень неохотно возвращается». Зоны split/reorder внутри источника при этом НЕ трогаем: там
  // перенос не подразумевается, и красть вкладку у человека, просто двигающего её по своему окну,
  // нельзя (ровно то, ради чего источник и проверялся первым).
  // Курсор вне любого окна — по-прежнему «новое окно»: привычный жест на нескольких мониторах.
  const adoptOther = other !== null && (!inSource || srcZone === 'window');
  const shouldShowIn = adoptOther ? other : drag.source;
  const zone: ZoneVisual | null = adoptOther ? 'adopt' : (inSource ? srcZone : 'window');

  drag.target = adoptOther ? other : null;

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
      // Раскладку считает main — он один знает, есть ли сплит и какой ширины его панели.
      // Оверлей рисует ровно то, что произойдёт, а не свою догадку о долях.
      islands: islandsForOverlay(shouldShowIn),
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
  // Сторона теряется в toAction (наружу уходит действие, а не картинка) — достаём её из той же
  // ZoneVisual, пока она ещё под рукой: сплит обязан открыться там, куда тянули.
  const side: 'left' | 'right' | undefined =
    drag.zone === 'split-left' || drag.zone === 'replace-left' ? 'left'
    : drag.zone === 'split-right' || drag.zone === 'replace-right' ? 'right'
    : undefined;
  // Какую именно панель заменяем. Резолвим ЗДЕСЬ, пока пара ещё та же: отдай мы наружу одну
  // сторону, сайдбару пришлось бы заново выяснять состав пары — а он к этому моменту уже мог
  // измениться (панель могли закрыть, пока вкладку несли).
  const panels = zone === 'replace' ? contextForWindow(drag.source.win)?.tabs.splitPanelRects() : null;
  const replaceId = panels ? (side === 'left' ? panels.leftId : panels.rightId) : undefined;
  const windowId = drag.target?.win.id;
  stopDrag();
  // 'adopt' без живого приёмника — не исход, а полпути: лучше ничего не делать, чем унести
  // вкладку неизвестно куда.
  if (zone === 'adopt' && windowId === undefined) return { zone: null };
  // То же и для замены: сплит успел развалиться, пока вкладку несли, — целиться больше не во что.
  if (zone === 'replace' && replaceId === undefined) return { zone: null };
  return {
    zone,
    ...(windowId === undefined ? {} : { windowId }),
    ...(side ? { side } : {}),
    ...(replaceId ? { replaceId } : {}),
  };
}
