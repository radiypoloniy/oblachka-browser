// Снимок вкладки (Ctrl+Shift+S) — жест взят с macOS: снял → в углу сама всплыла карточка со
// снимком → Ctrl+S сохраняет, Esc убирает. Как и там, снимок НЕ уходит на диск сам: файл
// появляется только по явному «сохранить», иначе папка загрузок засоряется случайными кадрами.
//
// ⚠️ Снимаем ровно ОДНУ вью — активной вкладки (webContents.capturePage). Выбора «какое окно
// снять» у нас нет и не задумано: интерфейс браузера в кадре человеку не нужен, ему нужна
// страница. Хаб/настройки/история снимку не подлежат (getActiveWebContents() === null) —
// снимать там нечего, это наш собственный интерфейс.
//
// Оформление кадра (скруглённые углы + мягкая тень на прозрачном фоне — тот самый вид, за который
// любят снимки macOS) делает РЕНДЕРЕР карточки на canvas, а не main: nativeImage тени рисовать не
// умеет, а canvas детерминирован и виден глазом ровно в том же кадре, который потом сохранится.
//
// Техника карточки — та же, что у FindBar/поповера загрузок: своя прозрачная WebContentsView
// поверх страницы (DOM в чроме не годится — нативная вью страницы лежит поверх React-слоя).
// Состояние — по окну: снимок делается в том окне, где нажали, включая лёгкие.
import { WebContentsView, ipcMain, app, clipboard, nativeImage, shell } from 'electron';
import type { BrowserWindow, WebContents } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { ContentBounds } from '../shared/ipc';
import { uniquePath } from './DownloadManager';
import { getAiPanelReservedWidth } from './AiPanelManager';
import type { TabManager } from './TabManager';
import { closeWindowView } from './viewTeardown';

const CARD_WIDTH = 320;
const INITIAL_HEIGHT = 220;
// Отступ карточки от края контентной зоны и прозрачный запас под CSS-тень (вью обрезает всё, что
// нарисовано за её прямоугольником — тот же приём, что в FindBarManager.ts).
const EDGE_GAP = 16;
const SHADOW_MARGIN = 24;

interface WindowShot {
  win: BrowserWindow;
  view: WebContentsView | null;
  tabs: TabManager | null;
  content: ContentBounds;
  height: number;
  open: boolean;
  loaded: boolean;
  // Снимок, сделанный до того, как страница карточки успела навесить слушателей: loadURL
  // асинхронен, а первый Ctrl+Shift+S приходит раньше (тот же приём, что у поповера загрузок).
  pending: string | null;
  // Снимок УЖЕ делается. ⚠️ Между нажатием и показом карточки лежит await capturePage(), и на
  // загруженной машине он занимает заметное время — а хоткей в это время нажимают ПОВТОРНО, как
  // раз потому, что «не сработало». Без этого флага два захода идут параллельно, и поздний
  // прикрепляет карточку ЗАНОВО уже после того, как ранний её закрыл: на экране ничего нет, а вью
  // висит прикреплённой и screenshotOpen остаётся true — то есть Ctrl+S и Esc навсегда уходят
  // мёртвой карточке, а не странице. Ровно тот класс залипания, который лечится только
  // перезапуском.
  capturing: boolean;
}

const shots = new Map<number, WindowShot>();
let ipcRegistered = false;

function stateFor(win: BrowserWindow): WindowShot {
  const existing = shots.get(win.id);
  if (existing) return existing;
  const created: WindowShot = {
    win, view: null, tabs: null,
    content: { x: 0, y: 0, width: 0, height: 0 },
    height: INITIAL_HEIGHT, open: false, loaded: false, pending: null, capturing: false,
  };
  shots.set(win.id, created);
  // ⚠️ Вью закрываем сами: окно не уносит с собой дочерние WebContentsView, и поповер
  // закрытого окна остался бы жить отдельным процессом (замер и разбор — viewTeardown.ts).
  win.once('closed', () => { closeWindowView(shots.get(win.id)?.view); shots.delete(win.id); });
  return created;
}

// Окно ищем по вью-отправителю: BrowserWindow.fromWebContents для дочерней вью отдаёт null
// (тот же случай, что в WindowRegistry.contextFromSender и FindBarManager).
function stateBySender(sender: WebContents): WindowShot | null {
  for (const st of shots.values()) if (st.view?.webContents === sender) return st;
  return null;
}

export function setScreenshotTabManager(win: BrowserWindow, tm: TabManager): void {
  stateFor(win).tabs = tm;
}

function isAttached(st: WindowShot): boolean {
  return !!st.view && !st.win.isDestroyed() && st.win.contentView.children.includes(st.view);
}

// Правый нижний угол КОНТЕНТНОЙ зоны — как всплывающая миниатюра на macOS. Ширину, занятую
// AI-панелью, вычитаем: она перекрывает правый край страницы, не двигая её bounds, и карточка
// иначе оказалась бы под ней (тот же расчёт, что у FindBar).
function computeBounds(st: WindowShot): { x: number; y: number; width: number; height: number } {
  const cb = st.content;
  const right = cb.x + cb.width - getAiPanelReservedWidth(st.win);
  const x = Math.max(cb.x + EDGE_GAP, right - CARD_WIDTH - EDGE_GAP);
  const y = Math.max(cb.y + EDGE_GAP, cb.y + cb.height - st.height - EDGE_GAP);
  return {
    x: x - SHADOW_MARGIN,
    y: y - SHADOW_MARGIN,
    width: CARD_WIDTH + SHADOW_MARGIN * 2,
    height: st.height + SHADOW_MARGIN * 2,
  };
}

function layout(st: WindowShot): void {
  if (!isAttached(st)) return;
  st.view!.setBounds(computeBounds(st));
}

// Нулевые bounds — тот же сентинел, что у остальных оверлеев: открылись настройки/история,
// контента нет, карточке висеть не над чем.
export function syncScreenshotBounds(win: BrowserWindow, b: ContentBounds): void {
  const st = stateFor(win);
  st.content = b;
  if (b.width === 0 && b.height === 0) { closeScreenshot(win); return; }
  layout(st);
}

/** AI-панель открылась/закрылась — свободная ширина изменилась (как у FindBar, см. main.ts). */
export function relayoutScreenshot(win: BrowserWindow): void {
  const st = shots.get(win.id);
  if (st) layout(st);
}

/** Имя файла в духе macOS: «Снимок экрана 2026-08-03 в 18.53.24.png» (двоеточия Windows не даёт). */
function defaultFileName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const d = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  const t = `${p(now.getHours())}.${p(now.getMinutes())}.${p(now.getSeconds())}`;
  return `Снимок экрана ${d} в ${t}.png`;
}

/** PNG из data-URL без перекодирования — так альфа (прозрачные поля вокруг тени) остаётся точной. */
function pngFromDataUrl(dataUrl: string): Buffer | null {
  if (!dataUrl.startsWith('data:image/png;base64,')) return null;
  try { return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'); } catch { return null; }
}

function ensureIpcRegistered(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;

  ipcMain.handle('screenshot:save', (_e, dataUrl: string): string | null => {
    const png = pngFromDataUrl(dataUrl);
    if (!png) return null;
    const file = uniquePath(app.getPath('downloads'), defaultFileName());
    try {
      fs.writeFileSync(file, png);
      return file;
    } catch {
      return null; // диск занят/нет прав — карточка покажет, что не вышло
    }
  });

  // ⚠️ В буфер уходит тот же оформленный кадр, что и в файл. Прозрачность вокруг тени переживает
  // не каждое принимающее приложение (Windows кладёт картинку ещё и как DIB без альфы), но
  // расходиться «в файле одно, в буфере другое» было бы хуже любой такой потери.
  ipcMain.on('screenshot:copy', (_e, dataUrl: string) => {
    try {
      const img = nativeImage.createFromDataURL(dataUrl);
      if (!img.isEmpty()) clipboard.writeImage(img);
    } catch { /* битый dataURL — молча, карточка уже показала «скопировано» */ }
  });

  ipcMain.on('screenshot:reveal', (_e, file: string) => {
    if (file) shell.showItemInFolder(file);
  });

  ipcMain.on('screenshot:close', (e) => {
    const st = stateBySender(e.sender);
    if (st) closeScreenshot(st.win);
  });

  ipcMain.on('screenshot:height', (e, px: number) => {
    const st = stateBySender(e.sender);
    if (!st) return;
    st.height = Math.max(1, Math.round(px));
    layout(st);
  });
}

function ensureView(st: WindowShot): WebContentsView {
  if (st.view) return st.view;
  ensureIpcRegistered();
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-screenshot.js'),
      contextIsolation: true,
      sandbox: false, // preload использует ipcRenderer
    },
  });
  st.view = view;
  // Обязателен на самой вью, не только CSS: иначе вокруг карточки виден непрозрачный прямоугольник.
  view.setBackgroundColor('#00000000');
  // СТРАЖ ФОКУСА — тот же, что у выпадашки подсказок. Карточка появляется САМА, не по клику в неё,
  // и забрать фокус у страницы ей нельзя ни на кадр: человек мог снимать снимок посреди набора
  // текста. Запретить перехват штатно Electron не даёт (electron/electron#42922), поэтому фокус
  // возвращаем на следующем тике — и заодно этим держим Ctrl+S рабочим: хоткеи слушает
  // before-input-event на самой странице (см. TabManager.registerHotkeyHandler).
  view.webContents.on('focus', () => {
    setImmediate(() => st.tabs?.focusActiveView());
  });
  view.webContents.once('did-finish-load', () => {
    st.loaded = true;
    if (st.pending) {
      view.webContents.send('screenshot:shot', st.pending);
      st.pending = null;
    }
  });
  view.webContents.loadURL('oblako-chrome://localhost/screenshot.html');
  return view;
}

/** Ctrl+Shift+S: снять активную вкладку и показать карточку. */
export async function captureTabScreenshot(win: BrowserWindow, tabs: TabManager): Promise<void> {
  const wc = tabs.getActiveWebContents();
  if (!wc || wc.isDestroyed()) return; // хаб/настройки — снимать нечего
  const st = stateFor(win);
  st.tabs = tabs;
  // ⚠️ Второй заход, пока первый не дошёл до карточки, просто игнорируем — см. поле capturing.
  if (st.capturing) return;
  st.capturing = true;

  // ⚠️ finally обязателен: выходов из функции ниже несколько (пустой кадр, умершая вкладка,
  // закрытое окно), и застрявший capturing=true означал бы, что снимок больше не сделать вовсе
  // до перезапуска — лекарство хуже болезни.
  try {
    let dataUrl: string;
    try {
      const img = await wc.capturePage();
      if (img.isEmpty()) return;
      // Без scaleFactor: у снимка одна-единственная растровая копия — та, что сняли, и отдаётся
      // она целиком. Просить «1x» на мониторе со 125–150% значило бы уменьшить кадр и получить
      // мыло ровно там, где снимок и нужен покрупнее.
      dataUrl = img.toDataURL();
    } catch {
      return; // вкладка умерла между проверкой и снимком
    }
    if (win.isDestroyed()) return;

    const view = ensureView(st);
    st.open = true;
    view.setBounds(computeBounds(st));
    // Порядок наложения у нативных вью — это порядок детей contentView, поэтому карточку надо
    // держать последней. ⚠️ НО поднимаем, ТОЛЬКО если она уже не наверху: страж возвращает фокус
    // ПОСЛЕ перехвата, то есть каждый addChildView — это круг «фокус ушёл во вью → вернулся на
    // страницу». Хоткеи слушает before-input-event самой страницы, и нажатие, попавшее в этот
    // круг, теряется — отсюда «приходилось нажимать по нескольку раз». Тот же разбор, что у
    // выпадашки подсказок (см. SuggestDropdownManager.ts).
    const children = win.contentView.children;
    if (children[children.length - 1] !== view) win.contentView.addChildView(view);
    if (st.loaded) view.webContents.send('screenshot:shot', dataUrl);
    else st.pending = dataUrl;
    // Пока карточка жива, Ctrl+S принадлежит ей (см. TabManager.registerHotkeyHandler).
    tabs.setScreenshotOpen(true);
  } finally {
    st.capturing = false;
  }
}

/** Ctrl+S при живой карточке — сохранить. Сам файл пишет рендерер: у него оформленный кадр. */
export function saveCurrentScreenshot(win: BrowserWindow): void {
  const st = shots.get(win.id);
  if (!st || !isAttached(st)) return;
  st.view!.webContents.send('screenshot:save-now');
}

export function closeScreenshot(win: BrowserWindow | null): void {
  if (!win) return;
  const st = shots.get(win.id);
  if (!st || !st.open) return;
  st.open = false;
  st.tabs?.setScreenshotOpen(false);
  if (isAttached(st)) {
    try { st.win.contentView.removeChildView(st.view!); } catch { /* окно могло уже закрыться */ }
  }
}
