import type { BookmarkManager } from '../BookmarkManager';
import type { HistoryManager } from '../HistoryManager';
import type { PasswordManager } from '../PasswordManager';
import type { ImportSource, ImportDataType, ImportRunResult } from '../../shared/ipc';
import { discoverChromiumProfiles, availableDataTypes, type DiscoveredProfile } from './ChromiumDiscovery';
import { importChromiumBookmarks } from './ChromiumBookmarksReader';
import { importChromiumHistory } from './ChromiumHistoryReader';
import { importChromiumPasswords } from './ChromiumPasswordReader';
import { importYandexPasswords } from './YandexPasswordReader';
import { discoverFirefoxProfiles, firefoxDataTypes } from './FirefoxDiscovery';
import { importFirefoxPasswords } from './FirefoxPasswordReader';
import { importFirefoxBookmarks, importFirefoxHistory } from './FirefoxPlacesReader';

// Оркестратор общего импорта данных из других браузеров. Знает про discovery (какие браузеры/
// профили есть) и про менеджеры-приёмники (куда класть). Renderer видит только ImportSource/
// ImportRunResult — вся вендор-специфика (пути, форматы, расшифровка) живёт под этим слоем.
//
// Заходы дорожной карты добавляют типы данных по одному, снизу вверх по риску:
//   заход 1 — bookmarks (здесь), заход 2 — history, заход 3 — passwords.
// IMPLEMENTED_TYPES гейтит, что реально показывается пользователю в диалоге: тип из профиля
// попадёт в ImportSource.dataTypes только если его файл есть на диске И импортёр уже написан.
const IMPLEMENTED_TYPES: ReadonlySet<ImportDataType> = new Set<ImportDataType>(['bookmarks', 'history', 'passwords']);

// Firefox — не Chromium ни в чём: список профилей ведётся файлом profiles.ini, закладки и история
// лежат в одной базе, пароли шифруются схемой NSS. Поэтому у него своё discovery и свои читатели, а
// общего здесь ровно то, ради чего этот класс и существует, — единый список источников для UI.
// (Так и было задумано, см. шапку ChromiumDiscovery.ts: «добавятся отдельным discovery, тот же
// ImportManager соберёт их вместе».)
const FIREFOX = 'firefox';

function discoverAll(): DiscoveredProfile[] {
  return [...discoverChromiumProfiles(), ...discoverFirefoxProfiles()];
}

function dataTypesOf(profile: DiscoveredProfile): ImportDataType[] {
  return profile.vendorId === FIREFOX ? firefoxDataTypes(profile) : availableDataTypes(profile);
}

interface ImportDeps {
  // ⚠️ Закладки и история — ГЕТТЕРЫ: обе базы профильные (ProfileData.ts), и импорт обязан
  // попадать в тот профиль, который активен В МОМЕНТ импорта, а не при сборке зависимостей.
  bookmarks: () => BookmarkManager;
  history: () => HistoryManager;
  passwords: PasswordManager;
}

export class ImportManager {
  #deps: ImportDeps;

  constructor(deps: ImportDeps) {
    this.#deps = deps;
  }

  // Пересканируем диск на каждый вызов — профиль браузера-источника мог появиться/исчезнуть между
  // открытиями диалога, кэшировать наличие нельзя (тот же приём, что был в bookmark-only импорте).
  listSources(): ImportSource[] {
    // Наш сейф может быть недоступен (нет safeStorage/нативного модуля) — тогда пароли переносить
    // некуда, не предлагаем этот тип вообще (см. PasswordManager.available).
    const vaultReady = this.#deps.passwords.available;
    const sources: ImportSource[] = [];
    for (const profile of discoverAll()) {
      const dataTypes = dataTypesOf(profile)
        .filter((t) => IMPLEMENTED_TYPES.has(t))
        .filter((t) => t !== 'passwords' || vaultReady);
      if (dataTypes.length === 0) continue; // нечего предложить из этого профиля — не показываем
      sources.push({ id: profile.sourceId, label: profile.vendorLabel, dataTypes });
    }
    return sources;
  }

  // primaryPassword — мастер-пароль Firefox. Пустая строка это НЕ «не задан», а «задан пустым», и
  // именно так профиль по умолчанию и устроен: проверочный блок в key4.db шифруется пустым паролем.
  async run(sourceId: string, dataTypes: ImportDataType[], primaryPassword = ''): Promise<ImportRunResult> {
    const profile = discoverAll().find((p) => p.sourceId === sourceId);
    if (!profile) return {};

    const result: ImportRunResult = {};
    // Только запрошенные И поддержанные типы — не доверяем renderer прислать неподдержанное/чужое.
    for (const type of dataTypes) {
      if (!IMPLEMENTED_TYPES.has(type)) continue;
      switch (type) {
        case 'bookmarks':
          result.bookmarks = profile.vendorId === FIREFOX
            ? importFirefoxBookmarks(profile.profilePath, this.#deps.bookmarks())
            : importChromiumBookmarks(profile.profilePath, this.#deps.bookmarks());
          break;
        case 'history':
          result.history = profile.vendorId === FIREFOX
            ? importFirefoxHistory(profile.profilePath, this.#deps.history())
            : importChromiumHistory(profile.profilePath, this.#deps.history());
          break;
        case 'passwords':
          // Три схемы, а не две: Firefox — NSS (key4.db + logins.json), Яндекс.Браузер — своя
          // надстройка над Chromium (файл Ya Passman Data + доп. ключ), остальные Chromium — общая.
          if (profile.vendorId === FIREFOX) {
            result.passwords = importFirefoxPasswords(profile.profilePath, this.#deps.passwords, primaryPassword);
          } else if (profile.vendorId === 'yandex') {
            result.passwords = importYandexPasswords(profile.profilePath, profile.userDataPath, this.#deps.passwords);
          } else {
            result.passwords = importChromiumPasswords(profile.profilePath, profile.userDataPath, this.#deps.passwords);
          }
          break;
      }
    }
    return result;
  }
}

export type { DiscoveredProfile };
