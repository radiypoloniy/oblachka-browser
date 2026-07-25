import { WebContentsView } from 'electron';
import type { BrowserWindow } from 'electron';
import { markBackground, unmarkBackground } from './BackgroundWebContents';
import { extractEnrichedText } from './HistoryIndexer';

// Извлечение читаемого текста источника-URL для блокнота (NotebookLM-хаб). Тот же приём, что
// HistoryContentBackfill: скрытая фоновая WebContentsView (нулевые bounds, помечена background —
// не попадает в историю/загрузки/разрешения) грузит страницу, дальше Readability через уже
// готовый extractEnrichedText (HistoryIndexer). Локально, но это реальный сетевой заход на сайт
// (через сессию/VPN приложения) — как и обычная навигация; вызывается по явному добавлению источника.

const PAGE_LOAD_TIMEOUT_MS = 20_000;
const MAX_TEXT_CHARS = 200_000; // защита от гигантских страниц — на грунтинг всё равно режем сильнее

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

export async function extractUrlText(win: BrowserWindow, url: string): Promise<{ ok: boolean; title?: string; text?: string }> {
  if (win.isDestroyed()) return { ok: false };
  const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;

  const view = new WebContentsView({
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  markBackground(view.webContents.id);
  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 0, height: 0 });

  try {
    const ok = await withTimeout(view.webContents.loadURL(target).then(() => true), PAGE_LOAD_TIMEOUT_MS);
    if (!ok || view.webContents.isDestroyed()) return { ok: false };
    const text = await extractEnrichedText(view.webContents, view.webContents.getURL());
    const title = view.webContents.isDestroyed() ? undefined : (view.webContents.getTitle() || undefined);
    if (!text) return { ok: false, title };
    return { ok: true, title, text: text.slice(0, MAX_TEXT_CHARS) };
  } catch {
    return { ok: false }; // DNS/HTTP/редирект/таймаут — источник не извлёкся, UI покажет ошибку
  } finally {
    unmarkBackground(view.webContents.id);
    try { if (!win.isDestroyed()) win.contentView.removeChildView(view); } catch { /* окно закрылось */ }
    try { if (!view.webContents.isDestroyed()) view.webContents.close(); } catch { /* уже закрыт */ }
  }
}
