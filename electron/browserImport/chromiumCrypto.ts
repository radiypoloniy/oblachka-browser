import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { dpapiUnprotect } from './dpapi';

// Общая криптография для расшифровки паролей Chromium-браузеров. Chrome/Edge/Brave/Opera/Vivaldi
// используют одну схему (см. ChromiumPasswordReader), Яндекс — надстройку над ней (см.
// YandexPasswordReader), но мастер-ключ из Local State и примитив AES-256-GCM у них общие.

const KEY_PREFIX = 'DPAPI'; // 5 байт перед завёрнутым DPAPI-ключом в os_crypt.encrypted_key
export const GCM_NONCE_LEN = 12;
export const GCM_TAG_LEN = 16;

// Мастер-ключ AES-256 из Local State → os_crypt.encrypted_key (base64, префикс "DPAPI",
// завёрнут через DPAPI CurrentUser). null — ключа нет / DPAPI не развернулся.
export function readMasterKey(userDataPath: string): Buffer | null {
  try {
    const raw = fs.readFileSync(path.join(userDataPath, 'Local State'), 'utf8');
    const data = JSON.parse(raw) as { os_crypt?: { encrypted_key?: string } };
    const b64 = data.os_crypt?.encrypted_key;
    if (!b64) return null;
    const blob = Buffer.from(b64, 'base64');
    if (blob.subarray(0, KEY_PREFIX.length).toString('latin1') !== KEY_PREFIX) return null;
    return dpapiUnprotect(blob.subarray(KEY_PREFIX.length));
  } catch (e) {
    console.warn('[Import] чтение мастер-ключа не удалось:', (e as Error).message);
    return null;
  }
}

// AES-256-GCM. ciphertextWithTag — шифртекст с 16-байтным тегом в хвосте (как отдаёт Chromium/
// Go-crypto). aad — опциональные аутентифицируемые данные (Яндекс подкладывает SHA1 полей записи).
// null — тег не сошёлся/битые данные (не бросаем — вызывающий считает такой пароль пропущенным).
export function aesGcm256Decrypt(key: Buffer, nonce: Buffer, ciphertextWithTag: Buffer, aad?: Buffer): Buffer | null {
  try {
    if (ciphertextWithTag.length < GCM_TAG_LEN) return null;
    const tag = ciphertextWithTag.subarray(ciphertextWithTag.length - GCM_TAG_LEN);
    const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - GCM_TAG_LEN);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    if (aad) decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    return null;
  }
}
