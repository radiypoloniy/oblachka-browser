// Приглашение «сайт просит доступ к камере/геолокации» — отдельная WebContentsView-оверлей
// поверх страницы, у левого верхнего угла контентной зоны (там же, где его ждут по привычке
// из Chrome — под адресной строкой, у иконки замка).
//
// ⚠️ Зачем переезд из чрома. Раньше приглашение рисовалось полосой в React-слое, а страница
// СДВИГАЛАСЬ вниз на 64 px (резерв в App.tsx::pushBounds). Нативная вью страницы лежит поверх
// React-слоя, поэтому иначе полосу и не было бы видно — но цена в том, что запрос разрешения
// дёргал вёрстку живой страницы: содержимое прыгало вниз и обратно, ломая позицию прокрутки и
// попадание по кнопке, на которую человек только что нажал. Оверлей ничего не двигает.
//
// Устройство — ровно как у FindBarManager: вью создаётся лениво один раз на окно, показ/скрытие
// через add/removeChildView, состояние в карте по id окна, окно ищется по вью-отправителю
// (BrowserWindow.fromWebContents для дочерней вью возвращает null).
//
// ⚠️ Очередь запросов живёт ЗДЕСЬ, а не в renderer, как раньше. Сайт умеет попросить камеру и
// геолокацию подряд, до ответа на первый вопрос; показываем по одному, следующий — после ответа.
import { WebContentsView } from 'electron'
import type { BrowserWindow } from 'electron'
import path from 'node:path'
import type { ContentBounds, PermissionRequest } from '../shared/ipc'
import { closeWindowView } from './viewTeardown';
import { OVERLAY_SHADOW_MARGIN as SHADOW_MARGIN } from '../shared/overlayMetrics';

const CARD_WIDTH = 380
// Стартовая высота до первого отчёта из вью. Оверлей появляется мгновенно, а высоту содержимого
// renderer сообщает через permission-popover:height — до этого момента лучше взять с запасом,
// чем показать обрезанную карточку.
const INITIAL_HEIGHT = 150
const EDGE_GAP = 12

interface WindowPermPopover {
  win: BrowserWindow
  view: WebContentsView | null
  resizeBound: boolean
  contentBounds: ContentBounds
  height: number
  // Очередь неотвеченных запросов. Первый — тот, что сейчас на экране.
  queue: PermissionRequest[]
}

const popovers = new Map<number, WindowPermPopover>()

function stateFor(win: BrowserWindow): WindowPermPopover {
  const existing = popovers.get(win.id)
  if (existing) return existing
  const created: WindowPermPopover = {
    win, view: null, resizeBound: false,
    contentBounds: { x: 0, y: 0, width: 0, height: 0 },
    height: INITIAL_HEIGHT, queue: [],
  }
  popovers.set(win.id, created)
  // ⚠️ Вью закрываем сами: окно не уносит с собой дочерние WebContentsView, и поповер
  // закрытого окна остался бы жить отдельным процессом (замер и разбор — viewTeardown.ts).
  win.once('closed', () => { closeWindowView(popovers.get(win.id)?.view); popovers.delete(win.id) })
  return created
}

function computeBounds(st: WindowPermPopover): { x: number; y: number; width: number; height: number } {
  const cb = st.contentBounds
  return {
    x: cb.x + EDGE_GAP - SHADOW_MARGIN,
    y: cb.y + EDGE_GAP - SHADOW_MARGIN,
    width: CARD_WIDTH + SHADOW_MARGIN * 2,
    height: st.height + SHADOW_MARGIN * 2,
  }
}

// Открыт ли поповер — по факту прикрепления вью, без отдельного флага (тот же инвариант, что в
// FindBarManager: флаг умеет разойтись с реальностью, факт — нет).
function isAttached(st: WindowPermPopover): boolean {
  return !!st.view && !st.win.isDestroyed() && st.win.contentView.children.includes(st.view)
}

function layout(st: WindowPermPopover): void {
  if (!isAttached(st)) return
  st.view!.setBounds(computeBounds(st))
}

// Тот же CONTENT_SET_BOUNDS, что двигает вкладку и FindBar. width/height === 0 — сентинел
// «открыты настройки/история», страницы под нами нет: приглашение прячем вместе с контентом,
// но очередь НЕ теряем — вопрос остаётся неотвеченным, и вернуться к нему надо.
export function syncPermissionPopoverBounds(win: BrowserWindow, b: ContentBounds): void {
  const st = stateFor(win)
  st.contentBounds = b
  if (b.width === 0 && b.height === 0) { detach(st); return }
  if (st.queue.length > 0 && !isAttached(st)) { showTop(st); return }
  layout(st)
}

function ensureView(st: WindowPermPopover): WebContentsView {
  if (st.view) return st.view
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-permissionpopover.js'),
      contextIsolation: true,
      sandbox: false, // preload использует ipcRenderer
    },
  })
  st.view = view
  // Прозрачность на самой вью, не только в CSS — иначе вокруг карточки виден непрозрачный
  // прямоугольник (тот же инвариант, что у FindBar и остальных поповеров).
  view.setBackgroundColor('#00000000')
  view.webContents.once('did-finish-load', () => { pushCurrent(st) })
  view.webContents.loadURL('oblako-chrome://localhost/permissionpopover.html')
  return view
}

// Отправить во вью текущий (первый в очереди) запрос. Вызывается и после загрузки, и при
// каждом изменении очереди — вью сама решает, что нарисовать.
function pushCurrent(st: WindowPermPopover): void {
  const wc = st.view?.webContents
  if (!wc || wc.isDestroyed()) return
  wc.send('permission-popover:request', st.queue[0] ?? null)
}

function showTop(st: WindowPermPopover): void {
  if (st.queue.length === 0) return
  if (st.contentBounds.width === 0 || st.contentBounds.height === 0) return // страницы под нами нет
  if (!st.resizeBound) {
    st.win.on('resize', () => layout(st))
    st.resizeBound = true
  }
  const firstTime = st.view === null
  const view = ensureView(st)
  view.setBounds(computeBounds(st))
  if (!isAttached(st)) st.win.contentView.addChildView(view) // последней → поверх страницы
  // ⚠️ Фокус вью НЕ забираем: карточка не имеет поля ввода, а перехват фокуса у страницы
  // прервал бы то, что человек делал (тот же закон, что у выпадашки подсказок).
  if (!firstTime) pushCurrent(st)
}

function detach(st: WindowPermPopover): void {
  if (!isAttached(st)) return
  try { st.win.contentView.removeChildView(st.view!) } catch { /* окно могло закрыться */ }
}

// Новый запрос от PermissionManager. Дубликаты (тот же сайт просит то же самое повторно, пока
// вопрос висит) в очередь не добавляем — иначе человек отвечал бы на один и тот же вопрос дважды.
export function showPermissionRequest(win: BrowserWindow, req: PermissionRequest): void {
  const st = stateFor(win)
  const dup = st.queue.some((q) => q.origin === req.origin && q.permission === req.permission)
  if (!dup) st.queue.push(req)
  if (isAttached(st)) pushCurrent(st)
  else showTop(st)
}

// Человек ответил (или запрос отменился) — снимаем его с очереди и показываем следующий.
export function permissionAnswered(requestId: string): void {
  for (const st of popovers.values()) {
    const idx = st.queue.findIndex((q) => q.requestId === requestId)
    if (idx === -1) continue
    st.queue.splice(idx, 1)
    if (st.queue.length === 0) detach(st)
    else pushCurrent(st)
    return
  }
}

// Окно-отправитель по вью: у дочерней вью BrowserWindow.fromWebContents возвращает null.
export function permissionPopoverWindowOf(sender: Electron.WebContents): BrowserWindow | null {
  for (const st of popovers.values()) {
    if (st.view?.webContents === sender) return st.win
  }
  return null
}

// Высота карточки, измеренная в самой вью (домен бывает длинным и переносится на вторую строку).
export function setPermissionPopoverHeight(sender: Electron.WebContents, px: number): void {
  for (const st of popovers.values()) {
    if (st.view?.webContents !== sender) continue
    const next = Math.max(60, Math.round(px))
    if (next === st.height) return
    st.height = next
    layout(st)
    return
  }
}

// Вкладка ушла со страницы или закрылась — висящие вопросы этой страницы больше не актуальны.
// Возвращает id снятых запросов: ответить на них «нет» должен PermissionManager, иначе колбэк
// Chromium останется неотвеченным навсегда.
export function dropPermissionRequests(win: BrowserWindow): string[] {
  const st = popovers.get(win.id)
  if (!st || st.queue.length === 0) return []
  const ids = st.queue.map((q) => q.requestId)
  st.queue = []
  detach(st)
  return ids
}
