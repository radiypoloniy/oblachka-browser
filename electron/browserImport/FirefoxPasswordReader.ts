import fs from 'node:fs';
import path from 'node:path';
import type { PasswordManager } from '../PasswordManager';
import type { ImportTypeResult } from '../../shared/ipc';
import { parseLoginItem } from '../../shared/firefoxAsn1';
import { readLoginKey, decryptLoginField } from './firefoxCrypto';

// Импорт паролей из профиля Firefox. Ключ разворачивается из key4.db (см. firefoxCrypto.ts), сами
// записи лежат в logins.json — обычном JSON, где зашифрованы только имя и пароль.

interface FirefoxLogin {
  // Адрес сайта. Firefox 70+ во внутреннем API переименовал hostname → origin, но НА ДИСКЕ
  // продолжает писать hostname; встречаются оба, поэтому читаем оба.
  hostname?: string;
  origin?: string;
  encryptedUsername?: string;
  encryptedPassword?: string;
  // 1 — поля зашифрованы (единственный живой вариант). 0 — открытый текст из профилей эпохи
  // signons.txt; такие Firefox сам мигрирует при первом запуске, но файл мог приехать копированием.
  encType?: number;
}

interface LoginsFile { logins?: FirefoxLogin[] }

/**
 * Пароли профиля Firefox → наш сейф.
 *
 * primaryPassword — мастер-пароль Firefox (по умолчанию пустая строка). Если он задан и не подошёл,
 * возвращается результат с needsPrimaryPassword: UI покажет поле ввода, а не молчаливый ноль.
 *
 * null — прочитать не удалось совсем (нет файла/битый JSON), это отличается от «прочитали, но
 * переносить было нечего» (см. ImportRunResult).
 */
export function importFirefoxPasswords(
  profilePath: string,
  passwords: PasswordManager,
  primaryPassword: string,
): ImportTypeResult | null {
  let file: LoginsFile;
  try {
    file = JSON.parse(fs.readFileSync(path.join(profilePath, 'logins.json'), 'utf8')) as LoginsFile;
  } catch (e) {
    console.warn('[Import] logins.json read error:', (e as Error).message);
    return null;
  }
  const logins = file.logins ?? [];
  if (logins.length === 0) return { inserted: 0, skipped: 0 };

  // Ключ разворачиваем ПОСЛЕ чтения файла: если переносить нечего, незачем и просить мастер-пароль.
  const keyResult = readLoginKey(profilePath, primaryPassword);
  if (!keyResult.ok) {
    if (keyResult.reason === 'primary-password') {
      return { inserted: 0, skipped: 0, needsPrimaryPassword: true };
    }
    return null;
  }

  const items: Array<{ url: string; username: string; password: string }> = [];
  let unsupported = 0;
  for (const login of logins) {
    const url = login.origin ?? login.hostname ?? '';
    if (!url) { unsupported++; continue; }
    // ⚠️ android://… — учётки ПРИЛОЖЕНИЙ, приехавшие синхронизацией с Firefox для Android (на живом
    // профиле их 27 из 225). Переносить их нельзя, и это не лень: `new URL('android://…').origin`
    // даёт строку "null" для любой такой записи, то есть все они легли бы в сейф под ОДНИМ origin,
    // передавили друг друга на дедупе по origin+username и всё равно никогда бы не подставились —
    // автозаполнение сопоставляет по веб-origin. Считаем их не поддержанными: в отчёте это видно
    // числом, а не превращается в молчаливую порчу списка паролей.
    if (!/^https?:\/\//i.test(url)) { unsupported++; continue; }
    // encType 0 — открытый текст (профиль из эпохи до NSS-шифрования). Не поддерживаем осознанно:
    // такие файлы Firefox мигрирует сам при первом запуске, а угадывать формат ради края, которого
    // у живого пользователя быть не может, — лишний непроверяемый код.
    if (login.encType !== undefined && login.encType !== 1) { unsupported++; continue; }
    if (!login.encryptedPassword) { unsupported++; continue; }

    const password = decryptField(keyResult.key, login.encryptedPassword);
    if (password === null) { unsupported++; continue; }
    // Имя пользователя может быть пустым по-настоящему (сайты с входом по одному лишь паролю), и
    // это НЕ ошибка — в отличие от пароля, без которого запись бессмысленна.
    const username = login.encryptedUsername ? (decryptField(keyResult.key, login.encryptedUsername) ?? '') : '';
    items.push({ url, username, password });
  }

  const result = passwords.bulkImport(items);
  return unsupported > 0 ? { ...result, unsupported } : result;
}

/** base64-поле logins.json → строка. null — битое поле или чужой ключ (запись пропускаем). */
function decryptField(loginKey: Buffer, encrypted: string): string | null {
  let raw: Buffer;
  try {
    raw = Buffer.from(encrypted, 'base64');
  } catch {
    return null;
  }
  const item = parseLoginItem(new Uint8Array(raw));
  if (!item) return null;
  return decryptLoginField(loginKey, item);
}
