import { app, session as electronSession, ipcMain, net, webContents as electronWebContents } from 'electron';
import type {
  OnBeforeRequestListenerDetails, CallbackResponse,
  OnHeadersReceivedListenerDetails, HeadersReceivedResponse,
  WebContents, IpcMainInvokeEvent,
} from 'electron';
import { ElectronBlocker } from '@ghostery/adblocker-electron';
import type { Request as AdblockRequest } from '@ghostery/adblocker-electron';
import fs from 'node:fs';
import path from 'node:path';
import type { AdBlockState } from '../shared/ipc';
import { normalizeDomain } from '../shared/domain';

type Database = import('better-sqlite3').Database;
type BetterSqlite3 = typeof import('better-sqlite3');

// ── Константы ────────────────────────────────────────────────────────────────

const SETTINGS_DEBOUNCE_MS   = 1_500;
const STATS_PUSH_DEBOUNCE_MS = 1_000;
// Таймаут на сетевое скачивание листов при первом запуске.
// Если кэш engine.bin уже есть — fromPrebuiltAdsAndTracking грузит его без сети
// и завершается до дедлайна; таймер лишь предохраняет от зависания при отсутствии сети.
const FETCH_TIMEOUT_MS = 15_000;

// ── Типы ─────────────────────────────────────────────────────────────────────

interface PersistedSettings {
  enabled: boolean;
  // whitelist здесь больше не пишется (переехал в adblock.sqlite) — поле читается
  // только для миграции уже существующих у пользователя настроек, см. #migrateWhitelistFromJson.
  whitelist?: string[];
}

// ── AdBlockManager ──────────────────────────────────────────────────────────

export class AdBlockManager {
  #blocker: ElectronBlocker | null = null;
  #enabled = true;
  #whitelist = new Set<string>();
  #sessionBlockCount = 0;
  // Разбивка блоков по домену активной страницы — ключ это Electron WebContents.id, НЕ строковый
  // id вкладки из TabManager (у AdBlockManager нет и не должно быть зависимости от TabManager,
  // здесь работаем только с тем, что уже даёт Ghostery Request — request.tabId, см. #recordBlock).
  // "Сброс на новый домен" не пишется отдельным обработчиком навигации (не трогаем hot-path
  // TabManager.did-navigate ради этого) — вместо этого запись самовосстанавливается: и на записи
  // (recordBlock), и на чтении (getBlockedCountForDomain) домен сверяется с ЖИВЫМ webContents.getURL(),
  // если он разошёлся с сохранённым — счётчик для этой вкладки считается нулевым/пересозданным.
  #tabDomainCounts = new Map<number, { domain: string; count: number }>();
  readonly #settingsPath: string;
  readonly #enginePath: string;
  readonly #dbPath: string;
  #db: Database | null = null;
  #settingsTimer: ReturnType<typeof setTimeout> | null = null;
  #statsTimer:    ReturnType<typeof setTimeout> | null = null;
  #onStateChange: ((state: AdBlockState) => void) | null = null;

  constructor() {
    const userData = app.getPath('userData');
    this.#settingsPath = path.join(userData, 'adblock-settings.json');
    this.#dbPath = path.join(userData, 'adblock.sqlite');
    // Prebuilt-бинарник с косметикой. Имя отличается от старого ghostery-engine.bin
    // (тот был без косметики) — при первом запуске скачается свежая версия с CDN.
    this.#enginePath = path.join(userData, 'ghostery-engine-prebuilt.bin');
  }

  // Загружает настройки + строит движок. Вызывается один раз при старте приложения.
  async initialize(onStateChange: (state: AdBlockState) => void): Promise<void> {
    this.#onStateChange = onStateChange;
    this.#loadEnabledFlag();
    this.#openWhitelistDb();

    const blocker = await this.#loadBlocker();

    if (!blocker) {
      // Нет кэша и нет сети — адблок выключен; браузер работает нормально.
      // При следующем запуске с сетью движок скачается и закэшируется.
      console.warn('[AdBlock] движок не загружен — блокировка отключена до следующего старта');
      this.#enabled = false;
      this.#notify();
      return;
    }

    this.#blocker = blocker;

    // Нативный коллбэк Ghostery на каждую заблокированную сеть-заявку — считаем и логируем,
    // чтобы при жалобах на конкретный сайт было видно, что именно резалось.
    blocker.on('request-blocked', (request: AdblockRequest) => {
      const siteCount = this.recordBlock(request);
      console.log(`[AdBlock] blocked ${request.url} (site: ${siteCount?.domain ?? '?'}, на сайте: ${siteCount?.count ?? '?'})`);
    });

    if (this.#enabled) {
      this.#enableBlocking();
      console.log('[AdBlock] Ghostery активен (сеть + косметика)');
    } else {
      console.log('[AdBlock] Ghostery загружен, но блокировка выключена пользователем');
    }
  }

  // ── Публичный API ──────────────────────────────────────────────────────────

  getState(): AdBlockState {
    return {
      enabled: this.#enabled,
      whitelist: [...this.#whitelist],
      sessionBlockCount: this.#sessionBlockCount,
    };
  }

  setEnabled(enabled: boolean): void {
    this.#enabled = enabled;
    if (this.#blocker) {
      if (enabled) {
        this.#enableBlocking();
      } else {
        this.#blocker.disableBlockingInSession(electronSession.defaultSession);
      }
    }
    this.#scheduleSettingsSave();
    this.#notify();
  }

  // Домен нормализуется: strip протокола, www., trailing slash.
  // "www.reddit.com" → "reddit.com"; покрывает reddit.com И все поддомены сайта
  // (проверка идёт по домену СТРАНИЦЫ — см. #isWhitelistedRequest — а не домену запроса).
  addDomain(raw: string): void {
    const domain = normalizeDomain(raw);
    if (!domain) return;
    this.#whitelist.add(domain);
    this.#dbInsertDomain(domain);
    this.#notify();
  }

  removeDomain(domain: string): void {
    this.#whitelist.delete(domain);
    this.#dbDeleteDomain(domain);
    this.#notify();
  }

  // Для будущего поповера «Защита» (тумблер «отключить на этом сайте») — раньше вызывающей
  // стороне приходилось тащить весь AdBlockState.whitelist и проверять .includes() самой
  // (как делает Settings.tsx), здесь достаточно домена. Нормализуем вход тем же normalizeDomain,
  // что и addDomain — можно передать как голый домен, так и полный URL страницы.
  isWhitelisted(raw: string): boolean {
    const domain = normalizeDomain(raw);
    return !!domain && this.#whitelist.has(domain);
  }

  // request необязателен (обратная совместимость сигнатуры на случай прямого вызова без контекста
  // страницы) — без него инкрементится только глобальный счётчик, per-site разбивка не пишется.
  // Возвращает {domain, count} для лога вызывающей стороны — самим методом наружу это не отдаётся.
  recordBlock(request?: AdblockRequest): { domain: string; count: number } | null {
    this.#sessionBlockCount++;
    this.#scheduleStatsPush();
    if (!request) return null;
    return this.#bumpTabDomainCount(request.tabId);
  }

  // Заблокировано на домене X ПРЯМО СЕЙЧАС (суммируется по всем вкладкам, чей ЖИВОЙ домен
  // совпадает с запрошенным, — на случай если сайт открыт в нескольких вкладках одновременно).
  // Каждая запись сверяется с webContents.getURL() на чтении — вкладка, ушедшая с этого домена
  // (навигация/закрытие), в сумму не попадает, даже если ни одного блока на новой странице ещё
  // не было (иначе счётчик показывал бы блоки СТАРОЙ страницы до первого блока на новой).
  getBlockedCountForDomain(raw: string): number {
    const domain = normalizeDomain(raw);
    if (!domain) return 0;
    let total = 0;
    for (const tabId of this.#tabDomainCounts.keys()) {
      const live = this.#liveDomainForTab(tabId);
      if (live === domain) total += this.#tabDomainCounts.get(tabId)!.count;
    }
    return total;
  }

  // Домен, на который СЕЙЧАС смотрит вкладка с данным webContents.id, или null, если вкладка
  // закрыта/выгружена или её URL не резолвится в домен (about:blank, oblako-chrome:// и т.п.).
  #liveDomainForTab(tabId: number): string | null {
    const wc = electronWebContents.fromId(tabId);
    if (!wc || wc.isDestroyed()) return null;
    return normalizeDomain(wc.getURL());
  }

  // Хот-пас (вызывается на каждый заблокированный запрос) — держим дешёвым: один lookup
  // WebContents по id (без IPC), один Map.get/set. Регистрируем once('destroyed'), чтобы запись
  // не копилась в памяти вечно после закрытия вкладки (Map иначе растёт на каждый уникальный
  // webContents.id за всю сессию).
  #bumpTabDomainCount(tabId: number): { domain: string; count: number } | null {
    const domain = this.#liveDomainForTab(tabId);
    if (!domain) return null;
    let entry = this.#tabDomainCounts.get(tabId);
    if (!entry) {
      entry = { domain, count: 0 };
      this.#tabDomainCounts.set(tabId, entry);
      electronWebContents.fromId(tabId)?.once('destroyed', () => this.#tabDomainCounts.delete(tabId));
    } else if (entry.domain !== domain) {
      // Вкладка навигировала на новый домен с прошлого блока — старый счёт для неё не тащим.
      entry.domain = domain;
      entry.count = 0;
    }
    entry.count++;
    return entry;
  }

  // ── Блокировка: свои перехватчики ПЕРЕД движком, whitelist = «не трогать сайт вообще» ──
  //
  // ElectronBlocker.enableBlockingInSession() сам регистрирует session.webRequest.onBeforeRequest
  // и решает блокировку целиком внутри себя — внешний whitelist (напр. через updateFromDiff с
  // правилом-исключением по домену ЗАПРОСА) не спасает: на SPA вроде ChatGPT реальный подгружаемый
  // ресурс часто лежит на ДРУГОМ домене (CDN/API), чем сама страница, и правило `@@||chatgpt.com^`
  // его не покрывает — ложная блокировка ломает приложение целиком.
  //
  // Чиним переопределением: Electron допускает только ОДНОГО слушателя onBeforeRequest/
  // onHeadersReceived на сессию (новая регистрация замещает предыдущую), а ipcMain.handle для
  // косметики нужно снять явно (removeHandler) — регистрируем свои ПОСЛЕ enableBlockingInSession,
  // они вытесняют внутренние. Сначала проверяем домен СТРАНИЦЫ (первую сторону, не домен запроса)
  // по whitelist; если сайт в исключениях — пропускаем БЕЗ обращения к движку вообще (не только
  // сеть, но и CSP-заголовки, и косметические правила/скрипты — «исключение» значит не трогать
  // сайт целиком, а не только не блокировать его запросы). Иначе — тот же details/callback/msg
  // уходит в соответствующий bound-метод blocker.* без изменений, просто позже нашего гейта.
  #enableBlocking(): void {
    const session = electronSession.defaultSession;
    const blocker = this.#blocker!;
    blocker.enableBlockingInSession(session);

    session.webRequest.onBeforeRequest(
      { urls: ['<all_urls>'] },
      (details: OnBeforeRequestListenerDetails, callback: (r: CallbackResponse) => void) => {
        if (this.#isWhitelistedDomain(details.webContents, details.referrer)) { callback({}); return; }
        blocker.onBeforeRequest(details, callback);
      },
    );

    session.webRequest.onHeadersReceived(
      { urls: ['<all_urls>'] },
      (details: OnHeadersReceivedListenerDetails, callback: (r: HeadersReceivedResponse) => void) => {
        if (this.#isWhitelistedDomain(details.webContents, details.referrer)) { callback({}); return; }
        blocker.onHeadersReceived(details, callback);
      },
    );

    // Косметика идёт через IPC (не webRequest) — ipcMain.handle бросает при повторной регистрации
    // на тот же канал без предварительного removeHandler (в отличие от webRequest, который просто
    // молча замещает слушателя).
    ipcMain.removeHandler('@ghostery/adblocker/inject-cosmetic-filters');
    ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', ((event: IpcMainInvokeEvent, url: string, msg?: unknown) => {
      if (this.#isWhitelistedDomain(undefined, url)) return;
      return blocker.onInjectCosmeticFilters(event, url, msg as Parameters<typeof blocker.onInjectCosmeticFilters>[2]);
    }) as typeof blocker.onInjectCosmeticFilters);
  }

  // pageUrl резолвится из webContents.getURL() (надёжнее referrer — тот пуст при строгой
  // Referrer-Policy), с фоллбэком на referrer/url, если webContents недоступен.
  #isWhitelistedDomain(webContents: WebContents | undefined, fallbackUrl: string): boolean {
    if (this.#whitelist.size === 0) return false;
    const pageUrl = webContents?.getURL() || fallbackUrl;
    if (!pageUrl) return false;
    const domain = normalizeDomain(pageUrl);
    return !!domain && this.#whitelist.has(domain);
  }

  // ── Приватные методы ───────────────────────────────────────────────────────

  async #loadBlocker(): Promise<ElectronBlocker | null> {
    try {
      // fromPrebuiltAdsAndTracking: скачивает prebuilt-бинарник с CDN Ghostery
      // (уже скомпилирован с косметикой). При повторных стартах — из кэша (<50ms).
      // net.fetch (модуль Electron), НЕ глобальный fetch() — живой аудит утечек VPN (см. план,
      // шаг 3): глобальный fetch() не уважает session.setProxy(), обновление списков блокировки
      // при включённом VPN продолжало бы идти напрямую в обход туннеля.
      const load = ElectronBlocker.fromPrebuiltAdsAndTracking(
        (url) => net.fetch(url),
        {
          path: this.#enginePath,
          read:  (p) => fs.promises.readFile(p),
          write: (p, data) => fs.promises.writeFile(p, data),
        },
      );

      // Таймаут только для сетевой загрузки: кэш-путь завершается немедленно.
      const deadline = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('adblock download timeout')), FETCH_TIMEOUT_MS),
      );

      const blocker = await Promise.race([load, deadline]);
      console.log('[AdBlock] движок загружен (Ghostery prebuilt, сеть + косметика)');
      return blocker;
    } catch (e) {
      console.warn('[AdBlock] не удалось загрузить движок:', (e as Error).message);
      return null;
    }
  }

  // ── Персистенция: enabled — JSON (как раньше), whitelist — SQLite ──────────

  #loadEnabledFlag(): void {
    try {
      const raw = fs.readFileSync(this.#settingsPath, 'utf8');
      const data = JSON.parse(raw) as unknown;
      if (isValidSettings(data)) {
        this.#enabled = data.enabled;
        // Старый формат хранил whitelist прямо тут — подхватываем в память сейчас,
        // #openWhitelistDb() перенесёт эти домены в SQLite один раз, если она там ещё пуста.
        if (Array.isArray(data.whitelist)) {
          for (const d of data.whitelist) this.#whitelist.add(d);
        }
        return;
      }
    } catch { /* файл отсутствует или битый JSON — стартуем с дефолтом */ }
    this.#enabled = true;
  }

  #openWhitelistDb(): void {
    let Sqlite: BetterSqlite3 | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      Sqlite = require('better-sqlite3') as BetterSqlite3;
    } catch (e) {
      console.warn('[AdBlock] better-sqlite3 недоступен — whitelist не персистируется:', (e as Error).message);
      return;
    }
    try {
      this.#db = new Sqlite(this.#dbPath);
      this.#setupDb();
    } catch (e) {
      console.error('[AdBlock] ошибка открытия whitelist БД:', (e as Error).message);
      try {
        fs.unlinkSync(this.#dbPath);
        this.#db = new Sqlite(this.#dbPath);
        this.#setupDb();
        console.log('[AdBlock] whitelist БД пересоздана');
      } catch (e2) {
        console.error('[AdBlock] пересоздание whitelist БД провалилось:', (e2 as Error).message);
        this.#db = null;
        return;
      }
    }

    const fromDb = this.#dbLoadDomains();
    if (fromDb.length > 0) {
      // В SQLite уже есть данные — она источник истины, JSON-остатки (если есть) игнорируем.
      this.#whitelist = new Set(fromDb);
    } else if (this.#whitelist.size > 0) {
      // Миграция один раз: домены были только в старом JSON — переносим в SQLite и БОЛЬШЕ
      // не пишем whitelist в JSON (см. #writeSettings).
      for (const d of this.#whitelist) this.#dbInsertDomain(d);
      console.log(`[AdBlock] whitelist мигрирован из JSON в SQLite (${this.#whitelist.size} записей)`);
    }
  }

  #setupDb(): void {
    const db = this.#db!;
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS whitelist (
        domain     TEXT    PRIMARY KEY,
        added_at   INTEGER NOT NULL
      );
    `);
  }

  #dbLoadDomains(): string[] {
    if (!this.#db) return [];
    try {
      const rows = this.#db.prepare('SELECT domain FROM whitelist').all() as { domain: string }[];
      return rows.map((r) => r.domain);
    } catch (e) {
      console.warn('[AdBlock] #dbLoadDomains error:', (e as Error).message);
      return [];
    }
  }

  #dbInsertDomain(domain: string): void {
    if (!this.#db) return;
    try {
      this.#db.prepare('INSERT OR IGNORE INTO whitelist (domain, added_at) VALUES (?, ?)').run(domain, Date.now());
    } catch (e) {
      console.warn('[AdBlock] #dbInsertDomain error:', (e as Error).message);
    }
  }

  #dbDeleteDomain(domain: string): void {
    if (!this.#db) return;
    try {
      this.#db.prepare('DELETE FROM whitelist WHERE domain = ?').run(domain);
    } catch (e) {
      console.warn('[AdBlock] #dbDeleteDomain error:', (e as Error).message);
    }
  }

  #scheduleSettingsSave(): void {
    if (this.#settingsTimer !== null) clearTimeout(this.#settingsTimer);
    this.#settingsTimer = setTimeout(() => {
      this.#settingsTimer = null;
      this.#writeSettings();
    }, SETTINGS_DEBOUNCE_MS);
  }

  #writeSettings(): void {
    // whitelist сюда больше не пишется — только enabled (whitelist живёт в adblock.sqlite).
    const data: PersistedSettings = { enabled: this.#enabled };
    const tmpPath = this.#settingsPath + '.tmp';
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.#settingsPath);
    } catch { /* ошибка диска — следующий debounce попробует снова */ }
  }

  #scheduleStatsPush(): void {
    if (this.#statsTimer !== null) return;
    this.#statsTimer = setTimeout(() => {
      this.#statsTimer = null;
      this.#notify();
    }, STATS_PUSH_DEBOUNCE_MS);
  }

  #notify(): void {
    this.#onStateChange?.(this.getState());
  }
}

// ── Хелперы ───────────────────────────────────────────────────────────────────

function isValidSettings(v: unknown): v is PersistedSettings {
  if (typeof v !== 'object' || v === null) return false;
  const d = v as Record<string, unknown>;
  return typeof d['enabled'] === 'boolean';
}
