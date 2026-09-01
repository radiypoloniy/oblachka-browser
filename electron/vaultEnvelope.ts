// Портируемый конверт экспорта паролей: ключ выводится из парольной фразы человека, а не из DEK.
//
// ⚠️ Отдельным файлом от VaultCrypto.ts, и не ради красоты: здесь нет ни одного импорта Electron,
// только node:crypto. Значит эту логику можно прогнать обычным node — и она прогоняется
// (scripts/vault-envelope-check.mjs). Сейф целиком так проверить нельзя: он завязан на safeStorage,
// то есть на DPAPI живой машины.
//
// ⚠️ ЗАЧЕМ ВООБЩЕ ОТДЕЛЬНЫЙ КОНВЕРТ. Сейф на диске зашифрован ключом, обёрнутым DPAPI, и это
// непереносимо: другая машина или переустановка Windows — и wrapped_dek не расшифровать ничем.
// Экспорт обязан открываться где угодно, поэтому его ключ выводится из парольной фразы.
//
// ⚠️ И ровно поэтому цена подбора здесь другая. Файл экспорта человек кладёт в облако, на флешку,
// шлёт себе почтой — он оказывается там, где злоумышленник может считать его и перебирать пароль
// СКОЛЬКО УГОДНО, без всяких «три попытки и блокировка». Против такого перебора работает только
// стоимость одной попытки, и задаёт её KDF.
import crypto from 'node:crypto';

const SALT_LEN = 16;
const KEY_LEN = 32;
const GCM_IV_LEN = 12;
const GCM_TAG_LEN = 16;

/**
 * Параметры scrypt для НОВЫХ экспортов.
 *
 * ⚠️ Раньше здесь стояли умолчания Node: N = 2^14 (16384). Это значение из статьи 2009 года, и
 * сегодня оно означает, что перебор по словарю на обычной видеокарте идёт в тысячи паролей в
 * секунду. Для файла, который лежит у злоумышленника неограниченно долго, этого мало.
 *
 * N = 2^17 поднимает цену одной попытки примерно в восемь раз против прежнего — и во столько же
 * раз дорожает весь перебор.
 *
 * ⚠️ maxmem задавать ОБЯЗАТЕЛЬНО. scrypt требует 128 · N · r байт: при N = 2^17 и r = 8 это 134 МБ,
 * а у Node потолок по умолчанию — 32 МБ, и вызов просто падает с ошибкой. Без этой строки правка
 * выглядела бы работающей ровно до первого экспорта.
 *
 * ⚠️ Цена для человека — 0,29 с на экспорт и столько же на импорт (замер 01.09.2026 на этой
 * машине). Это разовые действия по его же команде, и там незаметно; та же задержка на КАЖДОЙ
 * разблокировке сейфа была бы неприемлема — поэтому сам сейф этим KDF не пользуется, у него DPAPI.
 */
export const SCRYPT_N = 1 << 17;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

/** Умолчания Node, которыми зашифрованы конверты первой версии. Менять нельзя — сломается чтение. */
const V1_PARAMS = { N: 1 << 14, r: 8, p: 1 };

interface KdfParams { N: number; r: number; p: number }

interface EnvelopeV1 {
  v: 1;
  salt: string; iv: string; authTag: string; ciphertext: string;
}

interface EnvelopeV2 {
  v: 2;
  /**
   * Параметры вывода ключа ВНУТРИ файла.
   *
   * ⚠️ Это и есть главная правка формата, важнее самого числа N. Пока параметры зашиты в код,
   * любое их изменение делает НЕЧИТАЕМЫМИ все прежние экспорты: файл не говорит, чем он
   * зашифрован, и программа может лишь предполагать. Записав их в конверт, мы получаем право
   * поднимать стоимость и дальше, ничего не ломая.
   */
  kdf: KdfParams;
  salt: string; iv: string; authTag: string; ciphertext: string;
}

type Envelope = EnvelopeV1 | EnvelopeV2;

function deriveKey(passphrase: string, salt: Buffer, p: KdfParams): Buffer {
  return crypto.scryptSync(passphrase, salt, KEY_LEN, {
    N: p.N, r: p.r, p: p.p, maxmem: SCRYPT_MAXMEM,
  });
}

export function encryptWithPassphrase(passphrase: string, plaintext: string): string {
  const kdf: KdfParams = { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P };
  const salt = crypto.randomBytes(SALT_LEN);
  const key = deriveKey(passphrase, salt, kdf);
  const iv = crypto.randomBytes(GCM_IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const envelope: EnvelopeV2 = {
    v: 2,
    kdf,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
  return JSON.stringify(envelope);
}

/**
 * Бросает при неверной фразе или битом файле (authTag не сойдётся) — вызывающая сторона
 * (PasswordManager.importVault) ловит и превращает в понятный ответ для человека.
 *
 * ⚠️ Первая версия читается по-прежнему и читаться обязана: экспорты, сделанные до этой правки,
 * лежат у людей на флешках и в облаках. Отказ их открыть — это потеря паролей, а не «повышение
 * безопасности». Параметры для них берутся из V1_PARAMS, потому что сам файл о них не знает.
 */
export function decryptWithPassphrase(passphrase: string, payload: string): string {
  const envelope = JSON.parse(payload) as Envelope;
  let params: KdfParams;
  if (envelope.v === 2) {
    const k = envelope.kdf;
    // ⚠️ Параметры приходят ИЗ ФАЙЛА, то есть извне: подсунутый конверт с N = 2^30 повесил бы
    // приложение на минуты и съел бы всю память. Верхнюю границу держим явную.
    if (!k || !Number.isInteger(k.N) || k.N < 1 << 12 || k.N > 1 << 20
      || !Number.isInteger(k.r) || k.r < 1 || k.r > 32
      || !Number.isInteger(k.p) || k.p < 1 || k.p > 16) {
      throw new Error('envelope: недопустимые параметры вывода ключа');
    }
    params = k;
  } else if (envelope.v === 1) {
    params = V1_PARAMS;
  } else {
    throw new Error('envelope: неизвестная версия формата');
  }

  const salt = Buffer.from(envelope.salt, 'base64');
  const key = deriveKey(passphrase, salt, params);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

// Только для проверки: собрать конверт первой версии, чтобы убедиться, что он ещё читается.
export function encryptV1ForTest(passphrase: string, plaintext: string): string {
  const salt = crypto.randomBytes(SALT_LEN);
  const key = deriveKey(passphrase, salt, V1_PARAMS);
  const iv = crypto.randomBytes(GCM_IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const envelope: EnvelopeV1 = {
    v: 1,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
  return JSON.stringify(envelope);
}

export const GCM_TAG_LEN_FOR_TEST = GCM_TAG_LEN;
