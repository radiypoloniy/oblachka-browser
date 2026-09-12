// Снимок окна целиком: desktopCapturer, не BrowserWindow.capturePage.
//
// ⚠️ capturePage окна рисует только chrome-WebContents. Вкладка, AI-панель и прочие
// дочерние WebContentsView в кадр не входят — человек получил бы «рамку без страницы».
// Список источников в renderer не отдаём: отсюда уходит только PNG своего окна.
import { desktopCapturer, screen } from 'electron';
import type { BrowserWindow } from 'electron';
import { pickOwnWindowSource, windowThumbSize } from '../shared/screenshotWindow';

/** Композитору нужен кадр после того, как оверлей карточки сняли с окна. */
const HIDE_MS = 64;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/** PNG окна как data-URL, или null если своё окно среди источников не нашлось. */
export async function captureBrowserWindow(win: BrowserWindow): Promise<string | null> {
  if (win.isDestroyed()) return null;
  await wait(HIDE_MS);
  if (win.isDestroyed()) return null;
  try {
    const bounds = win.getBounds();
    const scale = screen.getDisplayMatching(bounds).scaleFactor;
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: windowThumbSize(bounds, scale),
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
    return hit.thumbnail.toDataURL();
  } catch {
    return null;
  }
}
