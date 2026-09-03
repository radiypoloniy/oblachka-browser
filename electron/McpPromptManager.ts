import { BrowserWindow, WebContentsView } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ContentBounds, McpPromptRequest } from '../shared/ipc';
import { closeWindowView } from './viewTeardown';
import { OVERLAY_SHADOW_MARGIN as SHADOW_MARGIN } from '../shared/overlayMetrics';

// Вопрос внешнего агента — своей карточкой в интерфейсе браузера.
//
// ⚠️ ЭТО ЗАМЕНА СИСТЕМНОГО ОКНА, и замена по делу. Сначала вопрос задавался нативным
// dialog.showMessageBox — с обоснованием «страница не может его подделать». Обоснование верное, а
// вывод был неверным: наш поповер живёт в ОТДЕЛЬНОЙ WebContentsView поверх страницы, и страница
// туда не дотянется ровно так же. То есть анти-подделка не требовала системного окна — а оно,
// в отличие от карточки, выглядит чужим и предупреждает голосом Windows, а не голосом браузера.
//
// ⚠️ Устройство — как у PermissionPopoverManager: вью на окно, ленивое создание, очередь в main,
// высота меряется в самой вью. Не переиспользуем ту напрямую намеренно: там вопрос ЗАДАЁТ САЙТ,
// и вся её механика (снятие вопросов при уходе со страницы, ключ «сайт + разрешение») к внешнему
// агенту не относится.
//
// ⚠️ Угол ПРАВЫЙ верхний, а не левый, как у разрешений сайта. Это не вкус: слева спрашивает
// страница — там же замок и адрес; справа живёт метка «Внешний агент», и карточка обязана
// выходить из того же места, куда человек смотрит, когда замечает, что браузером кто-то управляет.

const CARD_WIDTH = 380;
const INITIAL_HEIGHT = 170;
const EDGE_GAP = 12;

interface PromptState {
  win: BrowserWindow;
  view: WebContentsView | null;
  resizeBound: boolean;
  contentBounds: ContentBounds;
  /** Приезжала ли хоть раз НАСТОЯЩАЯ геометрия контента (не нулевой сентинел). */
  hasBounds: boolean;
  height: number;
  queue: McpPromptRequest[];
}

/**
 * Запасной отступ сверху, пока настоящая геометрия ни разу не приезжала.
 *
 * ⚠️ Нужен ровно для одного случая: вопрос пришёл в окно, где человек ещё не открывал ни одной
 * страницы. Число приблизительное намеренно — как только контент сообщит свои bounds, карточка
 * встанет точно; лучше показать её чуть не на месте, чем не показать вовсе.
 */
const FALLBACK_TOP = 96;

export interface McpAnswer {
  granted: boolean;
  /** «Разрешать всегда» — только там, где это позволено (см. canRemember в mcpPolicy). */
  remember: boolean;
}

const states = new Map<number, PromptState>();
const waiting = new Map<string, (a: McpAnswer) => void>();

function stateFor(win: BrowserWindow): PromptState {
  const existing = states.get(win.id);
  if (existing) return existing;
  const created: PromptState = {
    win, view: null, resizeBound: false,
    contentBounds: { x: 0, y: 0, width: 0, height: 0 },
    hasBounds: false,
    height: INITIAL_HEIGHT, queue: [],
  };
  states.set(win.id, created);
  // ⚠️ Вью закрываем сами: окно не уносит дочерние WebContentsView с собой (см. viewTeardown.ts).
  win.once('closed', () => {
    const st = states.get(win.id);
    // Окно закрыли, не ответив: ждущие вызовы обязаны получить «нет», иначе агент ждёт вечно.
    for (const q of st?.queue ?? []) answer(q.id, { granted: false, remember: false });
    closeWindowView(st?.view);
    states.delete(win.id);
  });
  return created;
}

function bounds(st: PromptState): { x: number; y: number; width: number; height: number } {
  // ⚠️ Пока настоящей геометрии не было, считаем от окна: вопрос от внешней программы приходит
  // независимо от того, открыта ли под ним страница.
  const wb = st.win.getContentBounds();
  const cb = st.hasBounds
    ? st.contentBounds
    : { x: 0, y: FALLBACK_TOP, width: wb.width, height: wb.height - FALLBACK_TOP };
  return {
    x: cb.x + cb.width - CARD_WIDTH - EDGE_GAP - SHADOW_MARGIN,
    y: cb.y + EDGE_GAP - SHADOW_MARGIN,
    width: CARD_WIDTH + SHADOW_MARGIN * 2,
    height: st.height + SHADOW_MARGIN * 2,
  };
}

function isAttached(st: PromptState): boolean {
  return !!st.view && !st.win.isDestroyed() && st.win.contentView.children.includes(st.view);
}

function layout(st: PromptState): void {
  if (isAttached(st)) st.view!.setBounds(bounds(st));
}

function ensureView(st: PromptState): WebContentsView {
  if (st.view) return st.view;
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-mcpprompt.js'),
      contextIsolation: true,
      sandbox: false, // preload использует ipcRenderer
    },
  });
  st.view = view;
  // Прозрачность на самой вью, а не только в CSS, — иначе вокруг карточки непрозрачный
  // прямоугольник (тот же инвариант, что у остальных поповеров).
  view.setBackgroundColor('#00000000');
  view.webContents.once('did-finish-load', () => { pushCurrent(st); });
  void view.webContents.loadURL('oblako-chrome://localhost/mcpprompt.html');
  return view;
}

function pushCurrent(st: PromptState): void {
  const wc = st.view?.webContents;
  if (!wc || wc.isDestroyed()) return;
  wc.send('mcp-prompt:request', st.queue[0] ?? null);
}

function show(st: PromptState): void {
  if (st.queue.length === 0 || st.win.isDestroyed()) return;
  if (!st.resizeBound) {
    st.win.on('resize', () => layout(st));
    st.resizeBound = true;
  }
  const firstTime = st.view === null;
  const view = ensureView(st);
  view.setBounds(bounds(st));
  if (!isAttached(st)) st.win.contentView.addChildView(view);
  if (!firstTime) pushCurrent(st);
}

function detach(st: PromptState): void {
  if (!isAttached(st)) return;
  try { st.win.contentView.removeChildView(st.view!); } catch { /* окно могло закрыться */ }
}

/** Та же геометрия, что двигает вкладку: карточка привязана к контентной зоне. */
export function syncMcpPromptBounds(win: BrowserWindow, b: ContentBounds): void {
  // ⚠️ stateFor, а не states.get: геометрия приезжает ПОСТОЯННО, а состояние окна создавалось бы
  // только при первом вопросе — и создавалось бы с нулевыми bounds, то есть карточка не
  // показалась бы ни разу. Ровно этот пропуск и дал «подтверждения нет, а через минуту отказ».
  const st = stateFor(win);
  // ⚠️ Нулевые bounds — сентинел «под нами настройки, история или загрузки». У поповера
  // разрешений он означает «прятать»: там спрашивает САЙТ, и без страницы вопрос теряет смысл.
  // Здесь наоборот — спрашивает программа снаружи, и человек, сидящий в настройках, обязан
  // увидеть вопрос. Поэтому сентинел только не двигает карточку, а не убирает её.
  if (b.width === 0 || b.height === 0) { layout(st); return; }
  st.contentBounds = b;
  st.hasBounds = true;
  if (st.queue.length > 0 && !isAttached(st)) { show(st); return; }
  layout(st);
}

/**
 * Задать вопрос и дождаться ответа.
 *
 * ⚠️ Окно берётся сфокусированное, а если его нет — первое: вызов пришёл СНАРУЖИ браузера, и
 * своего окна у него не бывает. Когда окон нет вовсе, ответ «нет» — единственный честный: спросить
 * некого.
 */
export function askMcp(req: Omit<McpPromptRequest, 'id'>): Promise<McpAnswer> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
  if (!win || win.isDestroyed()) return Promise.resolve({ granted: false, remember: false });

  const full: McpPromptRequest = { ...req, id: randomUUID() };
  const st = stateFor(win);
  st.queue.push(full);
  if (isAttached(st)) pushCurrent(st);
  else show(st);

  return new Promise<McpAnswer>((resolve) => { waiting.set(full.id, resolve); });
}

/** Ответ из карточки (или снятие вопроса). Снимаем с очереди и показываем следующий. */
export function answer(id: string, a: McpAnswer): void {
  const resolve = waiting.get(id);
  waiting.delete(id);
  resolve?.(a);
  for (const st of states.values()) {
    const idx = st.queue.findIndex((q) => q.id === id);
    if (idx === -1) continue;
    st.queue.splice(idx, 1);
    if (st.queue.length === 0) detach(st);
    else pushCurrent(st);
    return;
  }
}

/** Высота карточки, измеренная в самой вью: длинный адрес переносится на вторую строку. */
export function setMcpPromptHeight(sender: Electron.WebContents, px: number): void {
  for (const st of states.values()) {
    if (st.view?.webContents !== sender) continue;
    const next = Math.max(80, Math.round(px));
    if (next === st.height) return;
    st.height = next;
    layout(st);
    return;
  }
}

/** Снять все висящие вопросы — при выключении сервера и отзыве клиента. */
export function dropMcpPrompts(): void {
  for (const st of [...states.values()]) {
    for (const q of [...st.queue]) answer(q.id, { granted: false, remember: false });
  }
}
