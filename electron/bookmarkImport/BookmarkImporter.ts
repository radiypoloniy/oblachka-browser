// Абстракция над импортом закладок из другого браузера — тот же принцип, что CLAUDE.md уже
// требует для платформенно-зависимого кода (SecretStore/VPN spawn/titlebar): интерфейс + отдельные
// реализации под каждый вендор, остальной код (BookmarkManager, IPC, UI) знает только этот интерфейс.
// Сейчас есть только ChromiumBookmarkImporter.ts (Chrome/Edge/Brave/Яндекс.Браузер — общий формат).
// Firefox (places.sqlite) и Safari (plist, только macOS) добавятся позже той же формой,
// без изменений здесь и без изменений на стороне вызывающего кода.
export interface BookmarkImporter {
  readonly id: string;     // стабильный id источника, напр. 'edge', 'chrome' — для UI/лога
  readonly label: string;  // человекочитаемое имя для кнопки/пункта меню
  isAvailable(): boolean;  // профиль браузера реально найден на диске (не значит, что там есть закладки)
  import(): Promise<{ inserted: number; skipped: number }>;
}
