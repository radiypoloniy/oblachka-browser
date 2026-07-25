import path from 'node:path';
import type { PasswordManager } from '../PasswordManager';
import type { ImportTypeResult } from '../../shared/ipc';
import { withCopiedDb } from './chromiumSqlite';
import { dpapiUnprotect } from './dpapi';
import { readMasterKey, aesGcm256Decrypt, GCM_NONCE_LEN } from './chromiumCrypto';

// Импорт паролей из «обычных» Chromium-браузеров (Chrome/Edge/Brave/Opera/Vivaldi). Яндекс.Браузер
// использует свою надстройку (другой файл и доп. ключ) — см. YandexPasswordReader. Схема (Windows):
//   1. Мастер-ключ AES-256 из Local State (см. chromiumCrypto.readMasterKey).
//   2. Каждый password_value в таблице logins (Login Data) — блоб с префиксом версии:
//      - "v10"/"v11": AES-256-GCM (nonce[12] + ciphertext + tag[16]) на мастер-ключе.
//      - "v20": App-Bound Encryption (Chrome 127+) — ключ дополнительно завёрнут в SYSTEM-DPAPI,
//        развернуть без прав SYSTEM нельзя. Помечаем unsupported (см. CLAUDE.md), не переносим.
//      - без версии (старый Chrome): весь блоб — чистый DPAPI, разворачиваем напрямую.

interface LoginRow {
  origin_url: string;
  username_value: string | null;
  password_value: Buffer | null;
}

// 'unsupported' — v20 (App-Bound), физически не переносим. null — битый блоб/сбой (пропуск, не
// unsupported — это не вина ABE).
function decryptPassword(blob: Buffer, masterKey: Buffer | null): string | null | 'unsupported' {
  if (blob.length === 0) return null;
  const version = blob.subarray(0, 3).toString('latin1');

  if (version === 'v20') return 'unsupported';

  if (version === 'v10' || version === 'v11') {
    if (!masterKey) return null;
    const nonce = blob.subarray(3, 3 + GCM_NONCE_LEN);
    const out = aesGcm256Decrypt(masterKey, nonce, blob.subarray(3 + GCM_NONCE_LEN));
    return out ? out.toString('utf8') : null;
  }

  // Нет версии-префикса — legacy-эпоха чистого DPAPI (старый Chrome). Разворачиваем весь блоб.
  const plain = dpapiUnprotect(blob);
  return plain ? plain.toString('utf8') : null;
}

export function importChromiumPasswords(
  profilePath: string,
  userDataPath: string,
  passwords: PasswordManager,
): ImportTypeResult | null {
  const masterKey = readMasterKey(userDataPath);
  const dbPath = path.join(profilePath, 'Login Data');

  return withCopiedDb(dbPath, (db): ImportTypeResult => {
    const rows = db.prepare(`
      SELECT origin_url, username_value, password_value FROM logins
    `).all() as LoginRow[];

    let unsupported = 0;
    const items: Array<{ url: string; username: string; password: string }> = [];
    for (const r of rows) {
      if (!r.origin_url || !r.password_value) continue;
      const result = decryptPassword(r.password_value, masterKey);
      if (result === 'unsupported') { unsupported++; continue; }
      if (result === null || result === '') continue; // битый блоб или пустой пароль — не тащим
      items.push({ url: r.origin_url, username: r.username_value ?? '', password: result });
    }

    const { inserted, skipped } = passwords.bulkImport(items);
    return { inserted, skipped, unsupported };
  });
}
