import fs from 'node:fs';
import path from 'node:path';
import type { BookmarkManager } from '../BookmarkManager';
import type { ImportBookmarkNode } from '../../shared/ipc';
import type { BookmarkImporter } from './BookmarkImporter';

interface ChromiumBookmarkNode {
  type: 'url' | 'folder';
  name: string;
  url?: string;
  date_added?: string;
  children?: ChromiumBookmarkNode[];
}

interface ChromiumBookmarksFile {
  roots: Record<string, ChromiumBookmarkNode>;
}

// Chrome/WebKit-эпоха — микросекунды с 1601-01-01 UTC, не Unix (1970-01-01). Разница — ровно
// 11644473600 секунд. Через BigInt: сами числа в файле (~17 цифр) уже превышают
// Number.MAX_SAFE_INTEGER — терять точность до финального деления на 1000 нельзя.
const CHROME_EPOCH_OFFSET_US = 11_644_473_600_000_000n;
function chromeTimeToUnixMs(raw: string | undefined): number {
  if (!raw) return Date.now();
  try {
    const micros = BigInt(raw);
    return Number((micros - CHROME_EPOCH_OFFSET_US) / 1000n);
  } catch {
    return Date.now();
  }
}

// ⚠️ Обход СОХРАНЯЕТ дерево. Прежний сплющивал всё в корень с пометкой «у нас пока нет UI папок»
// — папки появились, и сплющивание стало главной претензией к импорту: два десятка папок из
// Chrome превращались в плоскую кучу из сотен строк. Пустые папки не переносим (см.
// BookmarkManager.bulkInsertTree): в живом профиле их десятки.
function toTree(node: ChromiumBookmarkNode): ImportBookmarkNode | null {
  if (node.type === 'url') {
    return node.url
      ? { kind: 'link', title: node.name || node.url, url: node.url, createdAt: chromeTimeToUnixMs(node.date_added) }
      : null;
  }
  const children = (node.children ?? []).map(toTree).filter((n): n is ImportBookmarkNode => n !== null);
  if (children.length === 0) return null;
  return { kind: 'folder', title: node.name || 'Без названия', createdAt: chromeTimeToUnixMs(node.date_added), children };
}

export class ChromiumBookmarkImporter implements BookmarkImporter {
  readonly id: string;
  readonly label: string;
  #bookmarksPath: string;
  #bookmarks: BookmarkManager;

  constructor(id: string, label: string, profileDir: string, bookmarks: BookmarkManager) {
    this.id = id;
    this.label = label;
    this.#bookmarks = bookmarks;
    // %LOCALAPPDATA%\<профиль вендора>\User Data\Default\Bookmarks — общее расположение для всех
    // Chromium-браузеров на Windows (профиль в Local, не Roaming, в отличие от нашего userData).
    const localAppData = process.env.LOCALAPPDATA ?? '';
    this.#bookmarksPath = path.join(localAppData, profileDir, 'User Data', 'Default', 'Bookmarks');
  }

  isAvailable(): boolean {
    try {
      return fs.existsSync(this.#bookmarksPath);
    } catch {
      return false;
    }
  }

  async import(): Promise<{ inserted: number; skipped: number }> {
    try {
      const raw = fs.readFileSync(this.#bookmarksPath, 'utf8');
      const data = JSON.parse(raw) as ChromiumBookmarksFile;
      // Содержимое корней Chrome кладём на наш корень, а не в папки с их именами: «Панель
      // закладок» для человека — место, а не папка, и заворачивать её значило бы добавить
      // уровень, которого у него не было.
      const items: ImportBookmarkNode[] = [];
      for (const root of Object.values(data.roots ?? {})) {
        const tree = toTree(root);
        if (tree?.children) items.push(...tree.children);
      }
      return this.#bookmarks.bulkInsertTree(items, null);
    } catch (e) {
      console.warn(`[BookmarkImport:${this.id}] import error:`, (e as Error).message);
      return { inserted: 0, skipped: 0 };
    }
  }
}

// Известные на Windows Chromium-производные — делят один и тот же формат/расположение профиля
// (отличается только путь до вендора), поэтому один параметризуемый класс, а не 4 копии.
export function createChromiumImporters(bookmarks: BookmarkManager): BookmarkImporter[] {
  return [
    new ChromiumBookmarkImporter('chrome', 'Google Chrome', path.join('Google', 'Chrome'), bookmarks),
    new ChromiumBookmarkImporter('edge', 'Microsoft Edge', path.join('Microsoft', 'Edge'), bookmarks),
    new ChromiumBookmarkImporter('brave', 'Brave', path.join('BraveSoftware', 'Brave-Browser'), bookmarks),
    new ChromiumBookmarkImporter('yandex', 'Яндекс.Браузер', path.join('Yandex', 'YandexBrowser'), bookmarks),
  ];
}
