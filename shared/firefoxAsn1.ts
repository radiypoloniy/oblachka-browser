// Разбор ASN.1/DER-структур из хранилища паролей Firefox — чистая логика, без Node и без DOM.
//
// Зачем это здесь, а не рядом с расшифровкой. Firefox (точнее NSS, его крипто-библиотека) держит
// параметры шифрования в DER: соль, число итераций, IV и сам шифротекст лежат не полями таблицы, а
// байтами вложенных SEQUENCE. Расшифровка поверх — это три вызова node:crypto, там ошибиться негде;
// а вот РАЗБОР структуры — то место, где ошибка молчит: неверно взятая соль даёт не исключение, а
// просто мусор на выходе, неотличимый от «неправильный мастер-пароль».
//
// ⚠️ Структуру ищем ПО OID, а не по индексам вложенности. Ходовые реализации (firefox_decrypt и его
// потомки) адресуют поля как decodedItem[0][1][0][1][0] — такой код невозможно прочитать, невозможно
// проверить глазом и он рассыпается от любого расхождения с той версией формата, на которой писался.
// Поиск по OID говорит, ЧТО берём («соль из параметров PBKDF2»), и переживает разницу вложенности
// между двумя поколениями формата, которые нам всё равно надо держать оба.
//
// ⚠️ Значимых импортов тут быть НЕ должно, только типовые — проверка (scripts/firefox-asn1-check.mjs)
// гоняет модуль голым node (та же причина, что в shared/csvPasswords.ts).

// ── Узел DER ────────────────────────────────────────────────────────────────────────────────────
// content — содержимое БЕЗ заголовка (тег + длина). children заполняется только у составных тегов
// (бит 0x20): у примитивов он всегда пуст, и это не «ещё не разобрали», а «разбирать нечего».
export interface DerNode {
  tag: number;
  content: Uint8Array;
  children: DerNode[];
}

const TAG_INTEGER = 0x02;
const TAG_OCTET_STRING = 0x04;
const TAG_OID = 0x06;
const TAG_SEQUENCE = 0x30;

/**
 * Байты DER → дерево узлов.
 *
 * ⚠️ Возвращает null на ЛЮБОЙ неполноте, а не бросает и не додумывает. Сюда приходит содержимое
 * чужого файла, который мог быть обрезан, побит или вообще оказаться не тем файлом; «разобрали
 * половину и поехали дальше» здесь означало бы расшифровку мусором.
 */
export function parseDer(bytes: Uint8Array): DerNode | null {
  const out = parseOne(bytes, 0);
  // Хвост после единственной верхней структуры — признак того, что это не тот файл: у всех
  // разбираемых нами полей верхний узел ровно один.
  if (!out || out.end !== bytes.length) return null;
  return out.node;
}

function parseOne(bytes: Uint8Array, start: number): { node: DerNode; end: number } | null {
  if (start + 2 > bytes.length) return null;
  const tag = bytes[start];
  // Многобайтовый тег (младшие пять бит все единицы) в наших структурах не встречается, и
  // поддерживать его наугад — значит писать непроверяемый код.
  if ((tag & 0x1f) === 0x1f) return null;

  let pos = start + 1;
  const first = bytes[pos++];
  let length: number;
  if (first < 0x80) {
    length = first; // короткая форма: длина прямо в байте
  } else {
    // Длинная форма: младшие семь бит — сколько ДАЛЬШЕ байт занимает сама длина.
    const count = first & 0x7f;
    // 0x80 — неопределённая длина (только BER, в DER запрещена); >4 байт длины у нас не бывает
    // и означало бы размер, которого в этих файлах быть не может.
    if (count === 0 || count > 4 || pos + count > bytes.length) return null;
    length = 0;
    for (let i = 0; i < count; i++) length = (length << 8) | bytes[pos++];
  }

  const contentStart = pos;
  const contentEnd = contentStart + length;
  if (contentEnd > bytes.length) return null;
  const content = bytes.subarray(contentStart, contentEnd);

  const children: DerNode[] = [];
  if ((tag & 0x20) !== 0) { // составной
    let inner = 0;
    while (inner < content.length) {
      const child = parseOne(content, inner);
      if (!child) return null;
      children.push(child.node);
      inner = child.end;
    }
  }
  return { node: { tag, content, children }, end: contentEnd };
}

/**
 * OID в точечную запись ('1.2.840.113549.1.5.13').
 *
 * ⚠️ Первый байт кодирует СРАЗУ ДВА первых числа (40·a + b) — это не оптимизация кодировщика, а
 * часть формата; забыть про это значит получить нерасшифровываемый идентификатор алгоритма.
 * Дальше — группы по 7 бит со старшим битом «продолжение».
 */
export function oidToString(content: Uint8Array): string {
  if (content.length === 0) return '';
  const parts: number[] = [Math.floor(content[0] / 40), content[0] % 40];
  let value = 0;
  for (let i = 1; i < content.length; i++) {
    value = value * 128 + (content[i] & 0x7f);
    if ((content[i] & 0x80) === 0) { parts.push(value); value = 0; }
  }
  return parts.join('.');
}

/** Беззнаковое целое DER → число. null, если это не INTEGER или он не влезает в безопасное число. */
export function derInteger(node: DerNode | undefined): number | null {
  if (!node || node.tag !== TAG_INTEGER) return null;
  let value = 0;
  for (const byte of node.content) {
    value = value * 256 + byte;
    if (!Number.isSafeInteger(value)) return null;
  }
  return value;
}

// ── Идентификаторы алгоритмов, встречающиеся в key4.db и logins.json ────────────────────────────
export const OID = {
  /** pbeWithSha1And3-KeyTripleDES-CBC — старое поколение key4.db (Firefox до 75). */
  PBE_SHA1_3DES: '1.2.840.113549.1.12.5.1.3',
  /** PBES2 — новое поколение key4.db (Firefox 75+): PBKDF2 + AES-256-CBC. */
  PBES2: '1.2.840.113549.1.5.13',
  PBKDF2: '1.2.840.113549.1.5.12',
  AES256_CBC: '2.16.840.1.101.3.4.1.42',
  /** des-ede3-cbc — которым зашифрованы логины в logins.json у СТАРЫХ профилей. */
  DES_EDE3_CBC: '1.2.840.113549.3.7',
} as const;

/** Идентификатор ключа логинов в nssPrivate и в записях logins.json — константа NSS. */
export const LOGIN_KEY_ID = 'f8000000000000000000000000000001';

/**
 * AlgorithmIdentifier — SEQUENCE, у которого первый ребёнок это OID. Возвращает узел и его
 * параметры (второй ребёнок), либо null, если это не он.
 */
function algId(node: DerNode | undefined): { oid: string; params: DerNode | undefined } | null {
  if (!node || node.tag !== TAG_SEQUENCE || node.children.length === 0) return null;
  const head = node.children[0];
  if (head.tag !== TAG_OID) return null;
  return { oid: oidToString(head.content), params: node.children[1] };
}

// Что нужно знать, чтобы развернуть зашифрованный элемент key4.db. Два поколения формата различаются
// не только шифром, но и набором параметров, поэтому это размеченный союз, а не набор опциональных
// полей: «AES без числа итераций» — состояние, которого не бывает, и тип обязан это отражать.
export type FirefoxKdf =
  | { scheme: '3des'; entrySalt: Uint8Array; ciphertext: Uint8Array }
  | { scheme: 'aes'; entrySalt: Uint8Array; iterations: number; keyLength: number; iv: Uint8Array; ciphertext: Uint8Array };

/**
 * Зашифрованный элемент key4.db (metaData.item2 и nssPrivate.a11) → параметры расшифровки.
 *
 * Обе формы — SEQUENCE { AlgorithmIdentifier, OCTET STRING шифротекст }, различается начинка
 * параметров. Разбираем от найденного алгоритма, а не от корня: см. шапку про поиск по OID.
 */
export function parseEncryptedItem(bytes: Uint8Array): FirefoxKdf | null {
  const root = parseDer(bytes);
  if (!root || root.tag !== TAG_SEQUENCE || root.children.length !== 2) return null;
  const alg = algId(root.children[0]);
  const ct = root.children[1];
  if (!alg || ct.tag !== TAG_OCTET_STRING) return null;

  if (alg.oid === OID.PBE_SHA1_3DES) {
    // Параметры: SEQUENCE { OCTET STRING соль, INTEGER итерации }. Итерации у этой схемы NSS
    // игнорирует (вывод ключа фиксированный, см. deriveLegacyKey) — намеренно их не читаем, чтобы
    // не создавать впечатление, будто они на что-то влияют.
    const salt = alg.params?.children[0];
    if (!salt || salt.tag !== TAG_OCTET_STRING) return null;
    return { scheme: '3des', entrySalt: salt.content, ciphertext: ct.content };
  }

  if (alg.oid === OID.PBES2) {
    // Параметры: SEQUENCE { AlgorithmIdentifier(PBKDF2), AlgorithmIdentifier(AES-256-CBC) }.
    const kdf = algId(alg.params?.children[0]);
    const enc = algId(alg.params?.children[1]);
    if (!kdf || kdf.oid !== OID.PBKDF2 || !enc || enc.oid !== OID.AES256_CBC) return null;
    const salt = kdf.params?.children[0];
    const iterations = derInteger(kdf.params?.children[1]);
    const keyLength = derInteger(kdf.params?.children[2]);
    if (!salt || salt.tag !== TAG_OCTET_STRING || iterations === null || keyLength === null) return null;
    if (!enc.params || enc.params.tag !== TAG_OCTET_STRING) return null;
    return { scheme: 'aes', entrySalt: salt.content, iterations, keyLength, iv: enc.params.content, ciphertext: ct.content };
  }

  return null; // незнакомый алгоритм — честнее вернуть null, чем угадывать
}

// Одно зашифрованное поле logins.json (имя или пароль).
export interface FirefoxLoginItem {
  keyId: string;              // hex; должен совпасть с LOGIN_KEY_ID
  cipher: 'aes' | '3des';     // чем зашифровано ЭТО поле — см. ниже, шифра два
  iv: Uint8Array;             // 16 байт у AES, 8 у 3DES (размер блока шифра)
  ciphertext: Uint8Array;
}

/**
 * Поле encryptedUsername/encryptedPassword (уже из base64) → параметры расшифровки.
 * Форма: SEQUENCE { OCTET STRING keyId, AlgorithmIdentifier(шифр, OCTET STRING iv), OCTET STRING ct }.
 *
 * ⚠️ Шифра ЗДЕСЬ ТОЖЕ ДВА, и он свой у каждого поля — не тот же выбор, что в key4.db. Современный
 * Firefox пишет aes256-CBC (проверено на живом профиле: 225 записей, все AES), старые профили —
 * des-ede3-cbc. Отсюда и разная длина ключа: AES-256 берёт все 32 байта развёрнутого ключа, 3DES —
 * первые 24. Ходовые описания формата упоминают только 3DES, и это самая дорогая ошибка в теме:
 * на современном профиле по ним не расшифровывается вообще ничего.
 */
export function parseLoginItem(bytes: Uint8Array): FirefoxLoginItem | null {
  const root = parseDer(bytes);
  if (!root || root.tag !== TAG_SEQUENCE || root.children.length !== 3) return null;
  const [keyIdNode, algNode, ctNode] = root.children;
  if (keyIdNode.tag !== TAG_OCTET_STRING || ctNode.tag !== TAG_OCTET_STRING) return null;
  const alg = algId(algNode);
  if (!alg || !alg.params || alg.params.tag !== TAG_OCTET_STRING) return null;
  const cipher = alg.oid === OID.AES256_CBC ? 'aes' : alg.oid === OID.DES_EDE3_CBC ? '3des' : null;
  if (!cipher) return null;
  return { keyId: toHex(keyIdNode.content), cipher, iv: alg.params.content, ciphertext: ctNode.content };
}

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/**
 * Снятие набивки PKCS#7 после блочного дешифрования.
 *
 * ⚠️ Проверяем ВСЕ байты набивки, а не только последний. У расшифровки неверным ключом последний
 * байт с вероятностью 1/256 окажется правдоподобным, и мы вернём обрезанный мусор вместо честного
 * «не подошёл ключ» — а это ровно тот случай, когда человеку показали бы импортированный пароль,
 * которым нельзя войти.
 */
export function stripPkcs7(data: Uint8Array, blockSize: number): Uint8Array | null {
  if (data.length === 0 || data.length % blockSize !== 0) return null;
  const pad = data[data.length - 1];
  if (pad === 0 || pad > blockSize || pad > data.length) return null;
  for (let i = data.length - pad; i < data.length; i++) {
    if (data[i] !== pad) return null;
  }
  return data.subarray(0, data.length - pad);
}
