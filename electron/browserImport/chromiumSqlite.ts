import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type Database = import('better-sqlite3').Database;
type BetterSqlite3 = typeof import('better-sqlite3');

// Chromium держит свои SQLite-базы (History, Login Data, Web Data) открытыми, пока браузер
// запущен, — открыть их напрямую нельзя (лок). Копируем файл (+ WAL/SHM, чтобы захватить и
// незачекпойнченные свежие записи) во временный каталог, открываем КОПИЮ readonly, работаем,
// удаляем. Общий помощник для истории и паролей (заходы 2 и 3), better-sqlite3 грузится
// динамически — как во всех менеджерах проекта (браузер обязан стартовать даже без нативного
// модуля, просто импорт из БД будет недоступен).
export function withCopiedDb<T>(dbPath: string, fn: (db: Database) => T): T | null {
  let Sqlite: BetterSqlite3;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Sqlite = require('better-sqlite3') as BetterSqlite3;
  } catch (e) {
    console.warn('[Import] better-sqlite3 недоступен — импорт из БД отключён:', (e as Error).message);
    return null;
  }

  if (!fs.existsSync(dbPath)) return null;

  let tmpDir: string | null = null;
  let db: Database | null = null;
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oblako-import-'));
    const tmpDb = path.join(tmpDir, 'copy.sqlite');
    fs.copyFileSync(dbPath, tmpDb);
    // WAL/SHM — если браузер открыт, часть свежих визитов/паролей лежит там. Копируем под теми же
    // именами (SQLite ищет <db>-wal / <db>-shm рядом с основным файлом), молча пропускаем отсутствие.
    for (const suffix of ['-wal', '-shm']) {
      try { fs.copyFileSync(dbPath + suffix, tmpDb + suffix); } catch { /* нет WAL/SHM — норм */ }
    }
    db = new Sqlite(tmpDb, { readonly: true, fileMustExist: true });
    return fn(db);
  } catch (e) {
    console.warn('[Import] чтение копии БД не удалось:', (e as Error).message);
    return null;
  } finally {
    try { db?.close(); } catch { /* уже закрыта */ }
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* временная папка ОС уберёт сама */ }
    }
  }
}

// Chrome/WebKit-эпоха — микросекунды с 1601-01-01 UTC (last_visit_time в History, date_created в
// Login Data). BigInt: значения (~17 цифр) превышают Number.MAX_SAFE_INTEGER, точность нельзя
// терять до финального деления. 0 (нет метки времени) → текущее время.
const CHROME_EPOCH_OFFSET_US = 11_644_473_600_000_000n;
export function chromeTimeToUnixMs(raw: number | bigint | null | undefined): number {
  if (raw === null || raw === undefined) return Date.now();
  try {
    const micros = typeof raw === 'bigint' ? raw : BigInt(Math.trunc(Number(raw)));
    if (micros <= 0n) return Date.now();
    return Number((micros - CHROME_EPOCH_OFFSET_US) / 1000n);
  } catch {
    return Date.now();
  }
}
