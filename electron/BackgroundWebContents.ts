// Реестр webContents.id, которые загружаются в фоне не по действию пользователя
// (HistoryContentBackfill, HistoryIdleCatchup, NotebookExtract, печать PDF).
// Смысл существования: PermissionManager/DownloadManager раньше не различали, откуда пришёл
// запрос разрешения/загрузка — event приходит на уровне session.defaultSession, общей для ВСЕХ
// WebContentsView. Без этой проверки случайный window.print()/Notification.requestPermission()
// на переоткрытой в фоне странице всплыл бы как непонятный UI-промпт, не привязанный ни к одной
// видимой вкладке, а прямая ссылка на файл — реальным файлом в Загрузках.
//
// ⚠️ Звук глушим здесь, а не у каждого вызывающего: Electron по умолчанию разрешает автоплей
// без жеста, скрытая вью живая (JS, сеть, куки), и YouTube в тихом доборе истории начинал
// играть рекламу в пустоту. Нулевые bounds страницу не mute'ят.
import type { WebContents, WebPreferences } from 'electron';

const ids = new Set<number>();

export const BACKGROUND_WEB_PREFERENCES: Pick<WebPreferences, 'sandbox' | 'contextIsolation' | 'nodeIntegration' | 'autoplayPolicy'> = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  autoplayPolicy: 'document-user-activation-required',
};

export function markBackground(wc: WebContents): void {
  ids.add(wc.id);
  try { wc.setAudioMuted(true); } catch { /* уже уничтожен */ }
}

export function unmarkBackground(webContentsId: number): void {
  ids.delete(webContentsId);
}

export function isBackgroundWebContents(webContentsId: number): boolean {
  return ids.has(webContentsId);
}
