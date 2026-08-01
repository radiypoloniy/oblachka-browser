import { WebContentsView, app, session } from 'electron';
import type { BrowserWindow, Rectangle } from 'electron';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { TabManager } from './TabManager';
import {
  SELECTION_SCRIPT, IMAGE_CAPTURE_SCRIPT, buildInsertScript, buildLastAnswerScript, profileForUrl,
} from './graphWebApps';

// Живой чужой сайт для узла-веб-приложения графа. Один узел — одна WebContentsView,
// как у WebAppManager раздела «Приложения», и с теми же инвариантами изоляции:
// sandbox + contextIsolation, БЕЗ preload — моста Oblako чужой странице не положено.
// session.defaultSession, поэтому логин, куки, адблок и VPN работают как в обычной вкладке
// (иначе пришлось бы логиниться в ChatGPT отдельно, что убило бы весь смысл затеи).
//
// ⚠️ Почему вью НЕ живёт прямо в карточке узла на холсте: нативную вью нельзя
// отмасштабировать вместе с зумом холста, нельзя обрезать по его краю (setBounds — это
// прямоугольник, а не маска) и нельзя увести под связи — нативный слой всегда поверх
// React. Поэтому на холсте узел остаётся карточкой, а живой сайт показывается 1:1 в
// отдельной панели, и ровно один за раз — сфокусированный.

interface Entry {
  view: WebContentsView;
  url: string;
  visible: boolean;
}

// Ключ — `${graphId}:${nodeId}`. Открытых окон может быть несколько: сравнивать ответы двух
// моделей рядом — обычный сценарий графа, ради него всё и затевалось.
const views = new Map<string, Entry>();

let tabManagerRef: TabManager | null = null;
export function setTabManager(tm: TabManager): void {
  tabManagerRef = tm;
}

const HTTP_SCHEME = /^https?:\/\//i;

// Десктопный UA, а не мобильный (в отличие от WebAppManager): панель здесь широкая,
// и мобильная вёрстка чата в ней выглядела бы обрезком. UA окна и так уже подменён на
// настоящий Chrome в BrowserIdentity.ts — отдельно ничего не выставляем.

function keyOf(graphId: number, nodeId: string): string {
  return `${graphId}:${nodeId}`;
}

function ensureView(win: BrowserWindow, key: string, url: string): Entry | null {
  if (!HTTP_SCHEME.test(url)) return null;
  const existing = views.get(key);
  if (existing) {
    // Адрес узла поменяли — переезжаем в том же вью, чтобы не плодить процессы.
    if (existing.url !== url) {
      existing.url = url;
      existing.view.webContents.loadURL(url).catch(() => { /* сеть/DNS — покажет сама страница */ });
    }
    return existing;
  }

  const view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // preload намеренно отсутствует — см. шапку файла
    },
  });
  view.setBackgroundColor('#FFFFFFFF');

  // Навигация внутри панели разрешена (это мини-браузер), но только http(s).
  // will-redirect отдельно: will-navigate не ловит СЕРВЕРНЫЙ редирект, а тот мог бы
  // затащить в панель привилегированный oblako-chrome:// или file://.
  view.webContents.on('will-navigate', (e, target) => {
    if (!HTTP_SCHEME.test(target)) e.preventDefault();
  });
  view.webContents.on('will-redirect', (e, target) => {
    if (!HTTP_SCHEME.test(target)) e.preventDefault();
  });
  view.webContents.setWindowOpenHandler(({ url: target }) => {
    if (HTTP_SCHEME.test(target)) tabManagerRef?.createTab(target);
    return { action: 'deny' };
  });

  view.webContents.loadURL(url).catch(() => { /* покажет сама страница */ });
  const entry: Entry = { view, url, visible: false };
  views.set(key, entry);
  void win;
  return entry;
}

function hideEntry(win: BrowserWindow, entry: Entry): void {
  if (!entry.visible) return;
  if (!win.isDestroyed()) {
    try { win.contentView.removeChildView(entry.view); } catch { /* окно уже закрылось */ }
  }
  entry.visible = false;
}

export function showGraphWebApp(
  win: BrowserWindow, graphId: number, nodeId: string, url: string, bounds: Rectangle,
): void {
  const entry = ensureView(win, keyOf(graphId, nodeId), url);
  if (!entry) return;
  if (!entry.visible) {
    win.contentView.addChildView(entry.view);
    entry.visible = true;
  }
  entry.view.setBounds(bounds);
}

export function setGraphWebAppBounds(
  win: BrowserWindow, graphId: number, nodeId: string, bounds: Rectangle,
): void {
  const entry = views.get(keyOf(graphId, nodeId));
  if (!entry) return;
  // Нулевой прямоугольник — сентинел «окно закрыто», тот же приём, что у контента вкладок.
  if (bounds.width < 2 || bounds.height < 2) { hideEntry(win, entry); return; }
  if (!entry.visible) {
    win.contentView.addChildView(entry.view);
    entry.visible = true;
  }
  entry.view.setBounds(bounds);
}

// Поднять окно над остальными. Нативные вью стыкуются по порядку добавления, а React-рамки —
// по порядку в DOM. Если их не синхронизировать, при наложении окон сверху окажется рамка
// одного окна с сайтом другого. addChildView для уже добавленной вью переносит её в конец,
// то есть наверх; renderer в тот же момент переставляет своё окно последним в списке.
export function raiseGraphWebApp(win: BrowserWindow, graphId: number, nodeId: string): void {
  const entry = views.get(keyOf(graphId, nodeId));
  if (!entry || !entry.visible || win.isDestroyed()) return;
  try { win.contentView.addChildView(entry.view); } catch { /* окно закрылось */ }
}

// Узел удалили с холста — вью больше не нужна.
export function closeGraphWebApp(win: BrowserWindow, graphId: number, nodeId: string): void {
  const key = keyOf(graphId, nodeId);
  const entry = views.get(key);
  if (!entry) return;
  hideEntry(win, entry);
  try { entry.view.webContents.close(); } catch { /* уже закрыт */ }
  views.delete(key);
}

// ── Обмен через руку человека ────────────────────────────────────────────────

function activeContents(graphId: number, nodeId: string) {
  const entry = views.get(keyOf(graphId, nodeId));
  if (!entry || entry.view.webContents.isDestroyed()) return null;
  return entry.view.webContents;
}

// Кладём готовый промпт в поле ввода страницы. Отправку НЕ жмём — это делает человек.
export async function insertPrompt(graphId: number, nodeId: string, text: string): Promise<boolean> {
  const wc = activeContents(graphId, nodeId);
  if (!wc || !text.trim()) return false;
  try {
    const res = await wc.executeJavaScript(buildInsertScript(text), true);
    return res === 'ok';
  } catch {
    return false; // страница ещё грузится или сменила вёрстку — кнопка просто не сработала
  }
}

// Забираем сгенерированную картинку из чата на диск и отдаём путь — дальше холст заведёт
// узел «Картинка». Файл кладём в userData, а не во «Загрузки»: это рабочий материал графа,
// и мусорить в папку пользователя незачем.
//
// ⚠️ Скачивает main той же session.defaultSession, в которой живёт вью: ссылки на картинки
// у ChatGPT подписанные и с проверкой куки — «голый» запрос получил бы 403.
export async function captureImage(
  graphId: number, nodeId: string,
): Promise<{ ok: boolean; path?: string; error?: string }> {
  const wc = activeContents(graphId, nodeId);
  if (!wc) return { ok: false, error: 'Окно чата закрыто' };

  let found: { url?: string; dataUrl?: string; error?: string };
  try {
    found = await wc.executeJavaScript(IMAGE_CAPTURE_SCRIPT, true) as typeof found;
  } catch {
    return { ok: false, error: 'Не удалось прочитать страницу чата' };
  }
  if (!found || found.error) return { ok: false, error: found?.error ?? 'Картинка не найдена' };

  try {
    let body: Buffer;
    let ext = 'png';
    if (found.dataUrl) {
      const m = /^data:image\/([a-z0-9.+-]+);base64,(.*)$/is.exec(found.dataUrl);
      if (!m) return { ok: false, error: 'Картинка пришла в непонятном формате' };
      ext = m[1]!.toLowerCase() === 'jpeg' ? 'jpg' : m[1]!.toLowerCase();
      body = Buffer.from(m[2]!, 'base64');
    } else {
      const res = await session.defaultSession.fetch(found.url!);
      if (!res.ok) return { ok: false, error: `Сайт не отдал картинку (${res.status})` };
      body = Buffer.from(await res.arrayBuffer());
      const mime = (res.headers.get('content-type') ?? '').split(';')[0]!.trim();
      const guess = mime.startsWith('image/') ? mime.slice('image/'.length) : '';
      if (guess) ext = guess === 'jpeg' ? 'jpg' : guess;
    }
    if (!body.length) return { ok: false, error: 'Картинка пришла пустой' };

    const dir = path.join(app.getPath('userData'), 'graph-images');
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${Date.now()}-${randomUUID().slice(0, 8)}.${ext.replace(/[^a-z0-9]/gi, '') || 'png'}`);
    await fsp.writeFile(file, body);
    return { ok: true, path: file };
  } catch {
    return { ok: false, error: 'Не удалось сохранить картинку' };
  }
}

// Забираем ответ. Сначала пробуем выделение — оно универсально и всегда означает явное
// намерение человека («вот этот кусок»). Если не выделено, пробуем селектор профиля.
export async function captureAnswer(
  graphId: number, nodeId: string, mode: 'selection' | 'last',
): Promise<string> {
  const wc = activeContents(graphId, nodeId);
  if (!wc) return '';
  try {
    const selected = await wc.executeJavaScript(SELECTION_SCRIPT, true) as string;
    if (typeof selected === 'string' && selected.trim()) return selected.trim();
    if (mode === 'selection') return '';

    const profile = profileForUrl(wc.getURL());
    if (!profile?.answerSelector) return '';
    const text = await wc.executeJavaScript(buildLastAnswerScript(profile.answerSelector), true) as string;
    return typeof text === 'string' ? text.trim() : '';
  } catch {
    return '';
  }
}
