// Ключи подключений — по одному на подключение, все в одном зашифрованном блобе.
//
// ⚠️ Обобщение AiKeyStore.ts, у которого ключ был ровно один (Gemini). Приём тот же и по той же
// причине: safeStorage (на Windows это DPAPI — блоб читается только под учётной записью этого
// пользователя ОС), запись сразу зашифрованной, без промежуточного открытого этапа. Ключ — секрет,
// а не настройка: в settings.json ему не место.
//
// ⚠️ НАРУЖУ ИЗ MAIN УХОДИТ ТОЛЬКО СТАТУС, никогда сам ключ. Интерфейсу нужно знать «подключено или
// нет», и ровно это он получает; getKey() зовут только те, кто прямо сейчас идёт в сеть.
//
// ⚠️ МИГРАЦИЯ ТОЛЬКО ДОБАВЛЯЮЩАЯ, и старый файл НЕ УДАЛЯЕТСЯ — никогда, ни при успехе, ни при
// сбое. Правило проекта после 21.08, когда unlink «чтобы пересоздать после ошибки» стёр боевые
// пароли, закладки и историю. Осиротевший gemini-key.enc стоит пару килобайт; ключ, который не
// прочитался из-за нашей ошибки и был при этом стёрт, стоит человеку похода к провайдеру за новым.
import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

type Listener = (readyIds: readonly string[]) => void;

const KEYS_FILE = 'ai-keys.enc';
/** Старое однокключевое хранилище. Только читаем — см. ⚠️ про миграцию в шапке. */
const LEGACY_GEMINI_FILE = 'gemini-key.enc';
/** Под каким id живёт мигрированный ключ Gemini. Совпадает с id пресета в shared/aiProviders.ts. */
const LEGACY_GEMINI_ID = 'gemini';

interface KeysFile {
  version: 1;
  keys: Record<string, string>;
  /**
   * Что уже забрали из старых однокключевых хранилищ.
   *
   * ⚠️ Без этой отметки миграция ВОСКРЕШАЕТ УДАЛЁННОЕ: человек удаляет ключ Gemini, перезапускает
   * браузер — и на старте тот же ключ снова поднимается из gemini-key.enc, который мы (правильно)
   * не удаляем. Снаружи это выглядит как «браузер не забывает мой ключ», то есть как поломка
   * доверия ровно в том месте, где его больше всего.
   *
   * ⚠️ Отметка живёт В ТОМ ЖЕ ФАЙЛЕ, что и ключи, а не отдельным флагом рядом: два файла означали
   * бы два состояния, которые умеют разъехаться.
   */
  migrated?: string[];
}

let keys: Record<string, string> = {};
let migrated = new Set<string>();
const listeners = new Set<Listener>();

function filePath(name: string): string {
  return path.join(app.getPath('userData'), name);
}

/**
 * Вызывается один раз при старте, ПОСЛЕ app.whenReady() — safeStorage требует готовое приложение.
 * Не в конструкторе и не на верхнем уровне модуля.
 */
export function loadFromDisk(): void {
  keys = {};
  migrated = new Set();
  if (!safeStorage.isEncryptionAvailable()) {
    console.error('[ai/KeyStore] safeStorage недоступен — ключи подключений не будут загружены и сохранены');
    return;
  }

  try {
    const decrypted = safeStorage.decryptString(fs.readFileSync(filePath(KEYS_FILE)));
    const parsed: unknown = JSON.parse(decrypted);
    if (isKeysFile(parsed)) {
      keys = { ...parsed.keys };
      migrated = new Set(parsed.migrated ?? []);
    }
  } catch {
    // Файла нет (первый запуск) или он не читается — остаёмся без ключей, это норма.
  }

  adoptLegacyGeminiKey();
  notify();
}

function isKeysFile(v: unknown): v is KeysFile {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (o['version'] !== 1) return false;
  const k = o['keys'];
  if (typeof k !== 'object' || k === null || Array.isArray(k)) return false;
  if (!Object.values(k as Record<string, unknown>).every((x) => typeof x === 'string')) return false;
  const m = o['migrated'];
  return m === undefined || (Array.isArray(m) && m.every((x) => typeof x === 'string'));
}

/**
 * Забрать ключ Gemini из старого хранилища.
 *
 * ⚠️ Два условия, и оба обязательны. «Своего ещё нет» — иначе каждый старт затирал бы введённое
 * заново значением полугодовой давности. «Ещё не забирали» — иначе удаление ключа не переживает
 * перезапуск: старый файл мы не удаляем никогда, и без отметки он воскрешал бы ключ вечно.
 *
 * ⚠️ Записи на диск здесь НЕТ намеренно. Ключ поднимается в память, а отметка уедет в файл при
 * первом же сохранении или удалении. Писать на старте — значит трогать диск, когда человек ещё
 * ничего не просил, и ловить непонятную ошибку записи до появления окна. Повторное «забирание»
 * того же самого ключа, если до записи дело не дошло, ничего не портит: значение то же.
 */
function adoptLegacyGeminiKey(): void {
  if (migrated.has(LEGACY_GEMINI_ID)) return;
  if (keys[LEGACY_GEMINI_ID] !== undefined) return;
  try {
    const legacy = safeStorage.decryptString(fs.readFileSync(filePath(LEGACY_GEMINI_FILE))).trim();
    if (legacy) {
      keys[LEGACY_GEMINI_ID] = legacy;
      migrated.add(LEGACY_GEMINI_ID);
      console.log('[ai/KeyStore] ключ Gemini перенесён из старого хранилища (старый файл оставлен на месте)');
    }
  } catch {
    // Старого файла нет — обычный случай для новой установки.
  }
}

/** Ключ для реального запроса. Границу IPC не пересекает никогда. */
export function getKey(connectionId: string): string | null {
  return keys[connectionId] ?? null;
}

export function hasKey(connectionId: string): boolean {
  return keys[connectionId] !== undefined;
}

/** Подключения, у которых ключ на месте. Это и есть всё, что видит интерфейс. */
export function readyIds(): string[] {
  return Object.keys(keys).sort();
}

export function saveKey(connectionId: string, key: string): boolean {
  const trimmed = key.trim();
  if (!connectionId || !trimmed) return false;
  if (!safeStorage.isEncryptionAvailable()) return false;

  const next = { ...keys, [connectionId]: trimmed };
  if (!writeKeys(next)) return false;
  keys = next;
  notify();
  return true;
}

/**
 * ⚠️ Удаляет ОДНУ запись и переписывает файл — не трогает файл целиком. Соблазн сделать unlink,
 * когда ключей не осталось, есть; поддаваться ему не надо. Пустой зашифрованный блоб ничего не
 * стоит, а «удалим файл, раз он пустой» — это ровно та привычка, которая 21.08 стёрла боевые
 * пароли.
 */
export function deleteKey(connectionId: string): boolean {
  if (keys[connectionId] === undefined) return true;
  const next = { ...keys };
  delete next[connectionId];
  if (!writeKeys(next)) return false;
  keys = next;
  notify();
  return true;
}

function writeKeys(next: Record<string, string>): boolean {
  const payload: KeysFile = { version: 1, keys: next, migrated: [...migrated] };
  try {
    const encrypted = safeStorage.encryptString(JSON.stringify(payload));
    const target = filePath(KEYS_FILE);
    const tmp = `${target}.tmp`;
    // Через временный файл и переименование: обрыв записи не должен оставить битый блоб вместо
    // всех ключей сразу — теперь в одном файле лежит не один ключ, а все.
    fs.writeFileSync(tmp, encrypted);
    fs.renameSync(tmp, target);
    return true;
  } catch (e) {
    console.error('[ai/KeyStore] не удалось записать ключи на диск:', e);
    return false;
  }
}

export function onChanged(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify(): void {
  const ids = readyIds();
  for (const cb of listeners) cb(ids);
}
