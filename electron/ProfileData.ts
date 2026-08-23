import { DEFAULT_PROFILE_ID } from '../shared/profiles';
import { BookmarkManager } from './BookmarkManager';
import { HistoryManager } from './HistoryManager';
import { getActiveProfile } from './ProfileStore';
import { profileDataPath } from './ProfilePaths';

// История и закладки НА ПРОФИЛЬ. Реестр инстансов: один HistoryManager и один BookmarkManager
// на каждый открытый профиль, файлы — через ProfilePaths (единственная точка путей).
//
// ⚠️ Почему это вообще понадобилось. До сих пор партиция сессии была профильной (куки, логины,
// прокси), а история и закладки — общими: человек заводил «рабочий» профиль и видел в нём всю
// личную историю. Про это было честно написано в настройках, но написанное предупреждение —
// это заплатка, а не изоляция.
//
// ⚠️ Что здесь СОЗНАТЕЛЬНО не делается — удаление файлов. Удалили профиль → его база остаётся
// на диске сиротой. Это не недоделка: осиротевшая папка стоит мегабайты и восстановима, а
// автоматический unlink пользовательской sqlite уже один раз стоил человеку паролей и закладок
// (21.08, см. CLAUDE.md). Чистку, если понадобится, делает человек кнопкой и с предупреждением.
//
// ⚠️ Ленивое создание — СИНХРОННОЕ, а инициализация базы — асинхронная. Значит первый запрос к
// только что появившемуся профилю может вернуть пусто. Поэтому переключение профиля ЖДЁТ
// initProfileData перед тем, как разослать «обновитесь» в интерфейс: иначе человек увидел бы
// пустые закладки и решил, что они пропали.

interface ProfileData {
  history: HistoryManager;
  bookmarks: BookmarkManager;
  /** Обещание инициализации: ждать его, а не заводить второе. */
  ready: Promise<void>;
}

const byProfile = new Map<string, ProfileData>();

function make(profileId: string): ProfileData {
  const history = new HistoryManager(profileDataPath(profileId, 'history.sqlite'));
  const bookmarks = new BookmarkManager(profileDataPath(profileId, 'bookmarks.sqlite'));
  // Обе базы поднимаются параллельно и НЕ роняют друг друга: better-sqlite3 — нативный модуль,
  // и «не собрался» здесь означает «браузер без закладок», а не «браузер не запустился».
  const ready = Promise.all([
    history.initialize().catch((e: unknown) => console.warn('[ProfileData] история профиля', profileId, e)),
    bookmarks.initialize().catch((e: unknown) => console.warn('[ProfileData] закладки профиля', profileId, e)),
  ]).then(() => undefined);
  return { history, bookmarks, ready };
}

function entry(profileId: string): ProfileData {
  const id = profileId || DEFAULT_PROFILE_ID;
  let data = byProfile.get(id);
  if (!data) { data = make(id); byProfile.set(id, data); }
  return data;
}

export function historyFor(profileId: string): HistoryManager {
  return entry(profileId).history;
}

export function bookmarksFor(profileId: string): BookmarkManager {
  return entry(profileId).bookmarks;
}

/** История активного профиля — то, что показывает интерфейс здесь и сейчас. */
export function activeHistory(): HistoryManager {
  return historyFor(getActiveProfile().id);
}

/** Закладки активного профиля. */
export function activeBookmarks(): BookmarkManager {
  return bookmarksFor(getActiveProfile().id);
}

/** Поднять базы профиля и дождаться их. Зовётся на старте и при переключении профиля. */
export function initProfileData(profileId: string): Promise<void> {
  return entry(profileId).ready;
}

/** Открыт ли уже этот профиль в этом сеансе (нужно, чтобы не поднимать базы зря). */
export function isProfileDataOpen(profileId: string): boolean {
  return byProfile.has(profileId || DEFAULT_PROFILE_ID);
}
