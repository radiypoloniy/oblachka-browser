// Кэш переводов страниц (Qwen/Bergamot, см. ITranslationEngine) — SQLite, отдельный файл
// translations.sqlite (тот же принцип "один менеджер — один файл", что у HistoryManager.ts/
// PasswordManager.ts/HubChatManager.ts/PermissionManager.ts). Прозрачно подключается поверх
// активного движка в TranslationEngineRegistry.ts::getActiveEngine() (см. CachingTranslationEngine.ts) —
// сам DOM-слой (PageTranslateManager.ts) про кэш ничего не знает и не тронут.
//
// Ключ хэша включает engine — переводы Qwen и Bergamot никогда не путаются друг с другом, даже
// для одного и того же текста и пары языков (разное качество/маркеры разметки у движков).
//
// Миграция строго аддитивная (CREATE TABLE IF NOT EXISTS, без ALTER/DROP на существующих
// таблицах) — см. initialize(). Перед КАЖДЫМ открытием, если файл базы уже существует (не первый
// запуск), делаем файловую копию рядом (.bak-<timestamp>): миграция в теории безопасна (только
// аддитивный CREATE TABLE), но это не повод не подстраховаться перед тем, как вообще притронуться
// к файлу с реальными пользовательскими данными.
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import type { EngineId } from './TranslationEngine';

// better-sqlite3 — нативный модуль, может отсутствовать, если пересборка не прошла (см.
// HistoryManager.ts — тот же приём). Грузим динамически, чтобы браузер запускался без него, а
// кэш переводов просто не работал (translateBatch идёт мимо кэша, ITranslationEngine.translateBatch
// вызывается напрямую — не хуже, чем было ДО Этапа 4).
type Database = import('better-sqlite3').Database;
type BetterSqlite3 = typeof import('better-sqlite3');

export class TranslationCacheManager {
  #db: Database | null = null;
  #dbPath: string;

  constructor() {
    this.#dbPath = path.join(app.getPath('userData'), 'translations.sqlite');
  }

  async initialize(): Promise<void> {
    let SqliteConstructor: BetterSqlite3 | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      SqliteConstructor = require('better-sqlite3') as BetterSqlite3;
    } catch (e) {
      console.warn('[translation-cache] better-sqlite3 не загружен — кэш переводов отключён:', (e as Error).message);
      return;
    }

    this.#backupIfExists();

    const db = new SqliteConstructor(this.#dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS translation_cache (
        hash TEXT PRIMARY KEY,
        engine TEXT NOT NULL,
        src_lang TEXT NOT NULL,
        tgt_lang TEXT NOT NULL,
        translated_html TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    this.#db = db;
  }

  #backupIfExists(): void {
    if (!fs.existsSync(this.#dbPath)) return; // первый запуск — файла ещё нет, копировать нечего
    const backupPath = `${this.#dbPath}.bak-${Date.now()}`;
    try {
      fs.copyFileSync(this.#dbPath, backupPath);
      console.log(`[translation-cache] бэкап перед миграцией: ${backupPath}`);
    } catch (e) {
      console.error('[translation-cache] не удалось сделать бэкап перед миграцией (продолжаю без него):', e);
    }
  }

  // sourceText — то, что реально приходит в ITranslationEngine.translateBatch (⟪N⟫-маркеры
  // DOM-слоя, см. TranslationEngine.ts) — НЕ настоящий HTML со страницы, несмотря на имя колонки
  // translated_html в схеме (имя — как в плане/задании, содержимое — уже существующий внутренний
  // формат DOM-слоя, другого источника правды здесь нет и не нужно).
  #hash(engine: EngineId, from: string, to: string, sourceText: string): string {
    // Разделитель-пробел безопасен именно потому, что engine/from/to — фиксированный узкий
    // словарь коротких кодов без пробелов ('qwen'|'bergamot', 'en'|'ru'|'fr'...): неоднозначность
    // разбора могла бы возникнуть только МЕЖДУ этими тремя полями, а не между ними и sourceText —
    // он всегда последний, дальше в строке ничего нет, с чем он мог бы склеиться и спутаться.
    return crypto.createHash('sha256').update(`${engine} ${from} ${to} ${sourceText}`).digest('hex');
  }

  get(engine: EngineId, from: string, to: string, sourceText: string): string | null {
    if (!this.#db) return null;
    const hash = this.#hash(engine, from, to, sourceText);
    const row = this.#db.prepare('SELECT translated_html FROM translation_cache WHERE hash = ?').get(hash) as
      | { translated_html: string }
      | undefined;
    return row?.translated_html ?? null;
  }

  set(engine: EngineId, from: string, to: string, sourceText: string, translatedText: string): void {
    if (!this.#db) return;
    const hash = this.#hash(engine, from, to, sourceText);
    this.#db
      .prepare(
        `INSERT INTO translation_cache (hash, engine, src_lang, tgt_lang, translated_html, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(hash) DO UPDATE SET translated_html = excluded.translated_html, created_at = excluded.created_at`,
      )
      .run(hash, engine, from, to, translatedText, Date.now());
  }
}
