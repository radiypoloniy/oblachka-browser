// Хранилище ЗАКРЕПЛЁННЫХ записей буфера обмена (см. ClipboardBuffer.ts).
//
// ⚠️ Это осознанное исключение из правила «буфер только в памяти и только на сеанс», записанного в
// шапке ClipboardBuffer.ts. Правило остаётся в силе для всего остального: на диск уходит ТОЛЬКО то,
// что человек закрепил явным жестом, и ничего больше. Разница принципиальная — «браузер сам решил
// сохранить всё, что вы копировали» и «вы попросили сохранить вот это» это разные обещания.
//
// ⚠️ Шифруем через Electron safeStorage, тем же приёмом и по той же причине, что AiKeyStore.ts: на
// Windows это DPAPI (блоб читается только под учётной записью этого пользователя ОС), на macOS —
// Keychain, то есть кроссплатформенность берётся из коробки и отдельного слоя не требует (см.
// CLAUDE.md, «Кроссплатформенность»). Пишем сразу зашифрованным, без промежуточного plaintext-
// этапа: попавший на диск открытым текстом кусок переписки останется читаемым в бэкапах и после
// перехода на шифрование.
//
// ⚠️ Недоступен safeStorage — НЕ сохраняем вовсе и не падаем. Закрепление тогда работает как
// раньше, в пределах сеанса: молча положить чувствительное на диск открытым текстом хуже, чем не
// выполнить обещание про перезапуск.
import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { ClipboardEntry } from '../shared/ipc';

// Закреплённых столько, сколько это остаётся «полкой под рукой», а не архивом. Предел ещё и
// ограничивает размер файла: у записи может быть разметка.
export const MAX_PINNED = 30;

function pinsFilePath(): string {
  return path.join(app.getPath('userData'), 'clipboard-pins.enc');
}

/**
 * Читает закреплённое с диска. Вызывать ПОСЛЕ app.whenReady() — safeStorage требует готовое
 * приложение (та же оговорка, что у AiKeyStore.loadFromDisk).
 *
 * Битый/чужой файл — не ошибка: возвращаем пустой список и живём дальше. Закреплённое ценно, но
 * не настолько, чтобы из-за него не открылся браузер.
 */
export function loadPinned(): ClipboardEntry[] {
  try {
    if (!safeStorage.isEncryptionAvailable()) return [];
    const raw = safeStorage.decryptString(fs.readFileSync(pinsFilePath()));
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e): e is ClipboardEntry => (
        !!e && typeof e === 'object'
        && typeof (e as ClipboardEntry).id === 'number'
        && typeof (e as ClipboardEntry).text === 'string'
      ))
      .slice(0, MAX_PINNED)
      // Флаг проставляем сами: в этом файле по определению лежит только закреплённое, и полагаться
      // на поле из файла означало бы доверять ему больше, чем нужно.
      .map((e) => ({ ...e, pinned: true }));
  } catch {
    // Файла нет (ничего не закрепляли) или он не читается — это норма.
    return [];
  }
}

/** Переписывает файл целиком. Пустой список — файл удаляется, осиротевшего блоба остаться не должно. */
export function savePinned(entries: ClipboardEntry[]): void {
  const filePath = pinsFilePath();
  if (entries.length === 0) {
    dropPinned();
    return;
  }
  try {
    if (!safeStorage.isEncryptionAvailable()) return;
    const encrypted = safeStorage.encryptString(JSON.stringify(entries.slice(0, MAX_PINNED)));
    const tmpPath = filePath + '.tmp';
    // Через временный файл и rename: обрыв записи не должен превращать закреплённое в обрубок,
    // который потом не прочитается.
    fs.writeFileSync(tmpPath, encrypted);
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    console.error('[ClipboardPins] не удалось сохранить закреплённое:', e);
  }
}

/** Убирает файл с диска — «очистить всё» и выключение буфера обязаны стирать и его. */
export function dropPinned(): void {
  try {
    fs.unlinkSync(pinsFilePath());
  } catch {
    // Файла и так нет — не ошибка.
  }
}
