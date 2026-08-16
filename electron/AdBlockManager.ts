import { app, session as electronSession, ipcMain, net, webContents as electronWebContents } from 'electron';
import type {
  OnBeforeRequestListenerDetails, CallbackResponse,
  OnHeadersReceivedListenerDetails, HeadersReceivedResponse,
  WebContents, IpcMainInvokeEvent, Session,
} from 'electron';
import { ElectronBlocker } from '@ghostery/adblocker-electron';
import type { Request as AdblockRequest } from '@ghostery/adblocker-electron';
// Тот же парсер hostname/domain, что внутри adblocker-electron (его прямая зависимость,
// зафиксирована и у нас в package.json) — нужен нашей копии инъекции косметики, см.
// #injectCosmetics: параметры getCosmeticsFilters должны совпадать с оригиналом 1-в-1.
import { parse as parseTld } from 'tldts-experimental';
import fs from 'node:fs';
import path from 'node:path';
import { IPC } from '../shared/ipc';
import type { AdBlockState } from '../shared/ipc';
import { joinScriptlets } from '../shared/scriptletBundle';
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
// Возраст кэша движка, после которого листы протухли и обновляются В ФОНЕ при старте.
// До этого фикса кэш не обновлялся НИКОГДА (fromCached: файл прочитался — сеть не трогается),
// движок замерзал датой первого запуска — а вместе с ним uBO quick-fixes/unbreak, листы,
// которыми апстрим оперативно чинит поломанные фильтрами сайты (кейс ChatGPT/Pinterest).
// 3 дня — баланс: и YouTube-фильтры (меняются часто), и ~7МБ трафика не на каждый старт.
const ENGINE_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
// Таймаут фонового обновления — щедрее стартового: качается ~десяток листов + resources.json,
// и никого не блокирует (старт уже прошёл на кэшовом движке).
const REFRESH_TIMEOUT_MS = 60_000;

// ── Типы ─────────────────────────────────────────────────────────────────────

// Форма msg DOM-обновлений от preload-скрипта Ghostery (см. #injectCosmetics) — библиотека
// свой тип наружу не экспортирует, зеркалим используемые поля.
interface CosmeticsUpdateMsg {
  classes?: string[];
  hrefs?: string[];
  ids?: string[];
  lifecycle?: string;
}

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
  // Доп. сессии, на которые тоже распространяется блокировка (сейчас — инкогнито-сессия, см.
  // attachSession). defaultSession обрабатывается всегда отдельно; здесь только «прочие».
  #extraSessions = new Set<Session>();
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
    // ⚠️ Регистрируем СРАЗУ, не после загрузки движка: канал синхронный, и гостевая страница на
    // него ЖДЁТ. Пока движок не готов (или выключен) — отвечаем null мгновенно, и страница идёт
    // дальше без задержки. Слушатель, появившийся позже первой навигации, означал бы ожидание
    // рендерера на пустом месте.
    this.registerBootChannel();
  }

  // Лежит ли уже готовый движок на диске. Нужно main-процессу, чтобы решить, ЖДАТЬ ли
  // инициализацию перед созданием окна: с кэшем она стоит десятки миллисекунд (десериализация
  // локального файла), без кэша — сетевая загрузка с CDN вплоть до FETCH_TIMEOUT_MS. Синхронный
  // existsSync здесь уместен: один вызов на весь запуск, до появления окна, ничего не блокирует.
  hasCachedEngine(): boolean {
    try { return fs.existsSync(this.#enginePath); } catch { return false; }
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
    this.#attachBlockerEvents(blocker);

    if (this.#enabled) {
      this.#enableBlocking();
      console.log('[AdBlock] Ghostery активен (сеть + косметика)');
    } else {
      console.log('[AdBlock] Ghostery загружен, но блокировка выключена пользователем');
    }

    // Fire-and-forget: старт не ждёт, при протухшем кэше свежий движок подменится горячо.
    void this.#refreshEngineIfStale();
  }

  // Нативный коллбэк Ghostery на каждую заблокированную сеть-заявку — считаем и логируем,
  // чтобы при жалобах на конкретный сайт было видно, что именно резалось. Вынесено из
  // initialize: горячая подмена движка (#swapBlocker) должна вешать тот же слушатель на
  // новый инстанс.
  #attachBlockerEvents(blocker: ElectronBlocker): void {
    blocker.on('request-blocked', (request: AdblockRequest) => {
      const siteCount = this.recordBlock(request);
      console.log(`[AdBlock] blocked ${request.url} (site: ${siteCount?.domain ?? '?'}, на сайте: ${siteCount?.count ?? '?'})`);
    });
  }

  // Фоновое обновление листов: кэш-файл движка старше ENGINE_MAX_AGE_MS → скачиваем свежий
  // движок МИМО кэша (fromCached с кэшем никогда не рефетчит — причина бага), пишем на диск
  // атомарно и горячо подменяем текущий. При сбое сети остаёмся на прежнем движке — следующая
  // попытка на следующем старте.
  async #refreshEngineIfStale(): Promise<void> {
    if (!this.#blocker) return;
    let ageMs: number;
    try {
      ageMs = Date.now() - fs.statSync(this.#enginePath).mtimeMs;
    } catch {
      return; // файла нет — движок только что скачан свежим, кэш запишется сам
    }
    if (ageMs < ENGINE_MAX_AGE_MS) return;
    console.log(`[AdBlock] кэшу листов ~${Math.round(ageMs / 86_400_000)} дн. — фоновое обновление…`);
    try {
      const deadline = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('adblock refresh timeout')), REFRESH_TIMEOUT_MS),
      );
      const fresh = await Promise.race([
        ElectronBlocker.fromPrebuiltAdsAndTracking((url) => net.fetch(url)),
        deadline,
      ]);
      // tmp+rename — битый недописанный кэш при падении на середине не должен подменить целый
      // (deserialize его отвергнет и перекачает, но это лишний сетевой старт).
      const tmp = this.#enginePath + '.tmp';
      await fs.promises.writeFile(tmp, Buffer.from(fresh.serialize()));
      await fs.promises.rename(tmp, this.#enginePath);
      this.#swapBlocker(fresh);
      console.log('[AdBlock] листы обновлены и применены (горячая подмена движка)');
    } catch (e) {
      console.warn('[AdBlock] фоновое обновление листов не удалось (остаёмся на кэше):', (e as Error).message);
    }
  }

  // Горячая подмена движка. Порядок важен: у старого СНАЧАЛА снимается его session-обвязка
  // (disableBlockingInSession удаляет в т.ч. preload-скрипт косметики этого инстанса — без
  // этого preload'ы копились бы по одному на каждую подмену), и только потом новый включается
  // тем же #enableBlocking, что и при старте — с нашим whitelist-гейтом поверх. Всё синхронно,
  // окна «без блокировки» между disable и enable нет.
  #swapBlocker(fresh: ElectronBlocker): void {
    const session = electronSession.defaultSession;
    const old = this.#blocker;
    // Полная обвязка была только у defaultSession — её и снимаем (косметический preload/хендлеры).
    // Инкогнито-сессиям хватит переустановки webRequest-гейтов в #enableBlocking ниже (замещают
    // слушателя, ссылку на старый blocker не держат после этого).
    if (old !== null && old.isBlockingEnabled(session)) old.disableBlockingInSession(session);
    this.#blocker = fresh;
    this.#attachBlockerEvents(fresh);
    if (this.#enabled) this.#enableBlocking();
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
        // Инкогнито включалось только сетевыми гейтами (не enableBlockingInSession) — снимаем их же.
        for (const s of this.#extraSessions) this.#disableNetworkBlocking(s);
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
    // defaultSession — полный движок (сеть + косметика через глобальные ipcMain-хендлеры + preload,
    // которые ставит blocker.enableBlockingInSession). Доп. сессии (инкогнито) — только СЕТЕВАЯ
    // блокировка (наши webRequest-гейты): enableBlockingInSession нельзя звать второй раз — она
    // регистрирует несколько глобальных ipcMain.handle и бросает «second handler». Сеть — это
    // главная, приватностно-значимая часть (блок запросов к трекерам); косметика в инкогнито не
    // применяется (её глобальные хендлеры и так живут от defaultSession, но per-session preload там
    // не ставится — приемлемый компромисс).
    this.#enableFullBlocking(electronSession.defaultSession);
    for (const s of this.#extraSessions) this.#enableNetworkBlocking(s);
  }

  // Полная блокировка (движок + косметика) — только для defaultSession.
  #enableFullBlocking(session: Session): void {
    const blocker = this.#blocker!;
    blocker.enableBlockingInSession(session);
    this.#wireNetworkGates(session);

    // Косметика идёт через IPC (не webRequest) — ipcMain.handle бросает при повторной регистрации
    // без предварительного removeHandler. Вместо blocker.onInjectCosmeticFilters — своя копия
    // #injectCosmetics (single executeJavaScript, см. метод). Хендлер глобальный, обслуживает все сессии.
    ipcMain.removeHandler('@ghostery/adblocker/inject-cosmetic-filters');
    ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', (event: IpcMainInvokeEvent, url: string, msg?: unknown) => {
      if (this.#isWhitelistedDomain(undefined, url)) return;
      this.#injectCosmetics(event, url, msg as CosmeticsUpdateMsg | undefined);
    });
  }

  // ── Скриптлеты ДО скриптов страницы (см. IPC.ADBLOCK_BOOT_SCRIPTLETS) ────────────────────────
  //
  // ⚠️ Зачем понадобился синхронный путь. Штатная схема Ghostery: preload на document_start
  // асинхронно зовёт main, main отвечает executeJavaScript обратно. Два асинхронных перехода —
  // и скриптлеты доезжают ПОЗЖЕ инлайн-скриптов страницы, всегда. Баннеры при этом режутся
  // (сетевой фильтр webRequest синхронный), отсюда обманчивое «списки стоят, а реклама в видео
  // играет»: на YouTube ytInitialPlayerResponse с adPlacements ставится ранним инлайн-скриптом,
  // а set-constant/json-prune обязаны успеть ДО него. Замерено стендом: scriptletWasFirst=false.
  //
  // Здесь отдаётся ТОЛЬКО код скриптлетов. Стили и DOM-обновления косметики остаются на
  // асинхронном пути (#injectCosmetics): им document_start не нужен, и синхронить их — чистый
  // вред, MutationObserver дёргается на каждое изменение страницы.
  registerBootChannel(): void {
    ipcMain.removeAllListeners(IPC.ADBLOCK_BOOT_SCRIPTLETS);
    ipcMain.on(IPC.ADBLOCK_BOOT_SCRIPTLETS, (event, url: string) => {
      event.returnValue = this.#bootScriptlets(event.frameId, event.processId, url);
    });
  }

  #bootScriptlets(frameId: number, processId: number, url: string): string | null {
    try {
      const blocker = this.#blocker;
      if (!blocker || !this.#enabled) return null;
      if (typeof url !== 'string' || !/^https?:/i.test(url)) return null;
      if (this.#isWhitelistedDomain(undefined, url)) return null;
      const parsed = parseTld(url);
      // Параметры — те же, что у первичного вызова в #injectCosmetics: это и есть первичный вызов,
      // просто пришедший раньше и синхронно.
      const { active, scripts } = blocker.getCosmeticsFilters({
        domain: parsed.domain ?? '',
        hostname: parsed.hostname ?? '',
        url,
        getBaseRules: true,
        getInjectionRules: true,
        getExtendedRules: false,
        getRulesFromHostname: true,
        getRulesFromDOM: false,
        callerContext: { frameId, processId },
      });
      if (active === false || scripts.length === 0) return null;
      // Диагностика по требованию: OBLAKO_ADBLOCK_DEBUG=1 npm start. Постоянно не логируем —
      // это путь загрузки КАЖДОЙ страницы, и в проде такой лог был бы потоком строк с адресами.
      if (process.env.OBLAKO_ADBLOCK_DEBUG) {
        console.log(`[AdBlock] скриптлетов синхронно: ${scripts.length} → ${parsed.hostname ?? '?'}`);
      }
      return joinScriptlets(scripts);
    } catch (e) {
      // Молча: сбой адблока не повод ломать загрузку страницы, а рендерер ЖДЁТ этого ответа.
      console.warn('[AdBlock] синхронная выдача скриптлетов не удалась:', (e as Error).message);
      return null;
    }
  }

  // Только сетевая блокировка на сессии (для инкогнито) — без enableBlockingInSession и его
  // глобальных хендлеров. blocker.onBeforeRequest/onHeadersReceived решают блок по тем же листам.
  #enableNetworkBlocking(session: Session): void {
    this.#wireNetworkGates(session);
  }

  // Наши whitelist-гейты поверх сетевых решений движка (webRequest per-session, замещает слушателя).
  #wireNetworkGates(session: Session): void {
    const blocker = this.#blocker!;
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
  }

  // Снимает наши сетевые гейты с сессии (для инкогнито при выключении адблока).
  #disableNetworkBlocking(session: Session): void {
    session.webRequest.onBeforeRequest(null);
    session.webRequest.onHeadersReceived(null);
  }

  // Распространяет сетевую блокировку на дополнительную сессию (инкогнито). Идемпотентно.
  attachSession(session: Session): void {
    if (this.#extraSessions.has(session)) return;
    this.#extraSessions.add(session);
    if (this.#enabled && this.#blocker) this.#enableNetworkBlocking(session);
  }

  // Инъекция косметики/скриптлетов — копия оригинального adblocker-electron
  // onInjectCosmeticFilters (dist/commonjs/index.js, v2.18.0) с ЕДИНСТВЕННЫМ отличием: все
  // скриптлеты страницы выполняются ОДНИМ executeJavaScript, а не каждый отдельно.
  // Причина: Ghostery рендерит каждый скриптлет самодостаточным скриптом со СВОЕЙ копией
  // uBO-обвязки (proxyApplyFn и др.). Два скриптлета, оборачивающих одну и ту же функцию
  // (живой кейс — chatgpt.com: два prevent-fetch на window.fetch из uBO privacy-листа),
  // из РАЗНЫХ копий обвязки зацикливаются друг в друге («Maximum call stack size exceeded»)
  // и кладут SPA целиком. В одном скрипте объявления функций хоистятся в общий скоуп —
  // обвязка остаётся одна, обёртки строятся цепочкой, ровно как в самом uBlock Origin.
  // Параметры getCosmeticsFilters — 1-в-1 с оригиналом, менять их отдельно от апгрейда
  // библиотеки нельзя.
  #injectCosmetics(event: IpcMainInvokeEvent, url: string, msg?: CosmeticsUpdateMsg): void {
    const blocker = this.#blocker;
    if (!blocker) return;
    const parsed = parseTld(url);
    const hostname = parsed.hostname ?? '';
    const domain = parsed.domain ?? '';
    // msg отсутствует у первичного вызова из preload и присутствует у DOM-обновлений.
    const isFirstRun = msg === undefined;
    const { active, styles, scripts } = blocker.getCosmeticsFilters({
      domain,
      hostname,
      url,
      classes: msg?.classes,
      hrefs: msg?.hrefs,
      ids: msg?.ids,
      getBaseRules: isFirstRun,
      getInjectionRules: isFirstRun,
      getExtendedRules: false,
      getRulesFromHostname: isFirstRun,
      getRulesFromDOM: !isFirstRun,
      callerContext: {
        frameId: event.frameId,
        processId: event.processId,
        lifecycle: msg?.lifecycle,
      },
    });
    if (active === false) return;
    if (styles.length > 0) {
      event.sender.insertCSS(styles, { cssOrigin: 'user' });
    }
    // ⚠️ Скриптлеты отсюда НЕ инжектятся вовсе — их выполняет синхронный путь (#bootScriptlets),
    // до скриптов страницы. Здесь остаются только стили.
    //
    // Раньше стояла пометка «этот адрес уже отдан синхронно, пропусти» — и она проигрывала гонку:
    // preload Ghostery успевает отправить свой асинхронный invoke РАНЬШЕ, чем наш sendSync
    // поставит пометку, поэтому скриптлеты уходили на страницу ДВАЖДЫ. Живое последствие
    // (chatgpt.com): два prevent-fetch на window.fetch из РАЗНЫХ копий обвязки uBO зацикливаются
    // друг в друге, «Maximum call stack size exceeded», SPA не открывается — ровно тот случай,
    // ради которого скриптлеты и склеиваются в один скрипт (см. шапку метода). Лечилось
    // перезагрузкой, потому что при ней порядок мог сложиться иначе, — подпись гонки.
    // Проверкой порядка её не починить: гарантий, кто из двух preload'ов отработает первым, нет.
    // Поэтому владелец у скриптлетов ровно один.
    //
    // Цена: вью без нашего content-preload (OAuth-попапы, см. TabManager::setWindowOpenHandler)
    // скриптлетов не получат. Косметика там и не нужна — это окна входа, живущие секунды.
    void scripts;
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
