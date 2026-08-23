import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_PROFILE_ID, sanitizeProfileId } from '../shared/profiles';

// Единственное место, откуда берутся пути к файлам данных ПРОФИЛЯ.
//
// Зачем отдельный модуль на две строки логики: до него `app.getPath('userData')` стоял в 34
// местах 31 файла, и «сделать данные профильными» означало найти их все глазами. Теперь новый
// файл данных становится профильным одной строкой, а не ревизией проекта.
//
// ⚠️ ГЛАВНОЕ ПРАВИЛО, ЛОМАЮЩЕЕ ДАННЫЕ, ЕСЛИ ЕГО НАРУШИТЬ: у профиля по умолчанию файлы остаются
// ТАМ ЖЕ, ГДЕ ЛЕЖАЛИ, под теми же именами — `userData/history.sqlite`, `userData/bookmarks.sqlite`.
// Никаких переносов «для единообразия»: это боевые базы человека с его историей и закладками, и
// любая миграция их положения — это шанс потерять их ради красоты раскладки. Переезд по папкам
// заводится только для НОВЫХ профилей, у которых терять нечего.
//
// Та же логика, что у партиции сессии (shared/profiles.ts::profilePartition): у основного она
// null — сессия по умолчанию, где уже лежат куки человека.

/** Папка данных профиля. Для основного — сам `userData`, см. правило в шапке. */
export function profileDataDir(profileId: string): string {
  const base = app.getPath('userData');
  if (profileId === DEFAULT_PROFILE_ID) return base;
  // sanitizeProfileId — тот же, что чистит имя партиции: id в конечном счёте становится путём.
  return path.join(base, 'profiles', sanitizeProfileId(profileId));
}

/**
 * Путь к файлу данных профиля.
 *
 * ⚠️ Папку создаём ЗДЕСЬ и лениво, а не при заведении профиля: профиль может быть создан, но
 * ни разу не открыт, и плодить пустые папки на диске незачем. better-sqlite3 сам папку не
 * создаёт — он падает с SQLITE_CANTOPEN, а у нас это означало бы «профиль без истории» молча.
 */
export function profileDataPath(profileId: string, fileName: string): string {
  const dir = profileDataDir(profileId);
  if (profileId !== DEFAULT_PROFILE_ID) ensureDir(dir);
  return path.join(dir, fileName);
}

function ensureDir(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.warn('[ProfilePaths] не удалось создать папку профиля:', dir, (e as Error).message);
  }
}
