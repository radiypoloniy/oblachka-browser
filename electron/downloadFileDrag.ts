// Нативный OS-drag скачанного файла: renderer шлёт id, main вызывает webContents.startDrag.
//
// ⚠️ HTML5 DataTransfer из поповера на <input type="file"> страницы не работает — у рендерера
// нет пути, а file:// в dataTransfer сайты не принимают. startDrag отдаёт системе настоящий
// файл, как Проводник: и в поле на странице, и в чужое окно.
import path from 'node:path';
import { app, nativeImage } from 'electron';
import type { NativeImage, WebContents } from 'electron';
import type { DownloadManager } from './DownloadManager';

export function startDownloadFileDrag(
  downloads: DownloadManager,
  sender: WebContents,
  ids: unknown,
): boolean {
  if (sender.isDestroyed()) return false;
  const list = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && id.length > 0) : [];
  const files: string[] = [];
  for (const id of list) {
    const file = downloads.pathForRead(id);
    if (file) files.push(file);
  }
  if (files.length === 0) return false;
  try {
    sender.startDrag({
      file: files[0],
      files: files.length > 1 ? files : undefined,
      icon: dragCursorIcon(),
    });
    return true;
  } catch (err) {
    console.warn('[downloads] startDrag:', err);
    return false;
  }
}

function dragCursorIcon(): NativeImage {
  const candidates = [
    path.join(process.resourcesPath, 'brand', 'icon.png'),
    path.join(app.getAppPath(), 'build', 'icon.png'),
  ];
  for (const p of candidates) {
    const img = nativeImage.createFromPath(p);
    if (!img.isEmpty()) return img.resize({ width: 48, height: 48 });
  }
  // startDrag на macOS падает на пустой иконке; 1×1 непрозрачный пиксель — последний рубеж.
  return nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  );
}
