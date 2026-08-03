import fs from 'node:fs';
import path from 'node:path';
import type { BookmarkManager } from '../BookmarkManager';
import type { ImportBookmarkNode, ImportTypeResult } from '../../shared/ipc';

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

// ⚠️ Обход СОХРАНЯЕТ дерево. Раньше здесь всё сплющивалось в корень с пометкой «UI папок пока
// нет» — теперь он есть, и сплющивание превратилось в главную претензию к импорту: человек с
// двумя десятками папок в Chrome получал плоскую кучу из сотен строк, разгребать которую
// вручную нереально.
function toTree(node: ChromiumBookmarkNode): ImportBookmarkNode | null {
  if (node.type === 'url') {
    return node.url
      ? { kind: 'link', title: node.name || node.url, url: node.url, createdAt: chromeTimeToUnixMs(node.date_added) }
      : null;
  }
  const children = (node.children ?? []).map(toTree).filter((n): n is ImportBookmarkNode => n !== null);
  if (children.length === 0) return null; // пустые папки не переносим, см. bulkInsertTree
  return { kind: 'folder', title: node.name || 'Без названия', createdAt: chromeTimeToUnixMs(node.date_added), children };
}

// Возвращает null при провале чтения/парса (файл битый/нет доступа) — ImportManager отличит это
// от {inserted:0} (файл прочитан, но закладок не было).
export function importChromiumBookmarks(profilePath: string, bookmarks: BookmarkManager): ImportTypeResult | null {
  try {
    const raw = fs.readFileSync(path.join(profilePath, 'Bookmarks'), 'utf8');
    const data = JSON.parse(raw) as ChromiumBookmarksFile;
    // ⚠️ Содержимое КОРНЕЙ Chrome (панель закладок, другие, синхронизированные) кладётся на наш
    // корень, а не в папки с их именами: у человека «Панель закладок» — это не папка, а место,
    // и заворачивать её в папку значило бы добавить уровень, которого у него не было.
    const items: ImportBookmarkNode[] = [];
    for (const root of Object.values(data.roots ?? {})) {
      const tree = toTree(root);
      if (tree?.children) items.push(...tree.children);
    }
    return bookmarks.bulkInsertTree(items, null);
  } catch (e) {
    console.warn('[Import] bookmarks read error:', (e as Error).message);
    return null;
  }
}
