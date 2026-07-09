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
const SCRYPT_SALT_LEN = 16;
const SCRYPT_KEY_LEN = 32;

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
// DPAPI-сейф непереносим (другая машина/переустановка Windows = wrapped_dek не расшифровать),
// поэтому экспорт шифруется ключом из scrypt(passphrase), а не DEK — портируемый формат.
// node:crypto.scryptSync без новых зависимостей (соответствует брифу — без argon2 на этом шаге).
interface PassphraseEnvelope {
  v: 1;
  salt: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

export function encryptWithPassphrase(passphrase: string, plaintext: string): string {
  const salt = crypto.randomBytes(SCRYPT_SALT_LEN);
  const key = crypto.scryptSync(passphrase, salt, SCRYPT_KEY_LEN);
  const iv = crypto.randomBytes(GCM_IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const envelope: PassphraseEnvelope = {
    v: 1,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
  return JSON.stringify(envelope);
}

// Бросает при неверной парольной фразе/битом файле (authTag не сойдётся) — вызывающая сторона
// (PasswordManager.importVault) ловит и превращает в понятный результат для UI.
export function decryptWithPassphrase(passphrase: string, payload: string): string {
  const envelope = JSON.parse(payload) as PassphraseEnvelope;
  if (envelope.v !== 1) throw new Error('unsupported envelope version');
  const salt = Buffer.from(envelope.salt, 'base64');
  const key = crypto.scryptSync(passphrase, salt, SCRYPT_KEY_LEN);
  const iv = Buffer.from(envelope.iv, 'base64');
  const authTag = Buffer.from(envelope.authTag, 'base64');
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
