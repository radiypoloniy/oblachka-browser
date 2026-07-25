import path from 'node:path';
import crypto from 'node:crypto';
import type { PasswordManager } from '../PasswordManager';
import type { ImportTypeResult } from '../../shared/ipc';
import { withCopiedDb } from './chromiumSqlite';
import { readMasterKey, aesGcm256Decrypt } from './chromiumCrypto';

type Database = import('better-sqlite3').Database;

// Импорт паролей из Яндекс.Браузера. Отличается от остального Chromium (см. ChromiumPasswordReader):
//   • пароли лежат не в `Login Data`, а в `Ya Passman Data` (тот же формат SQLite, таблица logins);
//   • ключ шифрования паролей НЕ мастер-ключ напрямую: он лежит в meta.local_encryptor_data,
//     завёрнутый мастер-ключом (v10-блоб + 4-байтная сигнатура Яндекса);
//   • каждый password_value шифрован AES-256-GCM этим ключом, где AAD = SHA1 от склейки полей
//     записи (origin_url, username_element, username_value, password_element, signon_realm).
// Алгоритм сверен с PoC github.com/Goodies365/YandexDecrypt (Go). Мастер-пароль (если задан в
// Яндексе) не поддерживаем — расшифровка требует его ввода, при импорте спросить негде.

// 4-байтная сигнатура Яндекса перед реальным ключом внутри local_encryptor_data.
const YANDEX_SIGNATURE = Buffer.from([0x08, 0x01, 0x12, 0x20]);

interface YaLoginRow {
  origin_url: string;
  username_element: string | null;
  username_value: string | null;
  password_element: string | null;
  signon_realm: string | null;
  password_value: Buffer | null;
}

// Достаёт финальный ключ шифрования паролей из meta.local_encryptor_data. null — записи нет/битая.
function deriveEncryptionKey(db: Database, masterKey: Buffer): Buffer | null {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'local_encryptor_data'`).get() as
    | { value: Buffer } | undefined;
  if (!row?.value) return null;
  const blob = row.value;
  const marker = blob.indexOf('v10', 0, 'latin1');
  if (marker < 0) return null;
  // После "v10" — ровно 96 байт: [0:12] nonce, [12:96] ciphertext+tag (84 байта).
  const enc = blob.subarray(marker + 3, marker + 3 + 96);
  if (enc.length < 96) return null;
  const decrypted = aesGcm256Decrypt(masterKey, enc.subarray(0, 12), enc.subarray(12));
  if (!decrypted) return null;
  // Снимаем сигнатуру Яндекса — дальше первые 32 байта и есть ключ.
  const body = decrypted.subarray(0, YANDEX_SIGNATURE.length).equals(YANDEX_SIGNATURE)
    ? decrypted.subarray(YANDEX_SIGNATURE.length)
    : decrypted;
  return body.length >= 32 ? body.subarray(0, 32) : null;
}

// Наличие sealed_key в active_keys = задан мастер-пароль Яндекса → без него пароли не расшифровать.
function hasMasterPassword(db: Database): boolean {
  try {
    const row = db.prepare(`SELECT sealed_key FROM active_keys LIMIT 1`).get() as
      | { sealed_key: unknown } | undefined;
    return row?.sealed_key != null;
  } catch {
    return false; // таблицы нет — старая схема без мастер-пароля
  }
}

function decryptPassword(blob: Buffer, key: Buffer, row: YaLoginRow): string | null {
  if (blob.length < 12) return null;
  // AAD — SHA1 склейки полей записи через \x00 (без password_value). Порядок строго как у Яндекса.
  const toHash = [
    row.origin_url,
    row.username_element ?? '',
    row.username_value ?? '',
    row.password_element ?? '',
    row.signon_realm ?? '',
  ].join('\x00');
  const aad = crypto.createHash('sha1').update(toHash, 'utf8').digest();
  const out = aesGcm256Decrypt(key, blob.subarray(0, 12), blob.subarray(12), aad);
  return out ? out.toString('utf8') : null;
}

export function importYandexPasswords(
  profilePath: string,
  userDataPath: string,
  passwords: PasswordManager,
): ImportTypeResult | null {
  const masterKey = readMasterKey(userDataPath);
  if (!masterKey) return null;
  const dbPath = path.join(profilePath, 'Ya Passman Data');

  return withCopiedDb(dbPath, (db): ImportTypeResult => {
    const rows = db.prepare(`
      SELECT origin_url, username_element, username_value, password_element, signon_realm, password_value
      FROM logins
    `).all() as YaLoginRow[];

    // Мастер-пароль Яндекса — расшифровать нельзя (спросить негде), помечаем всё unsupported.
    if (hasMasterPassword(db)) {
      const count = rows.filter((r) => r.origin_url && r.password_value).length;
      return { inserted: 0, skipped: 0, unsupported: count };
    }

    const key = deriveEncryptionKey(db, masterKey);
    if (!key) return { inserted: 0, skipped: 0 };

    const items: Array<{ url: string; username: string; password: string }> = [];
    for (const r of rows) {
      if (!r.origin_url || !r.password_value) continue;
      const pw = decryptPassword(r.password_value, key, r);
      if (pw === null || pw === '') continue; // не расшифровалось/пусто — пропуск
      items.push({ url: r.origin_url, username: r.username_value ?? '', password: pw });
    }

    const { inserted, skipped } = passwords.bulkImport(items);
    return { inserted, skipped };
  });
}
