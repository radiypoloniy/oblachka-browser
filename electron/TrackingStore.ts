// Хранилище отслеживаемых товаров и их цен (отслеживание товаров, срез 1).
//
// Свой файл `tracking.sqlite`, а не таблица в истории — тот же приём «один менеджер, один файл»,
// что у закладок, паролей, графов и автозаполнения: разный жизненный цикл и разный профиль риска
// (очистка истории не должна задевать то, что человек поставил на отслеживание).
import { app } from 'electron';
import path from 'node:path';
import type { TrackedProduct, TrackedPricePoint, TrackingEvent, MatchSuggestion, TrackedFlight } from '../shared/ipc';

type Database = import('better-sqlite3').Database;
type BetterSqlite3 = typeof import('better-sqlite3');

interface FlightWatchRow {
  id: number;
  origin: string;
  destination: string;
  depart: string;
  returnDate: string;
  adults: number;
  children: number;
  infants: number;
  cabin: string;
  airline: string;
  flightNumber: string;
  title: string;
  openUrl: string;
  currency: string;
}

// Сколько точек истории отдаём наружу на график. Больше на спарклайне всё равно не различить.
const MAX_POINTS = 180;

export class TrackingStore {
  #db: Database | null = null;
  #dbPath: string;

  constructor(dbPath?: string) {
    this.#dbPath = dbPath ?? path.join(app.getPath('userData'), 'tracking.sqlite');
  }

  initialize(): void {
    let SqliteConstructor: BetterSqlite3 | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      SqliteConstructor = require('better-sqlite3') as BetterSqlite3;
    } catch (e) {
      console.warn('[Tracking] better-sqlite3 не загружен — отслеживание отключено:', (e as Error).message);
      return;
    }
    try {
      this.#db = new SqliteConstructor(this.#dbPath);
      this.#db.pragma('journal_mode = WAL');
      this.#db.exec(`
        CREATE TABLE IF NOT EXISTS tracked (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          url        TEXT    NOT NULL UNIQUE,
          host       TEXT    NOT NULL DEFAULT '',
          title      TEXT    NOT NULL DEFAULT '',
          brand      TEXT    NOT NULL DEFAULT '',
          sku        TEXT    NOT NULL DEFAULT '',
          gtin       TEXT    NOT NULL DEFAULT '',
          currency   TEXT    NOT NULL DEFAULT 'RUB',
          created_at INTEGER NOT NULL
        );
        -- ⚠️ Точка цены — отдельная строка на КАЖДОЕ наблюдение, а не поле «текущая цена»: вся
        -- ценность фичи в динамике, и переписывать одно поле значило бы стирать историю.
        CREATE TABLE IF NOT EXISTS price_point (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          tracked_id   INTEGER NOT NULL REFERENCES tracked(id) ON DELETE CASCADE,
          price        REAL    NOT NULL,
          availability TEXT    NOT NULL DEFAULT '',
          seen_at      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_price_point_tracked ON price_point(tracked_id, seen_at);
        -- ⚠️ Журнал событий нужен, даже если человек увидит тост: тост живёт секунды и его легко
        -- пропустить, а «что случилось, пока меня не было» — главный вопрос к отслеживанию.
        CREATE TABLE IF NOT EXISTS event (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          tracked_id INTEGER NOT NULL REFERENCES tracked(id) ON DELETE CASCADE,
          kind       TEXT    NOT NULL,
          text       TEXT    NOT NULL,
          at         INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_event_at ON event(at DESC);
        -- Мелкие настройки самого отслеживания (тумблер уведомлений). Свой ключ-значение, чтобы
        -- не тянуть общий SettingsManager ради одного флага.
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        -- Предложение склеить два товара. ⚠️ Отдельная таблица, а не сразу group_id: предложение
        -- модели должен подтвердить человек, и до подтверждения оно ничего не меняет.
        CREATE TABLE IF NOT EXISTS match_suggestion (
          id     INTEGER PRIMARY KEY AUTOINCREMENT,
          a_id   INTEGER NOT NULL REFERENCES tracked(id) ON DELETE CASCADE,
          b_id   INTEGER NOT NULL REFERENCES tracked(id) ON DELETE CASCADE,
          at     INTEGER NOT NULL,
          UNIQUE(a_id, b_id)
        );
        -- Часы на билет. Свой ключ (маршрут+даты+рейс), не url UNIQUE товаров: на одном поиске
        -- можно следить и за самым дешёвым, и за конкретным SU 1234.
        CREATE TABLE IF NOT EXISTS flight_watch (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          origin        TEXT    NOT NULL,
          destination   TEXT    NOT NULL,
          depart        TEXT    NOT NULL,
          return_date   TEXT    NOT NULL DEFAULT '',
          adults        INTEGER NOT NULL DEFAULT 1,
          children      INTEGER NOT NULL DEFAULT 0,
          infants       INTEGER NOT NULL DEFAULT 0,
          cabin         TEXT    NOT NULL DEFAULT 'Y',
          airline       TEXT    NOT NULL DEFAULT '',
          flight_number TEXT    NOT NULL DEFAULT '',
          title         TEXT    NOT NULL DEFAULT '',
          open_url      TEXT    NOT NULL DEFAULT '',
          currency      TEXT    NOT NULL DEFAULT 'RUB',
          created_at    INTEGER NOT NULL,
          last_checked_at INTEGER NOT NULL DEFAULT 0,
          last_check_ok   INTEGER NOT NULL DEFAULT 1,
          UNIQUE(origin, destination, depart, return_date, adults, cabin, airline, flight_number)
        );
        CREATE TABLE IF NOT EXISTS flight_price_point (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          watch_id     INTEGER NOT NULL REFERENCES flight_watch(id) ON DELETE CASCADE,
          price        REAL    NOT NULL,
          availability TEXT    NOT NULL DEFAULT '',
          seen_at      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_flight_price_point ON flight_price_point(watch_id, seen_at);
        CREATE TABLE IF NOT EXISTS flight_event (
          id       INTEGER PRIMARY KEY AUTOINCREMENT,
          watch_id INTEGER NOT NULL REFERENCES flight_watch(id) ON DELETE CASCADE,
          kind     TEXT    NOT NULL,
          text     TEXT    NOT NULL,
          at       INTEGER NOT NULL
        );
      `);
      // ⚠️ Миграция ТОЛЬКО добавлением колонок и по одной, каждая в своём try: база уже лежит у
      // людей с их данными (срез 1), и перестраивать таблицу ради двух полей незачем. Повторный
      // запуск ловит «duplicate column name» и идёт дальше — это и есть признак «уже применено».
      for (const alter of [
        `ALTER TABLE tracked ADD COLUMN last_checked_at INTEGER NOT NULL DEFAULT 0`,
        `ALTER TABLE tracked ADD COLUMN last_check_ok INTEGER NOT NULL DEFAULT 1`,
        // 0 — товар читается обычным запросом (дёшево), 1 — нужна загрузка страницы (дорого).
        // От этого зависит, как часто мы к нему ходим (см. TrackingChecker).
        `ALTER TABLE tracked ADD COLUMN check_cost INTEGER NOT NULL DEFAULT 1`,
        `ALTER TABLE tracked ADD COLUMN mpn TEXT NOT NULL DEFAULT ''`,
        // Группа — это «один товар в разных магазинах». NULL/0 — сам по себе.
        `ALTER TABLE tracked ADD COLUMN group_id INTEGER NOT NULL DEFAULT 0`,
      ]) {
        try { this.#db.exec(alter); } catch { /* колонка уже есть */ }
      }
      this.#db.pragma('foreign_keys = ON');
      console.log('[Tracking] база инициализирована:', this.#dbPath);
    } catch (e) {
      console.warn('[Tracking] база недоступна:', (e as Error).message);
      this.#db = null;
    }
  }

  get available(): boolean { return this.#db !== null; }

  /** Отслеживается ли этот адрес. */
  idForUrl(url: string): number | null {
    if (!this.#db) return null;
    try {
      const row = this.#db.prepare(`SELECT id FROM tracked WHERE url = ?`).get(url) as { id: number } | undefined;
      return row?.id ?? null;
    } catch { return null; }
  }

  /**
   * Поставить на отслеживание и сразу записать первую цену.
   * ⚠️ Идемпотентно по адресу: повторное «отслеживать» на той же странице не заводит второй записи.
   */
  track(p: { url: string; host: string; title: string; brand: string; sku: string; gtin: string; mpn: string; currency: string; price: number; availability: string }): number | null {
    if (!this.#db) return null;
    try {
      const existing = this.idForUrl(p.url);
      if (existing !== null) { this.addPoint(existing, p.price, p.availability); return existing; }
      const info = this.#db.prepare(`
        INSERT INTO tracked (url, host, title, brand, sku, gtin, mpn, currency, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(p.url, p.host, p.title, p.brand, p.sku, p.gtin, p.mpn, p.currency || 'RUB', Date.now());
      const id = Number(info.lastInsertRowid);
      this.addPoint(id, p.price, p.availability);
      return id;
    } catch (e) {
      console.warn('[Tracking] не удалось поставить на отслеживание:', (e as Error).message);
      return null;
    }
  }

  untrack(id: number): void {
    if (!this.#db) return;
    try { this.#db.prepare(`DELETE FROM tracked WHERE id = ?`).run(id); } catch { /* нечего удалять */ }
  }

  /**
   * Записать наблюдение.
   *
   * ⚠️ Одинаковое подряд НЕ пишем: человек открывает карточку по десять раз за вечер, и без этого
   * график превратился бы в частокол из одинаковых точек, а «цена изменилась» пришлось бы искать
   * глазами. Меняется цена или наличие — пишем.
   */
  addPoint(trackedId: number, price: number, availability: string): void {
    if (!this.#db || !(price > 0)) return;
    try {
      const last = this.#db.prepare(`
        SELECT price, availability FROM price_point WHERE tracked_id = ? ORDER BY seen_at DESC LIMIT 1
      `).get(trackedId) as { price: number; availability: string } | undefined;
      if (last && last.price === price && last.availability === availability) return;
      this.#db.prepare(`
        INSERT INTO price_point (tracked_id, price, availability, seen_at) VALUES (?, ?, ?, ?)
      `).run(trackedId, price, availability, Date.now());
    } catch (e) {
      console.warn('[Tracking] точка цены не записалась:', (e as Error).message);
    }
  }

  /**
   * Отметить, чем кончилась фоновая проверка.
   *
   * ⚠️ Неудачу записываем ТОЖЕ, и это несущее: без неё экран показывал бы последнюю известную цену
   * как свежую, а человек принимал бы решение о покупке по данным месячной давности, не зная об
   * этом. «Не смогли проверить» — честный и обязательный исход.
   */
  markChecked(id: number, ok: boolean, cost?: 0 | 1): void {
    if (!this.#db) return;
    try {
      if (cost === undefined) {
        this.#db.prepare(`UPDATE tracked SET last_checked_at = ?, last_check_ok = ? WHERE id = ?`)
          .run(Date.now(), ok ? 1 : 0, id);
      } else {
        this.#db.prepare(`UPDATE tracked SET last_checked_at = ?, last_check_ok = ?, check_cost = ? WHERE id = ?`)
          .run(Date.now(), ok ? 1 : 0, cost, id);
      }
    } catch { /* запись отметки не критична */ }
  }

  /**
   * Что пора проверить. Срок СВОЙ у каждого товара и зависит от того, во что нам обходится
   * проверка (см. TrackingChecker): дешёвые ходят чаще, дорогие реже, неудачные — с отступом.
   * Самое давнее — первым.
   */
  dueForCheck(rawMs: number, viewMs: number, failMs: number, limit: number): Array<{ id: number; url: string }> {
    if (!this.#db) return [];
    try {
      return this.#db.prepare(`
        SELECT id, url FROM tracked
        WHERE last_checked_at < (? - CASE
          WHEN last_check_ok = 0 THEN ?
          WHEN check_cost = 0   THEN ?
          ELSE ? END)
        ORDER BY last_checked_at ASC LIMIT ?
      `).all(Date.now(), failMs, rawMs, viewMs, limit) as Array<{ id: number; url: string }>;
    } catch { return []; }
  }

  /** Все отслеживаемые адреса — для проверки по кнопке «проверить сейчас». */
  allForCheck(): Array<{ id: number; url: string }> {
    if (!this.#db) return [];
    try {
      return this.#db.prepare(`SELECT id, url FROM tracked ORDER BY created_at DESC`)
        .all() as Array<{ id: number; url: string }>;
    } catch { return []; }
  }

  // ── Склейка одного товара с разных сайтов (срез 4) ────────────────────────

  /** Товары, с которыми можно сравнить новый: все прочие, ещё не в одной с ним группе. */
  othersFor(id: number): Array<{ id: number; title: string; gtin: string; mpn: string; brand: string; groupId: number }> {
    if (!this.#db) return [];
    try {
      const self = this.#db.prepare(`SELECT group_id AS groupId FROM tracked WHERE id = ?`).get(id) as { groupId: number } | undefined;
      const g = self?.groupId ?? 0;
      return this.#db.prepare(`
        SELECT id, title, gtin, mpn, brand, group_id AS groupId FROM tracked
        WHERE id != ? AND (group_id = 0 OR group_id != ?)
      `).all(id, g || -1) as Array<{ id: number; title: string; gtin: string; mpn: string; brand: string; groupId: number }>;
    } catch { return []; }
  }

  codesFor(id: number): { id: number; title: string; gtin: string; mpn: string; brand: string } | null {
    if (!this.#db) return null;
    try {
      return (this.#db.prepare(`SELECT id, title, gtin, mpn, brand FROM tracked WHERE id = ?`).get(id) ?? null) as
        { id: number; title: string; gtin: string; mpn: string; brand: string } | null;
    } catch { return null; }
  }

  /**
   * Свести два товара в одну группу.
   * ⚠️ Если у одного группа уже есть — забираем в неё, а не заводим третью: иначе склейка «А+Б»,
   * потом «Б+В» оставила бы А и В в разных группах, хотя это один товар.
   */
  joinGroup(aId: number, bId: number): void {
    if (!this.#db) return;
    try {
      const rows = this.#db.prepare(`SELECT id, group_id AS g FROM tracked WHERE id IN (?, ?)`)
        .all(aId, bId) as Array<{ id: number; g: number }>;
      const existing = rows.map((r) => r.g).filter((g) => g > 0);
      const gid = existing.length ? Math.min(...existing) : aId; // id первого — простой и стабильный ключ
      this.#db.prepare(`UPDATE tracked SET group_id = ? WHERE id IN (?, ?)`).run(gid, aId, bId);
      // Если у второго была своя группа — переносим её участников целиком.
      for (const g of existing) {
        if (g !== gid) this.#db.prepare(`UPDATE tracked SET group_id = ? WHERE group_id = ?`).run(gid, g);
      }
      this.#db.prepare(`DELETE FROM match_suggestion WHERE (a_id = ? AND b_id = ?) OR (a_id = ? AND b_id = ?)`)
        .run(aId, bId, bId, aId);
    } catch (e) {
      console.warn('[Tracking] не удалось объединить:', (e as Error).message);
    }
  }

  /** Вынуть товар из группы — человек передумал. */
  leaveGroup(id: number): void {
    if (!this.#db) return;
    try { this.#db.prepare(`UPDATE tracked SET group_id = 0 WHERE id = ?`).run(id); } catch { /* нечего */ }
  }

  addSuggestion(aId: number, bId: number): void {
    if (!this.#db) return;
    try {
      this.#db.prepare(`INSERT OR IGNORE INTO match_suggestion (a_id, b_id, at) VALUES (?, ?, ?)`)
        .run(Math.min(aId, bId), Math.max(aId, bId), Date.now());
    } catch { /* не критично */ }
  }

  dismissSuggestion(aId: number, bId: number): void {
    if (!this.#db) return;
    try {
      this.#db.prepare(`DELETE FROM match_suggestion WHERE a_id = ? AND b_id = ?`)
        .run(Math.min(aId, bId), Math.max(aId, bId));
    } catch { /* не критично */ }
  }

  listSuggestions(): MatchSuggestion[] {
    if (!this.#db) return [];
    try {
      return this.#db.prepare(`
        SELECT s.a_id AS aId, s.b_id AS bId, a.title AS aTitle, b.title AS bTitle,
               a.host AS aHost, b.host AS bHost
        FROM match_suggestion s
        JOIN tracked a ON a.id = s.a_id
        JOIN tracked b ON b.id = s.b_id
        ORDER BY s.at DESC LIMIT 10
      `).all() as MatchSuggestion[];
    } catch { return []; }
  }

  /** Последнее наблюдение — с ним сравнивается новое, чтобы понять, случилось ли событие. */
  lastPoint(trackedId: number): { price: number; availability: string } | null {
    if (!this.#db) return null;
    try {
      const row = this.#db.prepare(`
        SELECT price, availability FROM price_point WHERE tracked_id = ? ORDER BY seen_at DESC LIMIT 1
      `).get(trackedId) as { price: number; availability: string } | undefined;
      return row ?? null;
    } catch { return null; }
  }

  addEvent(trackedId: number, kind: string, text: string): void {
    if (!this.#db) return;
    try {
      this.#db.prepare(`INSERT INTO event (tracked_id, kind, text, at) VALUES (?, ?, ?, ?)`)
        .run(trackedId, kind, text, Date.now());
    } catch (e) {
      console.warn('[Tracking] событие не записалось:', (e as Error).message);
    }
  }

  listEvents(limit = 40): TrackingEvent[] {
    if (!this.#db) return [];
    try {
      return this.#db.prepare(`
        SELECT id, kind, text, at, title, url, source FROM (
          SELECT e.id, e.kind, e.text, e.at, t.title, t.url, 'product' AS source
          FROM event e JOIN tracked t ON t.id = e.tracked_id
          UNION ALL
          SELECT e.id, e.kind, e.text, e.at, w.title, w.open_url AS url, 'flight' AS source
          FROM flight_event e JOIN flight_watch w ON w.id = e.watch_id
        )
        ORDER BY at DESC LIMIT ?
      `).all(limit) as TrackingEvent[];
    } catch { return []; }
  }

  /** Тумблер уведомлений. По умолчанию ВКЛЮЧЕНО: человек сам поставил товар на слежение. */
  notificationsEnabled(): boolean {
    if (!this.#db) return false;
    try {
      const row = this.#db.prepare(`SELECT value FROM meta WHERE key = 'notify'`).get() as { value: string } | undefined;
      return row?.value !== '0';
    } catch { return true; }
  }

  setNotificationsEnabled(on: boolean): void {
    if (!this.#db) return;
    try {
      this.#db.prepare(`INSERT INTO meta (key, value) VALUES ('notify', ?)
                        ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(on ? '1' : '0');
    } catch { /* не критично */ }
  }

  /** Список отслеживаемого вместе с историей — экран рисует по нему и список, и график. */
  list(): TrackedProduct[] {
    if (!this.#db) return [];
    try {
      const rows = this.#db.prepare(`
        SELECT id, url, host, title, brand, currency, created_at AS createdAt,
               last_checked_at AS lastCheckedAt, last_check_ok AS lastCheckOk,
               group_id AS groupId
        FROM tracked ORDER BY group_id DESC, created_at DESC
      `).all() as Array<Omit<TrackedProduct, 'points'>>;
      const stmt = this.#db.prepare(`
        SELECT price, availability, seen_at AS seenAt FROM price_point
        WHERE tracked_id = ? ORDER BY seen_at ASC LIMIT ${MAX_POINTS}
      `);
      return rows.map((r) => ({ ...r, points: stmt.all(r.id) as TrackedPricePoint[] }));
    } catch (e) {
      console.warn('[Tracking] список не прочитался:', (e as Error).message);
      return [];
    }
  }

  // ── Часы на билеты ─────────────────────────────────────────────────────────

  idForFlight(p: {
    origin: string; destination: string; depart: string; returnDate: string;
    adults: number; cabin: string; airline: string; flightNumber: string;
  }): number | null {
    if (!this.#db) return null;
    try {
      const row = this.#db.prepare(`
        SELECT id FROM flight_watch
        WHERE origin = ? AND destination = ? AND depart = ? AND return_date = ?
          AND adults = ? AND cabin = ? AND airline = ? AND flight_number = ?
      `).get(
        p.origin, p.destination, p.depart, p.returnDate,
        p.adults, p.cabin, p.airline, p.flightNumber,
      ) as { id: number } | undefined;
      return row?.id ?? null;
    } catch { return null; }
  }

  trackFlight(p: {
    origin: string; destination: string; depart: string; returnDate: string;
    adults: number; children: number; infants: number; cabin: string;
    airline: string; flightNumber: string; title: string; openUrl: string;
    currency: string; price: number;
  }): number | null {
    if (!this.#db) return null;
    try {
      const existing = this.idForFlight(p);
      if (existing !== null) {
        this.addFlightPoint(existing, p.price, '');
        return existing;
      }
      const info = this.#db.prepare(`
        INSERT INTO flight_watch (
          origin, destination, depart, return_date, adults, children, infants, cabin,
          airline, flight_number, title, open_url, currency, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        p.origin, p.destination, p.depart, p.returnDate, p.adults, p.children, p.infants, p.cabin,
        p.airline, p.flightNumber, p.title, p.openUrl, p.currency || 'RUB', Date.now(),
      );
      const id = Number(info.lastInsertRowid);
      this.addFlightPoint(id, p.price, '');
      return id;
    } catch (e) {
      console.warn('[Tracking] не удалось поставить рейс на отслеживание:', (e as Error).message);
      return null;
    }
  }

  untrackFlight(id: number): void {
    if (!this.#db) return;
    try { this.#db.prepare(`DELETE FROM flight_watch WHERE id = ?`).run(id); } catch { /* нечего */ }
  }

  addFlightPoint(watchId: number, price: number, availability: string): void {
    if (!this.#db || !(price > 0)) return;
    try {
      const last = this.#db.prepare(`
        SELECT price, availability FROM flight_price_point WHERE watch_id = ? ORDER BY seen_at DESC LIMIT 1
      `).get(watchId) as { price: number; availability: string } | undefined;
      if (last && last.price === price && last.availability === availability) return;
      this.#db.prepare(`
        INSERT INTO flight_price_point (watch_id, price, availability, seen_at) VALUES (?, ?, ?, ?)
      `).run(watchId, price, availability, Date.now());
    } catch (e) {
      console.warn('[Tracking] точка цены рейса не записалась:', (e as Error).message);
    }
  }

  markFlightChecked(id: number, ok: boolean): void {
    if (!this.#db) return;
    try {
      this.#db.prepare(`UPDATE flight_watch SET last_checked_at = ?, last_check_ok = ? WHERE id = ?`)
        .run(Date.now(), ok ? 1 : 0, id);
    } catch { /* не критично */ }
  }

  dueFlights(rawMs: number, failMs: number, limit: number): Array<{ id: number }> {
    if (!this.#db) return [];
    try {
      return this.#db.prepare(`
        SELECT id FROM flight_watch
        WHERE last_checked_at < (? - CASE WHEN last_check_ok = 0 THEN ? ELSE ? END)
        ORDER BY last_checked_at ASC LIMIT ?
      `).all(Date.now(), failMs, rawMs, limit) as Array<{ id: number }>;
    } catch { return []; }
  }

  allFlightsForCheck(): Array<{ id: number }> {
    if (!this.#db) return [];
    try {
      return this.#db.prepare(`SELECT id FROM flight_watch ORDER BY created_at DESC`).all() as Array<{ id: number }>;
    } catch { return []; }
  }

  flightById(id: number): FlightWatchRow | null {
    if (!this.#db) return null;
    try {
      return (this.#db.prepare(`
        SELECT id, origin, destination, depart, return_date AS returnDate,
               adults, children, infants, cabin, airline,
               flight_number AS flightNumber, title, open_url AS openUrl, currency
        FROM flight_watch WHERE id = ?
      `).get(id) ?? null) as FlightWatchRow | null;
    } catch { return null; }
  }

  lastFlightPoint(watchId: number): { price: number; availability: string } | null {
    if (!this.#db) return null;
    try {
      const row = this.#db.prepare(`
        SELECT price, availability FROM flight_price_point WHERE watch_id = ? ORDER BY seen_at DESC LIMIT 1
      `).get(watchId) as { price: number; availability: string } | undefined;
      return row ?? null;
    } catch { return null; }
  }

  addFlightEvent(watchId: number, kind: string, text: string): void {
    if (!this.#db) return;
    try {
      this.#db.prepare(`INSERT INTO flight_event (watch_id, kind, text, at) VALUES (?, ?, ?, ?)`)
        .run(watchId, kind, text, Date.now());
    } catch (e) {
      console.warn('[Tracking] событие рейса не записалось:', (e as Error).message);
    }
  }

  lastFlightEventKind(watchId: number): string | null {
    if (!this.#db) return null;
    try {
      const row = this.#db.prepare(`
        SELECT kind FROM flight_event WHERE watch_id = ? ORDER BY at DESC LIMIT 1
      `).get(watchId) as { kind: string } | undefined;
      return row?.kind ?? null;
    } catch { return null; }
  }

  /** Билет в прошлом не следят: дата вылета уже прошла. */
  expirePastFlights(todayIso: string): number {
    if (!this.#db) return 0;
    try {
      const info = this.#db.prepare(`DELETE FROM flight_watch WHERE depart < ?`).run(todayIso);
      return info.changes;
    } catch { return 0; }
  }

  listFlights(): TrackedFlight[] {
    if (!this.#db) return [];
    try {
      const rows = this.#db.prepare(`
        SELECT id, origin, destination, depart, return_date AS returnDate, adults, cabin,
               airline, flight_number AS flightNumber, title, open_url AS openUrl, currency,
               created_at AS createdAt, last_checked_at AS lastCheckedAt, last_check_ok AS lastCheckOk
        FROM flight_watch ORDER BY created_at DESC
      `).all() as Array<Omit<TrackedFlight, 'points'>>;
      const stmt = this.#db.prepare(`
        SELECT price, availability, seen_at AS seenAt FROM flight_price_point
        WHERE watch_id = ? ORDER BY seen_at ASC LIMIT ${MAX_POINTS}
      `);
      return rows.map((r) => ({ ...r, points: stmt.all(r.id) as TrackedPricePoint[] }));
    } catch (e) {
      console.warn('[Tracking] список рейсов не прочитался:', (e as Error).message);
      return [];
    }
  }
}
