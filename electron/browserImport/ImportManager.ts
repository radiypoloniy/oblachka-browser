import type { BookmarkManager } from '../BookmarkManager';
import type { HistoryManager } from '../HistoryManager';
import type { PasswordManager } from '../PasswordManager';
import type { ImportSource, ImportDataType, ImportRunResult } from '../../shared/ipc';
import { discoverChromiumProfiles, availableDataTypes, type DiscoveredProfile } from './ChromiumDiscovery';
import { importChromiumBookmarks } from './ChromiumBookmarksReader';
import { importChromiumHistory } from './ChromiumHistoryReader';
import { importChromiumPasswords } from './ChromiumPasswordReader';
import { importYandexPasswords } from './YandexPasswordReader';

// Оркестратор общего импорта данных из других браузеров. Знает про discovery (какие браузеры/
// профили есть) и про менеджеры-приёмники (куда класть). Renderer видит только ImportSource/
// ImportRunResult — вся вендор-специфика (пути, форматы, расшифровка) живёт под этим слоем.
//
// Заходы дорожной карты добавляют типы данных по одному, снизу вверх по риску:
//   заход 1 — bookmarks (здесь), заход 2 — history, заход 3 — passwords.
// IMPLEMENTED_TYPES гейтит, что реально показывается пользователю в диалоге: тип из профиля
// попадёт в ImportSource.dataTypes только если его файл есть на диске И импортёр уже написан.
const IMPLEMENTED_TYPES: ReadonlySet<ImportDataType> = new Set<ImportDataType>(['bookmarks', 'history', 'passwords']);

interface ImportDeps {
  bookmarks: BookmarkManager;
  history: HistoryManager;
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
    for (const profile of discoverChromiumProfiles()) {
      const dataTypes = availableDataTypes(profile)
        .filter((t) => IMPLEMENTED_TYPES.has(t))
        .filter((t) => t !== 'passwords' || vaultReady);
      if (dataTypes.length === 0) continue; // нечего предложить из этого профиля — не показываем
      sources.push({ id: profile.sourceId, label: profile.vendorLabel, dataTypes });
    }
    return sources;
  }

  async run(sourceId: string, dataTypes: ImportDataType[]): Promise<ImportRunResult> {
    const profile = discoverChromiumProfiles().find((p) => p.sourceId === sourceId);
    if (!profile) return {};

    const result: ImportRunResult = {};
    // Только запрошенные И поддержанные типы — не доверяем renderer прислать неподдержанное/чужое.
    for (const type of dataTypes) {
      if (!IMPLEMENTED_TYPES.has(type)) continue;
      switch (type) {
        case 'bookmarks':
          result.bookmarks = importChromiumBookmarks(profile.profilePath, this.#deps.bookmarks);
          break;
        case 'history':
          result.history = importChromiumHistory(profile.profilePath, this.#deps.history);
          break;
        case 'passwords':
          // Яндекс.Браузер — своя схема (файл Ya Passman Data + доп. ключ), остальные Chromium — общая.
          result.passwords = profile.vendorId === 'yandex'
            ? importYandexPasswords(profile.profilePath, profile.userDataPath, this.#deps.passwords)
            : importChromiumPasswords(profile.profilePath, profile.userDataPath, this.#deps.passwords);
          break;
      }
    }
    return result;
  }
}

export type { DiscoveredProfile };
