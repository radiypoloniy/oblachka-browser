import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { McpPromptRequest } from '../shared/ipc';
import { OVERLAY_SHADOW_MARGIN as SHADOW_MARGIN } from '../shared/overlayMetrics';

// Вопрос внешнего агента — карточкой в СВОЁМ окне поверх всех программ.
//
// ⚠️ ЭТО ТРЕТЬЕ РЕШЕНИЕ ПОДРЯД, и предыдущие два были неверны каждое по-своему. Сначала вопрос
// задавался нативным dialog.showMessageBox — его рисует Windows, и настроить там можно только
// текст, иконку и подписи кнопок: сообщение от браузера говорило чужим голосом. Потом карточка
// переехала внутрь окна браузера отдельной WebContentsView — вид стал наш, но появился порок
// куда хуже вида.
//
// ⚠️ ПОРОК БЫЛ В МЕСТЕ, А НЕ В ОФОРМЛЕНИИ. Вопрос от внешней программы приходит ровно тогда, когда
// человек СМОТРИТ НЕ В БРАУЗЕР: он сидит в Cursor или Claude Desktop — оттуда и спрашивает. Всё,
// что живёт внутри окна браузера, в этот момент невидимо, и починить это нельзя ничем: за один
// день 04.09.2026 из этого выросли три разные поломки подряд — карточка уезжала в окно выпадашки
// подсказок (`getAllWindows()[0]` оказывался им), карточку накрывала собой открывшаяся вкладка
// (порядок в `contentView.children` — это и есть порядок слоёв), карточка обрезалась по начальной
// высоте. Все три — следствия одного: вопрос лежал ВНУТРИ окна, которого человек не видит.
//
// ⚠️ Своё окно поверх всего снимает весь этот класс разом. Ни слоёв, ни привязки к геометрии
// контента, ни борьбы за верхний уровень: карточку видно из любой программы, и рисуем её мы сами.
// Прецедент в проекте есть — заставка (SplashWindow.ts): прозрачное безрамочное окно alwaysOnTop
// со своей вёрсткой.
//
// ⚠️ ФОКУС НЕ ЗАБИРАЕМ (`focusable: false` — на Windows это WS_EX_NOACTIVATE): окно принимает мышь,
// но не выдёргивает человека из программы, где он печатает. Тот же приём и по той же причине, что
// у выпадашки подсказок омнибокса.
//
// ⚠️ Угол ПРАВЫЙ НИЖНИЙ — там, где Windows показывает свои уведомления: глаз туда приучен, и
// карточка не накрывает то, что человек читает в чужом окне.

const CARD_WIDTH = 380;
const INITIAL_HEIGHT = 170;
/**
 * Отступ ВИДИМОЙ карточки от краёв рабочей области.
 *
 * ⚠️ Не меньше SHADOW_MARGIN, и это не вкусовщина: вокруг карточки лежит прозрачный запас под
 * тень, поэтому физический край окна проходит на SHADOW_MARGIN дальше видимого. При меньшем
 * отступе окно вылезало бы за рабочую область — живой драйвер это и поймал.
 */
const EDGE_GAP = 24;

export interface McpAnswer {
  granted: boolean;
  /** «Разрешать всегда» — только там, где это позволено (см. canRemember в mcpPolicy). */
  remember: boolean;
}

/**
 * ⚠️ Окно ОДНО НА ПРИЛОЖЕНИЕ, а не на окно браузера, и это следствие того же разбора: вопрос
 * задаёт программа снаружи — ей всё равно, сколько окон человек открыл и открыто ли хоть одно.
 */
let win: BrowserWindow | null = null;
let height = INITIAL_HEIGHT;
const queue: McpPromptRequest[] = [];
const waiting = new Map<string, (a: McpAnswer) => void>();

function bounds(): { x: number; y: number; width: number; height: number } {
  const area = screen.getPrimaryDisplay().workArea;
  const width = CARD_WIDTH + SHADOW_MARGIN * 2;
  const full = height + SHADOW_MARGIN * 2;
  // ⚠️ Прозрачный запас под тень (SHADOW_MARGIN) прибавляется к размеру и вычитается из отступа:
  // иначе карточка встала бы от края на EDGE_GAP плюс невидимое поле, то есть заметно дальше, чем
  // задумано, — и это было бы видно рядом с системными уведомлениями.
  return {
    width,
    height: full,
    x: Math.round(area.x + area.width - width - EDGE_GAP + SHADOW_MARGIN),
    y: Math.round(area.y + area.height - full - EDGE_GAP + SHADOW_MARGIN),
  };
}

function ensureWindow(): BrowserWindow {
  if (win && !win.isDestroyed()) return win;
  const created = new BrowserWindow({
    ...bounds(),
    frame: false,
    transparent: true,
    // Тень рисует сама карточка (см. SHADOW_MARGIN): системная легла бы по прямоугольнику окна,
    // то есть по прозрачному запасу вокруг неё.
    hasShadow: false,
    // ⚠️ Мышь принимает, фокус не забирает — человек в этот момент печатает в другой программе.
    focusable: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-mcpprompt.js'),
      contextIsolation: true,
      sandbox: false, // preload использует ipcRenderer
    },
  });
  win = created;
  created.setMenuBarVisibility(false);
  // ⚠️ Уровень 'screen-saver', а не просто alwaysOnTop: иначе полноэкранное приложение (редактор
  // на весь экран, видео) окажется выше — и вопрос снова станет невидимым.
  created.setAlwaysOnTop(true, 'screen-saver');
  // Карточка никуда не навигирует сама; если что-то попробует — окно интерфейса не должно
  // превратиться в страницу сайта (тот же гвард, что у выпадашки подсказок и AI-панели).
  created.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('oblako-chrome://')) e.preventDefault();
  });
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  created.webContents.once('did-finish-load', () => { pushCurrent(); });
  created.on('closed', () => {
    win = null;
    // Окно закрыли, не ответив: ждущие вызовы обязаны получить «нет», иначе агент ждёт вечно.
    for (const q of [...queue]) answer(q.id, { granted: false, remember: false });
  });
  void created.loadURL('oblako-chrome://localhost/mcpprompt.html');
  return created;
}

function pushCurrent(): void {
  const wc = win?.webContents;
  if (!wc || wc.isDestroyed()) return;
  wc.send('mcp-prompt:request', queue[0] ?? null);
}

function layout(): void {
  if (win && !win.isDestroyed()) win.setBounds(bounds());
}

/**
 * Задать вопрос и дождаться ответа.
 *
 * ⚠️ Окна браузера здесь нет вовсе — ни выбора, ни привязки к нему. Прежняя версия искала
 * «правильное» окно среди всех открытых и однажды выбрала окно выпадашки подсказок; выбирать
 * больше не из чего, и ошибиться негде.
 */
export function askMcp(req: Omit<McpPromptRequest, 'id'>): Promise<McpAnswer> {
  const full: McpPromptRequest = { ...req, id: randomUUID() };
  queue.push(full);

  const w = ensureWindow();
  layout();
  pushCurrent();
  // ⚠️ showInactive(), а не show(): show() просит у системы активацию. Окно и так неактивируемое,
  // но просить активацию и не получать её — лишний повод системе дёрнуть фокус чужой программы.
  if (!w.isVisible()) w.showInactive();

  return new Promise<McpAnswer>((resolve) => { waiting.set(full.id, resolve); });
}

/** Ответ из карточки (или снятие вопроса). Снимаем с очереди и показываем следующий. */
export function answer(id: string, a: McpAnswer): void {
  const resolve = waiting.get(id);
  waiting.delete(id);
  resolve?.(a);
  const idx = queue.findIndex((q) => q.id === id);
  if (idx === -1) return;
  queue.splice(idx, 1);
  if (queue.length === 0) {
    // ⚠️ Прячем, а не закрываем: следующий вопрос покажется мгновенно, без загрузки страницы.
    // Живое окно поверх всего при этом ничего не стоит — оно скрыто и ничего не рисует.
    if (win && !win.isDestroyed()) win.hide();
    return;
  }
  pushCurrent();
}

/**
 * Высота карточки, измеренная в самой вью: длинный адрес переносится на вторую строку.
 *
 * ⚠️ Окно РАСТЁТ ВВЕРХ, а не вниз: оно прижато к нижнему краю рабочей области, и рост вниз уводил
 * бы кнопки под панель задач.
 */
export function setMcpPromptHeight(sender: Electron.WebContents, px: number): void {
  if (!win || win.isDestroyed() || win.webContents !== sender) return;
  const next = Math.max(80, Math.round(px));
  if (next === height) return;
  height = next;
  layout();
}

/** Снять все висящие вопросы — при выключении сервера и отзыве клиента. */
export function dropMcpPrompts(): void {
  for (const q of [...queue]) answer(q.id, { granted: false, remember: false });
}

/** Закрыть окно вопроса совсем — при выходе из приложения. */
export function closeMcpPromptWindow(): void {
  dropMcpPrompts();
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
}
