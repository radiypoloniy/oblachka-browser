import { app } from 'electron';
import type { Session } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { PermissionRecord, PermissionRequest, PermKey } from '../shared/ipc';
import { isBackgroundWebContents } from './BackgroundWebContents';
import { sqliteOpenFailed } from './sqliteOpenFailed';

type Database = import('better-sqlite3').Database;
type BetterSqlite3 = typeof import('better-sqlite3');
type Decision = 'granted' | 'denied';

// Проверяем, является ли permission ключом, требующим UI.
// Остальное (USB, HID, Serial, MIDI sysex, pointerLock и т.д.) — запрещать без prompt.
function resolveForRequest(
  permission: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details: any,
): { keys: PermKey[]; displayKey: PermKey } | null {
  if (permission === 'media') {
    const types: string[] = details?.mediaTypes ?? [];
    const video = types.includes('video');
    const audio = types.includes('audio');
    if (video && audio) return { keys: ['camera', 'microphone'], displayKey: 'camera+microphone' };
    if (video)          return { keys: ['camera'],               displayKey: 'camera' };
    if (audio)          return { keys: ['microphone'],           displayKey: 'microphone' };
    return null; // нет mediaTypes → экзотика → запретить
  }
  switch (permission) {
    case 'geolocation':              return { keys: ['geolocation'],              displayKey: 'geolocation' };
    case 'notifications':            return { keys: ['notifications'],            displayKey: 'notifications' };
    case 'fullscreen':               return { keys: ['fullscreen'],               displayKey: 'fullscreen' };
    case 'clipboard-read':           return { keys: ['clipboard-read'],           displayKey: 'clipboard-read' };
    case 'clipboard-sanitized-write':return { keys: ['clipboard-sanitized-write'],displayKey: 'clipboard-sanitized-write' };
    default:                         return null; // всё остальное — запрещать без UI
  }
}

function resolveForCheck(
  permission: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details: any,
): PermKey | null {
  if (permission === 'media') {
    const mt: string = details?.mediaType ?? '';
    if (mt === 'video') return 'camera';
    if (mt === 'audio') return 'microphone';
    return null; // unknown → запретить
  }
  switch (permission) {
    case 'geolocation':               return 'geolocation';
    case 'notifications':             return 'notifications';
    case 'fullscreen':                return 'fullscreen';
    case 'clipboard-read':            return 'clipboard-read';
    case 'clipboard-sanitized-write': return 'clipboard-sanitized-write';
    default:                          return null;
  }
}

function safeOrigin(url: string): string {
  if (!url) return '';
  try { return new URL(url).origin; }
  catch { return url; }
}

interface PendingEntry {
  callback: (granted: boolean) => void;
  origin: string;
  keysToStore: PermKey[];
}

// Кто спрашивает — нужно, чтобы вопрос всплыл В ТОМ ЖЕ окне, где живёт вкладка. Раньше он
// всегда уходил в главное окно, и запрос камеры из второго окна появлялся в первом.
export type SendPermissionRequest = (req: PermissionRequest, requesterWcId: number | null) => void;

export class PermissionManager {
  #db: Database | null = null;
  #dbPath: string;
  #pending = new Map<string, PendingEntry>();
  #sendRequest: SendPermissionRequest | null = null;

  constructor() {
    this.#dbPath = path.join(app.getPath('userData'), 'permissions.sqlite');
  }

  async initialize(): Promise<void> {
    let Sqlite: BetterSqlite3 | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      Sqlite = require('better-sqlite3') as BetterSqlite3;
    } catch (e) {
      console.warn('[Permissions] better-sqlite3 недоступен — разрешения не персистируются:', (e as Error).message);
      return;
    }
    try {
      this.#db = new Sqlite(this.#dbPath);
      this.#setup();
      console.log('[Permissions] база инициализирована:', this.#dbPath);
    } catch (e) {
      this.#db = sqliteOpenFailed('Permissions', this.#dbPath, e);
    }
  }

  attach(sess: Session, sendRequest: SendPermissionRequest): void {
    this.#sendRequest = sendRequest;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sess as any).setPermissionRequestHandler(
      (wc: { id: number; getURL(): string } | null, permission: string, callback: (granted: boolean) => void, details: unknown) => {
        // Фоновая (не пользователем открытая) вкладка — см. BackgroundWebContents.ts. Тихий deny,
        // без всплытия в UI: запрос разрешения без видимой вкладки-источника только запутал бы.
        if (wc && isBackgroundWebContents(wc.id)) { callback(false); return; }

        const rawUrl = (details as { requestingUrl?: string })?.requestingUrl
          ?? (wc ? wc.getURL() : '');
        const origin = safeOrigin(rawUrl);

        const resolved = resolveForRequest(permission, details);
        if (!resolved) { callback(false); return; }

        const { keys, displayKey } = resolved;

        // Проверяем сохранённые решения для всех нужных ключей.
        const decisions = keys.map((k) => this.#lookup(origin, k));
        if (decisions.every((d) => d !== null)) {
          // Все ключи уже решены — отвечаем без prompt.
          callback(decisions.every((d) => d === 'granted'));
          return;
        }
        if (decisions.some((d) => d === 'denied')) {
          // Хоть один явно запрещён — запрещаем всё без prompt.
          callback(false);
          return;
        }

        const requestId = randomUUID();
        this.#pending.set(requestId, { callback, origin, keysToStore: keys });
        this.#sendRequest?.({ requestId, origin, permission: displayKey }, wc?.id ?? null);
      },
    );

    // check-хендлер синхронный — только чтение из БД, ничего тяжёлого.
    //
    // ⚠️ НЕРЕШЁННОЕ разрешение отвечает ДА, а не НЕТ. Это не послабление, а починка: у Chromium
    // три состояния (granted / denied / prompt), а этот хендлер умеет вернуть только булево.
    // Пока «нет записи» отвечало НЕТ, сайт видел ровно то же, что при явном запрете:
    // navigator.permissions.query() отдавал 'denied', и приличный сайт даже не пытался звать
    // getUserMedia — то есть окно вопроса не появлялось НИКОГДА, а человек видел «микрофон не
    // работает» без единого шанса что-то разрешить. Ровно так сломался телемост: в базе
    // разрешений у него не было и нет ни одной записи про микрофон — значит запрет пришёл не от
    // человека, а отсюда.
    //
    // Настоящий доступ этим не открывается: реальный getUserMedia всё равно идёт через
    // setPermissionRequestHandler выше, который и спрашивает. Здесь мы отвечаем на вопрос
    // «стоит ли пробовать», и честный ответ на него — «да, спросим у человека».
    //
    // ⚠️ ЯВНЫЙ запрет по-прежнему отвечает НЕТ, и это важнее: сказавший «нет» не должен получать
    // тот же вопрос снова. И всё, для чего у нас вообще нет окна вопроса (USB, HID, MIDI sysex),
    // как и раньше запрещается молча — resolveForCheck отдаёт по ним null.
    //
    // ⚠️ НО оптимистичное «да» действует ТОЛЬКО на камеру и микрофон, а не на всё подряд.
    // Замер отпечатка против Edge на одной странице показал, во что обходилось прежнее «да на
    // любое нерешённое»: `Notification.permission` отдавал 'granted' на ПЕРВОМ же визите, а
    // `enumerateDevices()` отдавал 7 устройств С НАЗВАНИЯМИ — притом что у Edge там 'default' и
    // ноль названий. Это не «мягче настройка», это состояние, которого у настоящего браузера
    // быть не может: названия устройств не показывают без выданного доступа, а уведомления не
    // бывают разрешены до того, как человека спросили. Ровно по таким невозможным состояниям
    // антибот-проверки и опознают неродной браузер, и цена ошибки нулевая — так не бывает ни у
    // кого. Плюс это была утечка отпечатка (список микрофонов и колонок) каждому сайту, что для
    // приватного браузера отдельно неприемлемо.
    //
    // Починка телемоста при этом на месте: разбор в CLAUDE.md был именно про getUserMedia —
    // приличный сайт спрашивает `permissions.query({name:'microphone'})` и не зовёт микрофон,
    // увидев 'denied'. Это про камеру и микрофон, и только они «да» и получают.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sess as any).setPermissionCheckHandler(
      (wc: { getURL(): string } | null, permission: string, requestingOrigin: string, details: unknown) => {
        const key = resolveForCheck(permission, details);
        if (!key) return false;
        const origin = safeOrigin(requestingOrigin || (wc ? wc.getURL() : ''));
        const decision = this.#lookup(origin, key);
        if (decision !== null) return decision === 'granted';
        // Нерешённое: «да, стоит попробовать» — только медиа (см. выше), остальное честное «нет»,
        // то есть у сайта то же состояние, что у любого браузера, где человека ещё не спрашивали.
        return key === 'camera' || key === 'microphone';
      },
    );
  }

  /**
   * Спросить человека о том, чего Chromium не спрашивает.
   *
   * ⚠️ Заведено под открытие ссылок в чужих приложениях. Раньше там стоял НАТИВНЫЙ
   * dialog.showMessageBox, и у него было два изъяна сразу: он выглядит системным окном Windows
   * посреди нашего интерфейса, а его галочка «больше не спрашивать» жила в памяти процесса —
   * то есть «запомнить» означало «до перезапуска», хотя человек читает это как «навсегда».
   * Здесь вопрос идёт тем же путём, что вопросы о камере и геопозиции: свой поповер, своё
   * оформление, решение в общей таблице и отзыв в разделе «Разрешения».
   */
  askOwn(origin: string, key: PermKey, requesterWcId: number | null): Promise<boolean> {
    const saved = this.#lookup(origin, key);
    if (saved !== null) return Promise.resolve(saved === 'granted');
    if (!this.#sendRequest) return Promise.resolve(false);
    return new Promise((resolve) => {
      const requestId = randomUUID();
      this.#pending.set(requestId, { origin, keysToStore: [key], callback: resolve });
      this.#sendRequest?.({ requestId, origin, permission: key }, requesterWcId);
    });
  }

  // Вызывается из IPC-хендлера когда пользователь ответил на prompt.
  respond(requestId: string, granted: boolean, remember: boolean): void {
    const entry = this.#pending.get(requestId);
    if (!entry) return;
    this.#pending.delete(requestId);
    entry.callback(granted);
    if (remember) {
      for (const key of entry.keysToStore) {
        this.#store(entry.origin, key, granted ? 'granted' : 'denied');
      }
    }
  }

  // Вопрос снят не человеком, а обстоятельствами (ушли со страницы, закрыли вкладку). Отвечаем
  // «нет» и ничего не запоминаем: молча забыть запись нельзя — колбэк Chromium остался бы
  // неотвеченным навсегда, и сайт ждал бы ответа до конца жизни страницы.
  cancel(requestId: string): void {
    const entry = this.#pending.get(requestId);
    if (!entry) return;
    this.#pending.delete(requestId);
    entry.callback(false);
  }

  // ── Управление из настроек ───────────────────────────────────────────────────

  /** Все сохранённые решения — сгруппировать по сайту умеет уже сам раздел настроек. */
  list(): PermissionRecord[] {
    if (!this.#db) return [];
    try {
      return this.#db.prepare(`
        SELECT origin, permission, decision, updated_at AS updatedAt
        FROM permissions ORDER BY origin ASC, permission ASC
      `).all() as PermissionRecord[];
    } catch (e) {
      console.warn('[Permissions] list error:', (e as Error).message);
      return [];
    }
  }

  /** Поменять решение из настроек — та же запись, что делает ответ на вопрос. */
  set(origin: string, key: PermKey, decision: Decision): void {
    this.#store(origin, key, decision);
  }

  /**
   * Забыть решение — сайт снова СПРОСИТ, а не получит отказ.
   * ⚠️ Это не то же самое, что «запретить»: запрет закрывает вопрос навсегда, забывание
   * возвращает его человеку. Без этой операции ошибочное «нет» было бы необратимым.
   */
  revoke(origin: string, key?: PermKey): void {
    if (!this.#db) return;
    try {
      if (key) this.#db.prepare('DELETE FROM permissions WHERE origin = ? AND permission = ?').run(origin, key);
      else this.#db.prepare('DELETE FROM permissions WHERE origin = ?').run(origin);
    } catch (e) {
      console.warn('[Permissions] revoke error:', (e as Error).message);
    }
  }

  // ── Приватное ────────────────────────────────────────────────────────────────

  #lookup(origin: string, key: string): Decision | null {
    if (!this.#db) return null;
    try {
      const row = this.#db
        .prepare('SELECT decision FROM permissions WHERE origin = ? AND permission = ?')
        .get(origin, key) as { decision: Decision } | undefined;
      return row?.decision ?? null;
    } catch {
      return null;
    }
  }

  #store(origin: string, key: string, decision: Decision): void {
    if (!this.#db) return;
    try {
      this.#db.prepare(`
        INSERT INTO permissions (origin, permission, decision, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(origin, permission) DO UPDATE SET
          decision   = excluded.decision,
          updated_at = excluded.updated_at
      `).run(origin, key, decision, Date.now());
    } catch (e) {
      console.warn('[Permissions] #store error:', (e as Error).message);
    }
  }

  #setup(): void {
    const db = this.#db!;
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS permissions (
        origin      TEXT    NOT NULL,
        permission  TEXT    NOT NULL,
        decision    TEXT    NOT NULL CHECK(decision IN ('granted','denied')),
        updated_at  INTEGER NOT NULL,
        PRIMARY KEY (origin, permission)
      );
    `);
  }
}
