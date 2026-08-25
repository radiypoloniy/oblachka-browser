// Меню звезды закладки: сохранить страницу и предложить, куда её положить.
//
// ⚠️ Вынесено из main.ts по правилу «композитор — не место для логики»
// (docs/architecture-code.md, §Композитор). Поймал это, кстати, не человек, а сторож структуры:
// правка ключа страницы добавила в main.ts шесть строк, файл перешагнул свою запись в базе, и
// проверка не пустила — ровно то, ради чего храповик и заводился.
//
// ⚠️ Звезда НЕ ТУМБЛЕР. Прежнее «нажал — сохранил в корень, нажал ещё — удалил» не давало
// положить страницу в папку вовсе: единственным местом закладки был корень, и разгребать его
// приходилось потом руками. Клик сохраняет и сразу предлагает папку — тем же меню, что Ctrl+D;
// удаление осталось последним пунктом того же меню.
import { Menu } from 'electron';
import type { BrowserWindow, MenuItemConstructorOptions } from 'electron';
import { pageKey } from '../shared/pageKey';
import type { BookmarkNode } from '../shared/ipc';
import type { BookmarkManager } from './BookmarkManager';
import type { TabManager } from './TabManager';

export interface BookmarkMenuDeps {
  /** Закладки АКТИВНОГО профиля — функцией, а не объектом: профиль переключается на ходу. */
  bookmarks: () => BookmarkManager;
  /** Разослать «закладки изменились» в интерфейс всех окон. */
  notifyChanged: () => void;
  /**
   * Подсказка папки моделью. Возвращает id папки или null.
   *
   * ⚠️ Приходит извне, потому что это единственная часть меню, которая знает про AI: сам модуль
   * обязан работать и без модели — тогда подсказки просто не будет.
   */
  suggestFolder: (title: string, url: string, folders: { id: number; path: string }[]) => Promise<number | null>;
}

let deps: BookmarkMenuDeps | null = null;

export function initBookmarkMenu(d: BookmarkMenuDeps): void {
  deps = d;
}

export async function showBookmarkMenu(win: BrowserWindow, tabs: TabManager): Promise<void> {
  // Модуль не поднят (теоретически — только при сбое сборки контекста): молчим, а не падаем
  // посреди пользовательского жеста.
  if (!deps) return;
  const wc = tabs.getActiveWebContents();
  if (!wc) return;
  const url = wc.getURL();
  if (!url || !/^https?:/i.test(url)) return; // хаб и служебные страницы в закладки не идут
  const title = wc.getTitle() || url;

  // ⚠️ Ищем по КЛЮЧУ СТРАНИЦЫ, а не по точной строке (shared/pageKey.ts). Иначе площадка,
  // переписывающая метки шаринга в адресе (Ozon и подобные), давала бы на каждое нажатие звезды
  // новую запись: сохранённая ссылка и текущая отличались бы параметрами, которые ничего не
  // значат. Живая жалоба 25.08.2026 — дубль в панели и звезда, загорающаяся только после него.
  const existing = deps!.bookmarks().listTree();
  const key = pageKey(url);
  const findByUrl = (nodes: BookmarkNode[]): BookmarkNode | null => {
    for (const n of nodes) {
      if (n.kind === 'link' && n.url && pageKey(n.url) === key) return n;
      const hit = n.children ? findByUrl(n.children) : null;
      if (hit) return hit;
    }
    return null;
  };

  let entry = findByUrl(existing);
  if (!entry) {
    const added = deps!.bookmarks().add(url, title);
    if (!added) return;
    entry = { ...added, children: undefined };
    deps!.notifyChanged();
  }
  const bookmarkId = entry.id;
  const currentParent = entry.parentId;

  // Плоский перечень папок с отступами — вложенность в нативном меню показать больше нечем.
  // Путь от корня собираем тем же обходом: он нужен модели, чтобы различить две папки «Разное»
  // в разных родителях (в самом меню вложенность видна отступом).
  const folders: { id: number; title: string; depth: number; path: string }[] = [];
  const walk = (nodes: BookmarkNode[], depth: number, prefix: string): void => {
    for (const n of nodes) {
      if (n.kind !== 'folder') continue;
      const path = prefix ? `${prefix} / ${n.title}` : n.title;
      folders.push({ id: n.id, title: n.title, depth, path });
      walk(n.children ?? [], depth + 1, path);
    }
  };
  walk(deps!.bookmarks().listTree(), 0, '');

  // Подсказка папки (AI-IDEAS.md №2) — только для закладки, лежащей В КОРНЕ. То, что человек уже
  // разложил руками, модель не трогает: это его решение, и мы его не понимаем (тот же принцип,
  // что в BookmarkOrganizer.ts). На холодной модели вернётся null мгновенно, без задержки меню.
  const suggestedId = currentParent === null
    ? await deps!.suggestFolder(title, url, folders.map((f) => ({ id: f.id, path: f.path })))
    : null;
  const suggested = folders.find((f) => f.id === suggestedId) ?? null;
  // За время генерации окно могли закрыть — всплывать тогда некуда.
  if (win.isDestroyed()) return;

  const pick = (parentId: number | null): void => {
    if (deps!.bookmarks().move(bookmarkId, parentId)) deps!.notifyChanged();
  };

  const template: MenuItemConstructorOptions[] = [
    { label: 'Сохранено в закладки', enabled: false },
    // ⚠️ Подсказка — ОТДЕЛЬНЫЙ пункт-действие, а не предвыбранный radio в списке ниже. Отметка
    // означает «закладка лежит здесь», и поставить её на непроизошедший перенос значило бы
    // соврать: человек закрыл бы меню, не нажав ничего, а закладка осталась бы в корне.
    ...(suggested
      ? [
          { type: 'separator' } as MenuItemConstructorOptions,
          { label: `Положить в «${suggested.title}»`, click: () => pick(suggested.id) },
        ]
      : []),
    { type: 'separator' },
    { label: 'Все закладки', type: 'radio', checked: currentParent === null, click: () => pick(null) },
    ...folders.map((f): MenuItemConstructorOptions => ({
      label: `${'    '.repeat(f.depth)}${f.title}`,
      type: 'radio',
      checked: currentParent === f.id,
      click: () => pick(f.id),
    })),
    { type: 'separator' },
    {
      label: 'Удалить из закладок',
      click: () => { deps!.bookmarks().remove(bookmarkId); deps!.notifyChanged(); },
    },
  ];
  Menu.buildFromTemplate(template).popup({ window: win });
}
