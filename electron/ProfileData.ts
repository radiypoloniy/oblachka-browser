import { DEFAULT_PROFILE_ID } from '../shared/profiles';
import { BookmarkManager } from './BookmarkManager';
import { HistoryManager } from './HistoryManager';
import { TrackingStore } from './TrackingStore';
import { getActiveProfile } from './ProfileStore';
import { profileDataPath } from './ProfilePaths';

// История, закладки и отслеживание товаров НА ПРОФИЛЬ. Реестр инстансов: по одному
// HistoryManager, BookmarkManager и TrackingStore на каждый открытый профиль, файлы — через
// ProfilePaths (единственная точка путей).
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

// ⚠️ Почему сюда же попало ОТСЛЕЖИВАНИЕ ТОВАРОВ, хотя это не «личные следы» в том же смысле,
// что история. Причина не в приватности, а в том, что список отслеживаемого — это рабочий
// контекст: у профиля «работа» свои закупки, у личного свои, и общий список превращает обе
// подборки в кашу, где ничего не найти. Плюс проверка цен ходит СЕССИЕЙ активного профиля
// (TrackingChecker → profileSession): держать в одном списке товары, часть которых проверяется
// не теми куками и не через тот прокси, — значит получать необъяснимые провалы проверок.

interface ProfileData {
  history: HistoryManager;
  bookmarks: BookmarkManager;
  tracking: TrackingStore;
  /** Обещание инициализации: ждать его, а не заводить второе. */
  ready: Promise<void>;
}

const byProfile = new Map<string, ProfileData>();

function make(profileId: string): ProfileData {
  const history = new HistoryManager(profileDataPath(profileId, 'history.sqlite'));
  const bookmarks = new BookmarkManager(profileDataPath(profileId, 'bookmarks.sqlite'));
  // ⚠️ Отслеживание поднимается СИНХРОННО (initialize у него не асинхронный) и внутри уже
  // молчаливо деградирует, если better-sqlite3 не собрался, — поэтому в общее ожидание ready
  // его класть незачем: к моменту возврата из make он либо готов, либо честно отключён.
  const tracking = new TrackingStore(profileDataPath(profileId, 'tracking.sqlite'));
  tracking.initialize();
  // Обе базы поднимаются параллельно и НЕ роняют друг друга: better-sqlite3 — нативный модуль,
  // и «не собрался» здесь означает «браузер без закладок», а не «браузер не запустился».
  const ready = Promise.all([
    history.initialize().catch((e: unknown) => console.warn('[ProfileData] история профиля', profileId, e)),
    bookmarks.initialize().catch((e: unknown) => console.warn('[ProfileData] закладки профиля', profileId, e)),
  ]).then(() => undefined);
  return { history, bookmarks, tracking, ready };
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

export function trackingFor(profileId: string): TrackingStore {
  return entry(profileId).tracking;
}

/** История активного профиля — то, что показывает интерфейс здесь и сейчас. */
export function activeHistory(): HistoryManager {
  return historyFor(getActiveProfile().id);
}

/** Закладки активного профиля. */
export function activeBookmarks(): BookmarkManager {
  return bookmarksFor(getActiveProfile().id);
}

/** Отслеживаемые товары активного профиля. */
export function activeTracking(): TrackingStore {
  return trackingFor(getActiveProfile().id);
}

/** Поднять базы профиля и дождаться их. Зовётся на старте и при переключении профиля. */
export function initProfileData(profileId: string): Promise<void> {
  return entry(profileId).ready;
}

/** Открыт ли уже этот профиль в этом сеансе (нужно, чтобы не поднимать базы зря). */
export function isProfileDataOpen(profileId: string): boolean {
  return byProfile.has(profileId || DEFAULT_PROFILE_ID);
}
