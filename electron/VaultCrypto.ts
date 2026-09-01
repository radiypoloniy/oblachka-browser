// Менеджер паролей, шаг 1 — крипто-конверт DEK/KEK для сейфа паролей. Тот же принцип, что
// electron/AiKeyStore.ts (safeStorage = DPAPI на Windows), но здесь DEK — отдельный ключ,
// которым шифруется каждая запись в passwords.sqlite, а не сам ключ Gemini целиком. Конверт:
// DEK (случайный AES-256 ключ) оборачивается safeStorage в wrapped_dek — его хранит
// PasswordManager.ts в таблице vault_meta. Здесь только чистые крипто-примитивы, без диска/БД —
// это то, что бриф просит проверить round-trip'ом отдельно от слоя хранения (шаг 2).
//
// ⚠️ Будущий мастер-пароль (не в этом шаге): добавится вторая обёртка DEK, зашифрованная ключом
// из argon2(master_password) — сам DEK и формат encryptField/decryptField не меняются.
import { safeStorage } from 'electron';
import crypto from 'node:crypto';

const GCM_IV_LEN = 12;
const GCM_TAG_LEN = 16;

export function isAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

export function generateDek(): Buffer {
  return crypto.randomBytes(32);
}

// safeStorage работает со строками — DEK (бинарный) кодируем через base64 перед обёрткой.
export function wrapDek(dek: Buffer): Buffer {
  return safeStorage.encryptString(dek.toString('base64'));
}

export function unwrapDek(wrapped: Buffer): Buffer {
  return Buffer.from(safeStorage.decryptString(wrapped), 'base64');
}

// iv(12) || authTag(16) || ciphertext — один BLOB на запись, случайный IV каждый раз.
export function encryptField(dek: Buffer, plaintext: string): Buffer {
  const iv = crypto.randomBytes(GCM_IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

export function decryptField(dek: Buffer, blob: Buffer): string {
  const iv = blob.subarray(0, GCM_IV_LEN);
  const authTag = blob.subarray(GCM_IV_LEN, GCM_IV_LEN + GCM_TAG_LEN);
  const ciphertext = blob.subarray(GCM_IV_LEN + GCM_TAG_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', dek, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// ── Экспорт/импорт — отдельный конверт под пользовательскую парольную фразу ────────────────────
//
// ⚠️ Логика переехала в vaultEnvelope.ts и здесь только реэкспортируется. Причина не в размере:
// в том файле нет ни одного импорта Electron, значит его можно прогнать обычным node — и он
// прогоняется (scripts/vault-envelope-check.mjs). Отсюда, из соседства с safeStorage, это было
// невозможно: сейф завязан на DPAPI живой машины.
export { encryptWithPassphrase, decryptWithPassphrase } from './vaultEnvelope';
