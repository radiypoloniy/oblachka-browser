import fs from 'node:fs';
import path from 'node:path';
import type { BookmarkManager } from '../BookmarkManager';
import type { BulkBookmarkInput, ImportTypeResult } from '../../shared/ipc';

// Чтение закладок из профиля Chromium для общего импорта (electron/browserImport/). Формат файла
// Bookmarks (JSON) одинаков у Chrome/Edge/Brave/Яндекс/Opera/Vivaldi — парсер один. Логика та же,
// что в legacy ChromiumBookmarkImporter.ts (который остаётся для дропдауна панели закладок), но
// здесь на вход даётся конкретный путь профиля из discovery, а не хардкод Default.

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

// Chrome/WebKit-эпоха — микросекунды с 1601-01-01 UTC. Через BigInt: числа в файле (~17 цифр) уже
// превышают Number.MAX_SAFE_INTEGER, терять точность до финального деления нельзя.
const CHROME_EPOCH_OFFSET_US = 11_644_473_600_000_000n;
function chromeTimeToUnixMs(raw: string | undefined): number {
  if (!raw) return Date.now();
  try {
    return Number((BigInt(raw) - CHROME_EPOCH_OFFSET_US) / 1000n);
  } catch {
    return Date.now();
  }
}

// Плоский обход: все страницы (type==='url') на любой глубине сплющиваются в корень — UI папок
// закладок пока нет (см. BookmarkManager.ts). Факт «была в папке X» теряется — сознательный
// компромисс, как и в legacy-импортёре.
function flatten(node: ChromiumBookmarkNode, out: BulkBookmarkInput[]): void {
  if (node.type === 'url' && node.url) {
    out.push({
      parentId: null,
      url: node.url,
      title: node.name || node.url,
      position: out.length,
      createdAt: chromeTimeToUnixMs(node.date_added),
    });
    return;
  }
  for (const child of node.children ?? []) flatten(child, out);
}

// Возвращает null при провале чтения/парса (файл битый/нет доступа) — ImportManager отличит это
// от {inserted:0} (файл прочитан, но закладок не было).
export function importChromiumBookmarks(profilePath: string, bookmarks: BookmarkManager): ImportTypeResult | null {
  try {
    const raw = fs.readFileSync(path.join(profilePath, 'Bookmarks'), 'utf8');
    const data = JSON.parse(raw) as ChromiumBookmarksFile;
    const items: BulkBookmarkInput[] = [];
    for (const root of Object.values(data.roots ?? {})) flatten(root, items);
    return bookmarks.bulkInsert(items);
  } catch (e) {
    console.warn('[Import] bookmarks read error:', (e as Error).message);
    return null;
  }
}
