// Реестр webContents.id, которые загружаются в фоне не по действию пользователя (сейчас —
// только HistoryContentBackfill.ts, тихое переоткрытие старых URL для извлечения текста).
// Смысл существования: PermissionManager/DownloadManager раньше не различали, откуда пришёл
// запрос разрешения/загрузка — event приходит на уровне session.defaultSession, общей для ВСЕХ
// WebContentsView. Без этой проверки случайный window.print()/Notification.requestPermission()
// на переоткрытой в фоне странице всплыл бы как непонятный UI-промпт, не привязанный ни к одной
// видимой вкладке, а прямая ссылка на файл — реальным файлом в Загрузках.
const ids = new Set<number>();

export function markBackground(webContentsId: number): void {
  ids.add(webContentsId);
}

export function unmarkBackground(webContentsId: number): void {
  ids.delete(webContentsId);
}

export function isBackgroundWebContents(webContentsId: number): boolean {
  return ids.has(webContentsId);
}
