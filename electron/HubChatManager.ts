import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { runChatMessage, type ChatOutcome } from './TranslationService';
import { appendSearxngSources, type SearxngResult } from './SearxngSearch';

// better-sqlite3 — нативный модуль, может отсутствовать если пересборка не прошла.
// Грузим динамически, чтобы браузер запускался даже без C++ инструментов (тот же приём,
// что в HistoryManager.ts).
type Database = import('better-sqlite3').Database;
type BetterSqlite3 = typeof import('better-sqlite3');

const TITLE_MAX_LEN = 60;

export interface HubChatMessage { role: 'user' | 'assistant'; text: string; createdAt: number }
export interface HubChatSessionMeta { id: number; title: string; updatedAt: number }

interface TabChatCtx {
  sessionId: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  history: any[]; // ChatHistoryItem[] node-llama-cpp — тот же opaque-формат, что у AiPanelManager.tabContexts
}

// Отдельный файл БД от history.sqlite (тот же приём, что passwords.sqlite у PasswordManager) —
// изоляция, независимый бэкап/очистка, не конкурирует с историей посещений за одну WAL.
export class HubChatManager {
  #db: Database | null = null;
  #dbPath: string;
  // Контекст на живую вкладку Hub — тот же принцип, что tabContexts в AiPanelManager.ts:
  // эфемерно, только для продолжения диалога без похода в БД на каждое сообщение.
  #tabContexts = new Map<string, TabChatCtx>();

  constructor() {
    this.#dbPath = path.join(app.getPath('userData'), 'chats.sqlite');
  }

  async initialize(): Promise<void> {
    let SqliteConstructor: BetterSqlite3 | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      SqliteConstructor = require('better-sqlite3') as BetterSqlite3;
    } catch (e) {
      console.warn('[HubChat] better-sqlite3 не загружен — история AI-чата отключена:', (e as Error).message);
      return;
    }

    try {
      this.#db = new SqliteConstructor(this.#dbPath);
      this.#setup();
      console.log('[HubChat] база инициализирована:', this.#dbPath);
    } catch (e) {
      console.error('[HubChat] не удалось открыть БД:', (e as Error).message);
      try {
        fs.unlinkSync(this.#dbPath);
        this.#db = new SqliteConstructor(this.#dbPath);
        this.#setup();
        console.log('[HubChat] БД пересоздана после ошибки');
      } catch (e2) {
        console.error('[HubChat] пересоздание БД провалилось — история AI-чата отключена:', (e2 as Error).message);
        this.#db = null;
      }
    }
  }

  // ── Диалог ───────────────────────────────────────────────────────────────────

  // Отправка сообщения от конкретной вкладки Hub. Лениво создаёт сессию на первое сообщение
  // (заголовок = начало текста), пишет пару user/assistant в chat_messages после ответа.
  // Отсутствие БД (initialize не удался) не роняет сам чат — просто без персистентности.
  // sessionId в ответе — id, под которым (будет) сохранён этот диалог, чтобы вызывающая сторона
  // могла сразу отправить его вместе с результатом в renderer (см. main.ts::HUB_CHAT_SEND).
  //
  // grounding (опционально, web-grounding через SearXNG, см. main.ts::HUB_CHAT_SEND) — если задан,
  // Qwen получает НЕ text, а grounding.promptText (пронумерованные сниппеты + вопрос), но text
  // (сырой вопрос пользователя) всё равно то, что сохраняется/показывается как реплика user —
  // никто не хочет видеть в истории чата вместо своего вопроса весь промпт со сниппетами.
  // Источники приклеиваются к outcome.out ДО показа и ДО сохранения — что видно в ленте прямо
  // сейчас, то же самое вернётся при resumeSession после перезапуска, без расхождений.
  async sendMessage(
    tabId: string, text: string, onChunk?: (chunk: string) => void,
    grounding?: { promptText: string; sources: SearxngResult[] },
  ): Promise<{ outcome: ChatOutcome; sessionId: number | null }> {
    const ctx = this.#getOrCreateCtx(tabId);
    const outcome = await runChatMessage(grounding?.promptText ?? text, ctx.history, onChunk);
    if (outcome.ok) {
      ctx.history = outcome.history;
      const displayOut = grounding ? appendSearxngSources(outcome.out, grounding.sources) : outcome.out;
      if (this.#db) {
        try {
          const now = Date.now();
          if (ctx.sessionId === null) ctx.sessionId = this.#createSession(text, now);
          this.#appendMessage(ctx.sessionId, 'user', text, now);
          this.#appendMessage(ctx.sessionId, 'assistant', displayOut, now);
          this.#touchSession(ctx.sessionId, ctx.history, now);
        } catch (e) {
          console.warn('[HubChat] sendMessage persist error:', (e as Error).message);
        }
      }
      return { outcome: { ...outcome, out: displayOut }, sessionId: ctx.sessionId };
    }
    return { outcome, sessionId: ctx.sessionId };
  }

  // «Новый чат» — сбрасывает живой контекст вкладки, следующее сообщение создаст новую сессию.
  newSession(tabId: string): void {
    this.#tabContexts.set(tabId, { sessionId: null, history: [] });
  }

  // Продолжение старого диалога: подгружает сохранённый history_json в контекст вкладки
  // (тот же opaque-формат, что вернул runChatMessage при последнем ходе этой сессии).
  resumeSession(tabId: string, sessionId: number): HubChatMessage[] {
    if (!this.#db) return [];
    try {
      const row = this.#db.prepare(`SELECT history_json FROM chat_sessions WHERE id = ?`).get(sessionId) as { history_json: string } | undefined;
      if (!row) return [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const history = JSON.parse(row.history_json) as any[];
      this.#tabContexts.set(tabId, { sessionId, history });
      return this.getSession(sessionId);
    } catch (e) {
      console.warn('[HubChat] resumeSession error:', (e as Error).message);
      return [];
    }
  }

  listSessions(): HubChatSessionMeta[] {
    if (!this.#db) return [];
    try {
      return this.#db.prepare(`
        SELECT id, title, updated_at AS updatedAt FROM chat_sessions ORDER BY updated_at DESC
      `).all() as HubChatSessionMeta[];
    } catch (e) {
      console.warn('[HubChat] listSessions error:', (e as Error).message);
      return [];
    }
  }

  getSession(sessionId: number): HubChatMessage[] {
    if (!this.#db) return [];
    try {
      return this.#db.prepare(`
        SELECT role, text, created_at AS createdAt FROM chat_messages WHERE session_id = ? ORDER BY id ASC
      `).all(sessionId) as HubChatMessage[];
    } catch (e) {
      console.warn('[HubChat] getSession error:', (e as Error).message);
      return [];
    }
  }

  deleteSession(sessionId: number): void {
    if (!this.#db) return;
    const db = this.#db;
    try {
      const run = db.transaction(() => {
        db.prepare(`DELETE FROM chat_messages WHERE session_id = ?`).run(sessionId);
        db.prepare(`DELETE FROM chat_sessions WHERE id = ?`).run(sessionId);
      });
      run();
      for (const [tabId, ctx] of this.#tabContexts) {
        if (ctx.sessionId === sessionId) this.#tabContexts.set(tabId, { sessionId: null, history: [] });
      }
    } catch (e) {
      console.warn('[HubChat] deleteSession error:', (e as Error).message);
    }
  }

  // Закрытые вкладки не нужно держать в памяти — сами сессии в БД это не трогает.
  pruneClosedTabs(liveIds: Set<string>): void {
    for (const tabId of this.#tabContexts.keys()) {
      if (!liveIds.has(tabId)) this.#tabContexts.delete(tabId);
    }
  }

  // ── Приватное ────────────────────────────────────────────────────────────────

  #getOrCreateCtx(tabId: string): TabChatCtx {
    let ctx = this.#tabContexts.get(tabId);
    if (!ctx) {
      ctx = { sessionId: null, history: [] };
      this.#tabContexts.set(tabId, ctx);
    }
    return ctx;
  }

  #createSession(firstMessage: string, now: number): number {
    const db = this.#db!;
    const title = firstMessage.trim().slice(0, TITLE_MAX_LEN);
    const info = db.prepare(`
      INSERT INTO chat_sessions (title, history_json, created_at, updated_at) VALUES (?, '[]', ?, ?)
    `).run(title, now, now);
    return Number(info.lastInsertRowid);
  }

  #appendMessage(sessionId: number, role: 'user' | 'assistant', text: string, now: number): void {
    this.#db!.prepare(`
      INSERT INTO chat_messages (session_id, role, text, created_at) VALUES (?, ?, ?, ?)
    `).run(sessionId, role, text, now);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  #touchSession(sessionId: number, history: any[], now: number): void {
    this.#db!.prepare(`
      UPDATE chat_sessions SET history_json = ?, updated_at = ? WHERE id = ?
    `).run(JSON.stringify(history), now, sessionId);
  }

  #setup(): void {
    const db = this.#db!;
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        title        TEXT    NOT NULL,
        history_json TEXT    NOT NULL DEFAULT '[]',
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON chat_sessions(updated_at DESC);

      CREATE TABLE IF NOT EXISTS chat_messages (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id  INTEGER NOT NULL REFERENCES chat_sessions(id),
        role        TEXT    NOT NULL,
        text        TEXT    NOT NULL,
        created_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, id);
    `);
  }
}
