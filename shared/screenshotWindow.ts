// Выбор своего окна среди источников desktopCapturer — без Electron, чтобы прогон
// гонял обычным node (scripts/screenshot-window-check.mjs).
//
// ⚠️ BrowserWindow.capturePage() дочерние WebContentsView не видит: вкладка, AI-панель,
// поповеры в кадр не попадут. Основной путь — склейка capturePage каждой вью
// (electron/screenshotCapture.ts). desktopCapturer здесь — запасной выбор своего окна.
// Список окон в renderer не отдаём: оттуда достаточно слоёв своего кадра.

export interface ShotLayer {
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WindowLayers {
  width: number;
  height: number;
  layers: ShotLayer[];
}

export interface WindowSourcePick {
  id: string;
  name: string;
}

/**
 * Своё окно: сначала точный mediaSourceId, потом дрейф суффикса Electron,
 * и только если совпадение по заголовку единственное. Два «Oblako» по имени
 * не различить — тогда null, а не «первый попавшийся».
 */
export function pickOwnWindowSource(
  sources: WindowSourcePick[],
  mediaSourceId: string,
  title: string,
): WindowSourcePick | null {
  if (!mediaSourceId) return null;
  const exact = sources.find((s) => s.id === mediaSourceId);
  if (exact) return exact;
  const drifted = sources.find((s) => (
    s.id.startsWith(`${mediaSourceId}:`) || mediaSourceId.startsWith(`${s.id}:`)
  ));
  if (drifted) return drifted;
  if (!title) return null;
  const named = sources.filter((s) => s.name === title);
  return named.length === 1 ? named[0]! : null;
}

/** Физический размер миниатюры: DIP окна × scaleFactor. Нулевой/битый фактор = 1×. */
export function windowThumbSize(
  bounds: { width: number; height: number },
  scaleFactor: number,
): { width: number; height: number } {
  const scale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  return {
    width: Math.max(1, Math.round(bounds.width * scale)),
    height: Math.max(1, Math.round(bounds.height * scale)),
  };
}
