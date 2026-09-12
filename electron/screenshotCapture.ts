// Снимок окна: склейка capturePage дочерних вью, не desktopCapturer и не hide оверлея.
//
// ⚠️ capturePage каждой вью снимает ЕЁ содержимое, даже если сверху лежит редактор снимка.
// Прятать карточку не нужно — не вспыхивает живая страница. desktopCapturer остаётся
// запасным путём, если склейка не дала ни одного слоя (чужой тип View, пустое окно).
import { desktopCapturer, screen } from 'electron';
import type { BrowserWindow, WebContentsView } from 'electron';
import {
  pickOwnWindowSource, windowThumbSize,
  type WindowLayers, type ShotLayer,
} from '../shared/screenshotWindow';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

async function stitchViews(win: BrowserWindow, skip: WebContentsView | null): Promise<WindowLayers | null> {
  if (win.isDestroyed()) return null;
  const [cw, ch] = win.getContentSize();
  const scale = screen.getDisplayMatching(win.getBounds()).scaleFactor;
  const width = Math.max(1, Math.round(cw * scale));
  const height = Math.max(1, Math.round(ch * scale));
  const layers: ShotLayer[] = [];
  for (const child of win.contentView.children) {
    if (skip && child === skip) continue;
    const view = child as WebContentsView;
    if (typeof view.getVisible === 'function' && !view.getVisible()) continue;
    const wc = view.webContents;
    if (!wc || wc.isDestroyed()) continue;
    const b = view.getBounds();
    if (b.width < 2 || b.height < 2) continue;
    try {
      const img = await wc.capturePage();
      if (img.isEmpty()) continue;
      const sz = img.getSize();
      layers.push({
        url: img.toDataURL(),
        x: Math.round(b.x * scale),
        y: Math.round(b.y * scale),
        w: sz.width,
        h: sz.height,
      });
    } catch { /* вью закрылась посреди склейки */ }
  }
  return layers.length > 0 ? { width, height, layers } : null;
}

/** Запасной путь: одно окно целиком. Вызывающий прячет редактор, иначе он в кадре. */
export async function captureDesktop(win: BrowserWindow): Promise<WindowLayers | null> {
  if (win.isDestroyed()) return null;
  await wait(64);
  if (win.isDestroyed()) return null;
  try {
    const bounds = win.getBounds();
    const scale = screen.getDisplayMatching(bounds).scaleFactor;
    const size = windowThumbSize(bounds, scale);
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: size,
      fetchWindowIcons: false,
    });
    const own = pickOwnWindowSource(
      sources.map((s) => ({ id: s.id, name: s.name })),
      win.getMediaSourceId(),
      win.getTitle(),
    );
    if (!own) return null;
    const hit = sources.find((s) => s.id === own.id);
    if (!hit || hit.thumbnail.isEmpty()) return null;
    const sz = hit.thumbnail.getSize();
    return {
      width: sz.width,
      height: sz.height,
      layers: [{ url: hit.thumbnail.toDataURL(), x: 0, y: 0, w: sz.width, h: sz.height }],
    };
  } catch {
    return null;
  }
}

/** Слои окна для склейки в renderer. skip — вью редактора, её в кадр не кладём. */
export async function captureBrowserWindow(
  win: BrowserWindow,
  skip: WebContentsView | null,
): Promise<WindowLayers | null> {
  return stitchViews(win, skip);
}
