import path from 'node:path';
import crypto from 'node:crypto';
import { withCopiedDb } from './chromiumSqlite';
import { parseEncryptedItem, stripPkcs7, toHex, LOGIN_KEY_ID, type FirefoxKdf, type FirefoxLoginItem } from '../../shared/firefoxAsn1';

// Разворачивание ключа паролей Firefox из key4.db. Разбор самих байтов (ASN.1/DER) живёт в
// shared/firefoxAsn1.ts под проверкой; здесь — вывод ключа и работа с базой.
//
// ⚠️ Почему тут вообще можно то, чего нельзя у Chrome. Chrome с версии 127 заворачивает ключ вторым
// слоем в SYSTEM-DPAPI, и снять его без прав SYSTEM либо инъекции в процесс браузера нельзя — мы от
// этого пути отказались осознанно (см. shared/csvPasswords.ts). У Firefox такого слоя нет: ключ
// лежит в файле профиля, зашифрованный мастер-паролем, и по умолчанию мастер-пароль пустой. То есть
// весь импорт — это чтение файлов пользователя его же правами, без обхода чего бы то ни было.
//
// Цепочка (одинаковая у обоих поколений формата):
//   1. metaData, запись 'password': item1 = глобальная соль, item2 = зашифрованная контрольная
//      строка. Расшифровали и получили 'password-check' — мастер-пароль подошёл.
//   2. nssPrivate, запись с идентификатором f8000…001: a11 = зашифрованный ключ логинов.
//   3. Этим ключом расшифровываются поля logins.json — AES-256-CBC у современных профилей,
//      3DES-CBC у старых; шифр указан в самом поле, см. parseLoginItem.

const PASSWORD_CHECK = 'password-check';
const DES3_BLOCK = 8;
const AES_BLOCK = 16;
/** Длина ключа 3DES (EDE3): три 8-байтных ключа. AES-256 берёт все 32 байта развёрнутого ключа. */
const DES3_KEY_LEN = 24;

/**
 * Расшифровать элемент key4.db на мастер-пароле. null — пароль не подошёл или элемент битый.
 *
 * ⚠️ Поколений формата ДВА, и держать надо оба. Firefox перешёл на PBKDF2+AES в версии 75 (2020),
 * но старые профили при обновлении браузера сами не мигрируют: человек с профилем, заведённым
 * раньше, до сих пор носит 3DES. «Сделаем только современное» — это молчаливый ноль у того, кому
 * перенос нужнее всех, потому что он копит пароли дольше всех.
 */
function decryptItem(kdf: FirefoxKdf, globalSalt: Buffer, primaryPassword: string): Buffer | null {
  try {
    if (kdf.scheme === 'aes') {
      // Новое поколение: PBKDF2-SHA256 поверх SHA-1 от соли и пароля.
      const seed = crypto.createHash('sha1').update(globalSalt).update(primaryPassword, 'utf8').digest();
      const key = crypto.pbkdf2Sync(seed, Buffer.from(kdf.entrySalt), kdf.iterations, kdf.keyLength, 'sha256');
      // ⚠️ IV в файле лежит УРЕЗАННЫМ — 14 байт вместо 16. Первые два байта (0x04 0x0e — заголовок
      // DER OCTET STRING длины 14) NSS не пишет в поле, а подразумевает; собираем их обратно.
      // Без этого расшифровывается всё, кроме первого блока, и ошибка выглядит как «пароли
      // импортировались, но у части битые первые символы».
      const iv = Buffer.concat([Buffer.from([0x04, 0x0e]), Buffer.from(kdf.iv)]);
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      decipher.setAutoPadding(false); // набивку снимаем сами и с полной проверкой, см. stripPkcs7
      const out = Buffer.concat([decipher.update(Buffer.from(kdf.ciphertext)), decipher.final()]);
      const unpadded = stripPkcs7(out, AES_BLOCK);
      return unpadded ? Buffer.from(unpadded) : null;
    }

    // Старое поколение: вывод ключа NSS на SHA-1 и HMAC. Формула не «PBKDF2 с sha1», а именно эта
    // последовательность — число итераций из файла здесь не участвует вовсе.
    const entrySalt = Buffer.from(kdf.entrySalt);
    const hp = crypto.createHash('sha1').update(globalSalt).update(primaryPassword, 'utf8').digest();
    // pes — соль, добитая нулями ровно до 20 байт (длина выхода SHA-1).
    const pes = Buffer.alloc(20);
    entrySalt.copy(pes, 0, 0, Math.min(entrySalt.length, pes.length));
    const chp = crypto.createHash('sha1').update(hp).update(entrySalt).digest();
    const hmac = (data: Buffer): Buffer => crypto.createHmac('sha1', chp).update(data).digest();
    const k1 = hmac(Buffer.concat([pes, entrySalt]));
    const tk = hmac(pes);
    const k2 = hmac(Buffer.concat([tk, entrySalt]));
    const k = Buffer.concat([k1, k2]); // 40 байт: ключ + IV
    const decipher = crypto.createDecipheriv('des-ede3-cbc', k.subarray(0, DES3_KEY_LEN), k.subarray(32, 40));
    decipher.setAutoPadding(false);
    const out = Buffer.concat([decipher.update(Buffer.from(kdf.ciphertext)), decipher.final()]);
    const unpadded = stripPkcs7(out, DES3_BLOCK);
    return unpadded ? Buffer.from(unpadded) : null;
  } catch {
    // Неверный мастер-пароль даёт мусор, а не исключение, но битая длина шифротекста — исключение.
    return null;
  }
}

/** Что получилось при попытке развернуть ключ. Каждый исход UI показывает по-своему. */
export type LoginKeyResult =
  | { ok: true; key: Buffer }
  /** Профиль защищён мастер-паролем Firefox, и присланный (или пустой) не подошёл. */
  | { ok: false; reason: 'primary-password' }
  /** key4.db нет, он битый, или недоступен better-sqlite3 — переносить нечего. */
  | { ok: false; reason: 'unavailable' };

interface MetaRow { item1: Buffer | null; item2: Buffer | null }
interface KeyRow { a11: Buffer | null; a102: Buffer | null }

/**
 * key4.db → 3DES-ключ, которым зашифрованы поля logins.json.
 *
 * primaryPassword — мастер-пароль Firefox; по умолчанию он пустой, и тогда сюда приходит ''.
 */
export function readLoginKey(profilePath: string, primaryPassword: string): LoginKeyResult {
  // key4.db залочен работающим Firefox — читаем копию, как и базы Chromium.
  const result = withCopiedDb(path.join(profilePath, 'key4.db'), (db): LoginKeyResult => {
    const meta = db.prepare(`SELECT item1, item2 FROM metaData WHERE id = 'password'`).get() as MetaRow | undefined;
    if (!meta?.item1 || !meta.item2) return { ok: false, reason: 'unavailable' };

    const check = parseEncryptedItem(new Uint8Array(meta.item2));
    if (!check) return { ok: false, reason: 'unavailable' };
    const checkPlain = decryptItem(check, meta.item1, primaryPassword);
    // ⚠️ Контрольная строка — ЕДИНСТВЕННЫЙ способ отличить «не тот мастер-пароль» от «битый файл».
    // Без неё неверный пароль дал бы расшифровку мусором, и человек получил бы импорт паролей,
    // которыми нельзя войти, вместо внятной просьбы ввести мастер-пароль.
    if (!checkPlain || checkPlain.toString('latin1') !== PASSWORD_CHECK) {
      return { ok: false, reason: 'primary-password' };
    }

    // Ключ логинов — запись nssPrivate с фиксированным идентификатором NSS. Таблица может содержать
    // и другие ключи (сертификаты клиента), поэтому выбираем по a102, а не «первую попавшуюся».
    const rows = db.prepare(`SELECT a11, a102 FROM nssPrivate`).all() as KeyRow[];
    for (const row of rows) {
      if (!row.a11 || !row.a102) continue;
      if (toHex(new Uint8Array(row.a102)) !== LOGIN_KEY_ID) continue;
      const item = parseEncryptedItem(new Uint8Array(row.a11));
      if (!item) continue;
      const plain = decryptItem(item, meta.item1, primaryPassword);
      if (!plain || plain.length < DES3_KEY_LEN) continue;
      // ⚠️ Ключ отдаём ЦЕЛИКОМ, а не обрезанным до 24 байт. У современного профиля здесь ровно 32
      // байта — полноразмерный ключ AES-256, которым и зашифрованы записи (см. parseLoginItem).
      // Обрезка «под 3DES» молча ломала бы все пароли такого профиля, и выглядело бы это как
      // «импорт прошёл, но ничего не перенеслось».
      return { ok: true, key: plain };
    }
    return { ok: false, reason: 'unavailable' };
  });
  // null от withCopiedDb — файла нет, он залочен намертво или нет нативного модуля.
  return result ?? { ok: false, reason: 'unavailable' };
}

/**
 * Одно поле logins.json (encryptedUsername/encryptedPassword, уже разобранное из base64) → строка.
 * null — поле зашифровано чужим ключом или битое; такую запись пропускаем, а не роняем весь импорт.
 *
 * ⚠️ Шифр берётся ИЗ САМОГО ПОЛЯ, а не выбирается по поколению key4.db. Это разные решения: ключ
 * может быть развёрнут новой схемой (PBES2), а поле — остаться зашифрованным старым 3DES, если
 * запись пережила миграцию профиля.
 */
export function decryptLoginField(loginKey: Buffer, item: FirefoxLoginItem): string | null {
  if (item.keyId !== LOGIN_KEY_ID) return null;
  const aes = item.cipher === 'aes';
  // AES-256 требует 32 байта ключа, 3DES — 24. Короткий ключ до шифра не доводим: createDecipheriv
  // бросил бы «Invalid key length», и запись потерялась бы как «битая», хотя дело в длине.
  const need = aes ? 32 : DES3_KEY_LEN;
  if (loginKey.length < need) return null;
  try {
    const decipher = crypto.createDecipheriv(
      aes ? 'aes-256-cbc' : 'des-ede3-cbc',
      loginKey.subarray(0, need),
      Buffer.from(item.iv),
    );
    decipher.setAutoPadding(false);
    const out = Buffer.concat([decipher.update(Buffer.from(item.ciphertext)), decipher.final()]);
    const unpadded = stripPkcs7(out, aes ? AES_BLOCK : DES3_BLOCK);
    return unpadded ? Buffer.from(unpadded).toString('utf8') : null;
  } catch {
    return null;
  }
}
