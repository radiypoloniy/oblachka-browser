import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { PasswordManager } from '../PasswordManager';
import type { ImportTypeResult } from '../../shared/ipc';
import { withCopiedDb } from './chromiumSqlite';
import { dpapiUnprotect } from './dpapi';

// Импорт сохранённых паролей из профиля Chromium. Самая тонкая часть импорта: пароли зашифрованы.
// Схема (Windows):
//   1. Мастер-ключ AES-256 лежит в Local State → os_crypt.encrypted_key (base64, префикс "DPAPI"),
//      завёрнут через DPAPI (CurrentUser). Разворачиваем один раз (см. dpapi.ts).
//   2. Каждый password_value в таблице logins (Login Data) — блоб с префиксом версии:
//      - "v10"/"v11": AES-256-GCM (nonce[12] + ciphertext + tag[16]) на мастер-ключе.
//      - "v20": App-Bound Encryption (Chrome 127+) — ключ дополнительно завёрнут в SYSTEM-DPAPI,
//        развернуть без прав SYSTEM нельзя. Помечаем как unsupported (см. CLAUDE.md), не перенос.
//      - без версии (старый Chrome): весь блоб — чистый DPAPI, разворачиваем напрямую.

const GCM_NONCE_LEN = 12;
const GCM_TAG_LEN = 16;
const KEY_PREFIX = 'DPAPI'; // 5 байт перед завёрнутым ключом в encrypted_key

interface LoginRow {
  origin_url: string;
  username_value: string | null;
  password_value: Buffer | null;
}

// Мастер-ключ из Local State. null — ключа нет/не развернулся (тогда v10/v11 расшифровать нельзя).
function readMasterKey(userDataPath: string): Buffer | null {
  try {
    const raw = fs.readFileSync(path.join(userDataPath, 'Local State'), 'utf8');
    const data = JSON.parse(raw) as { os_crypt?: { encrypted_key?: string } };
    const b64 = data.os_crypt?.encrypted_key;
    if (!b64) return null;
    const blob = Buffer.from(b64, 'base64');
    // Снимаем префикс "DPAPI" — дальше идёт собственно DPAPI-завёрнутый ключ.
    if (blob.subarray(0, KEY_PREFIX.length).toString('latin1') !== KEY_PREFIX) return null;
    return dpapiUnprotect(blob.subarray(KEY_PREFIX.length));
  } catch (e) {
    console.warn('[Import] чтение мастер-ключа не удалось:', (e as Error).message);
    return null;
  }
}

// Расшифровка одного блоба password_value. 'unsupported' — v20 (App-Bound), физически не переносим.
// null — битый блоб/сбой расшифровки (считаем пропущенным, не unsupported — не вина шифрования ABE).
function decryptPassword(blob: Buffer, masterKey: Buffer | null): string | null | 'unsupported' {
  if (blob.length === 0) return null;
  const version = blob.subarray(0, 3).toString('latin1');

  if (version === 'v20') return 'unsupported';

  if (version === 'v10' || version === 'v11') {
    if (!masterKey) return null;
    try {
      const nonce = blob.subarray(3, 3 + GCM_NONCE_LEN);
      const tag = blob.subarray(blob.length - GCM_TAG_LEN);
      const ciphertext = blob.subarray(3 + GCM_NONCE_LEN, blob.length - GCM_TAG_LEN);
      const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, nonce);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      return null;
    }
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
