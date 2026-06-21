import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { AdBlockState } from '../shared/ipc';

// ── Константы ────────────────────────────────────────────────────────────────

// Максимальное кол-во глобальных (не привязанных к домену) правил.
// Защита от деградации производительности: остальные правила берутся только из доменного индекса.
const GLOBAL_RULE_LIMIT = 3_000;
const SETTINGS_DEBOUNCE_MS = 1_500;
const STATS_PUSH_DEBOUNCE_MS = 1_000;

// ── Встроенный fallback-список ────────────────────────────────────────────────
// Покрывает крупнейшие рекламные сети и трекеры — достаточно для базовой блокировки.
// Для полного EasyList/EasyPrivacy запустите: npm run download-filters
const INLINE_RULES = `
||googlesyndication.com^
||doubleclick.net^
||googleadservices.com^
||google-analytics.com^
||googletagmanager.com^
||googletagservices.com^
||adservice.google.com^
||pagead2.googlesyndication.com^
||adnxs.com^
||appnexus.com^
||adsrvr.org^
||amazon-adsystem.com^
||ads.amazon.com^
||aps.amazon.com^
||scorecardresearch.com^
||outbrain.com^
||outbrainimg.com^
||taboola.com^
||trc.taboola.com^
||rubiconproject.com^
||openx.net^
||pubmatic.com^
||criteo.com^
||criteo.net^
||static.criteo.net^
||gum.criteo.com^
||moatads.com^
||moatpixel.com^
||hotjar.com^
||mixpanel.com^
||segment.io^
||cdn.segment.com^
||advertising.com^
||media.net^
||revcontent.com^
||sharethrough.com^
||spotxchange.com^
||yieldmo.com^
||33across.com^
||lijit.com^
||triplelift.com^
||indexexchange.com^
||casalemedia.com^
||smartadserver.com^
||sovrn.com^
||sonobi.com^
||quantserve.com^
||bidswitch.net^
||justpremium.com^
||smaato.net^
||buzzoola.com^
||ssp.rambler.ru^
||ads.rambler.ru^
||rutarget.ru^
||smi2.net^
||smi2.ru^
||relap.io^
||adriver.ru^
||begun.ru^
||betweendigital.com^
||cxense.com^
||bidvol.com^
||nativeroll.tv^
||yandex.ru/an^
||an.yandex.ru^
||mc.yandex.ru^
||mc.admetrica.ru^
||counter.yadro.ru^
||top-fwz1.mail.ru^
||top.mail.ru^
||radar.mail.ru^
||rb.mail.ru^
||aflt.yandex.ru^
||awaps.yandex.net^
||awaps.yandex.ru^
||dsp.yandex.ru^
||bs.serving-sys.com^
||s.adroll.com^
||d.adroll.com^
||t.adroll.com^
||t.mookie1.com^
||ads.yahoo.com^
||analytics.yahoo.com^
||connect.facebook.net^
||staticxx.facebook.com^
||tr.snapchat.com^
||analytics.tiktok.com^
||log.byteoversea.com^
||adform.net^
||adtelligent.com^
||bluekai.com^
||exelator.com^
||mathtag.com^
||eyeota.net^
||ads.linkedin.com^
||px.ads.linkedin.com^
||platform.twitter.com^
||sspgw.mail.ru^
||direct.adform.net^
||rftp.com^
||rtrk.net^
`.trim();

// ── Типы ─────────────────────────────────────────────────────────────────────

interface FilterIndex {
  blockByDomain:  Map<string, RegExp[]>;  // домен → RegExp[] (domain-map индекс)
  blockGlobal:    RegExp[];               // правила без привязки к домену (ограничены GLOBAL_RULE_LIMIT)
  exceptByDomain: Map<string, RegExp[]>;  // @@ исключения EasyList по домену
  exceptGlobal:   RegExp[];               // @@ глобальные исключения EasyList
}

interface PersistedSettings {
  enabled: boolean;
  whitelist: string[];
}

// ── Парсинг правил ───────────────────────────────────────────────────────────

// Извлекает hostname из domain-anchored правила вида ||hostname^ или ||hostname/path
function extractRuleDomain(rule: string): string | null {
  if (!rule.startsWith('||')) return null;
  const m = rule.slice(2).match(/^([a-z0-9._-]+?)(?:[/^]|$)/i);
  return m ? m[1].toLowerCase() : null;
}

// Конвертирует EasyList-правило в RegExp.
// Возвращает null если правило некорректно или слишком сложно для v1.
function ruleToRegExp(rule: string): RegExp | null {
  let r = rule.trim();
  if (!r || r.length < 3) return null;

  let domainAnchor = false;
  let startAnchor  = false;
  let endAnchor    = false;

  if (r.startsWith('||')) { domainAnchor = true; r = r.slice(2); }
  else if (r.startsWith('|')) { startAnchor = true; r = r.slice(1); }
  if (r.endsWith('|')) { endAnchor = true; r = r.slice(0, -1); }

  // Экранируем спецсимволы RegExp, кроме * и ^ (обрабатываем отдельно)
  r = r.replace(/[.+?{}[\]()\\\-]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\^/g, '(?:[/?#&=]|$)');

  if (domainAnchor) {
    // ||domain^ → матчим домен и его поддомены
    r = '(?:https?://|wss?://)?(?:[a-z0-9-]+\\.)*' + r;
  } else if (startAnchor) {
    r = '^' + r;
  }
  if (endAnchor) r += '$';

  try { return new RegExp(r, 'i'); }
  catch { return null; }
}

// Парсит один или несколько фильтр-листов в единый индекс.
function parseFilterLists(...texts: string[]): FilterIndex {
  const blockByDomain  = new Map<string, RegExp[]>();
  const blockGlobal:    RegExp[] = [];
  const exceptByDomain = new Map<string, RegExp[]>();
  const exceptGlobal:   RegExp[] = [];
  let globalCount = 0;

  for (const text of texts) {
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();

      // Пропускаем: пустые строки, комментарии, заголовки [...]
      if (!line || line.startsWith('!') || line.startsWith('[')) continue;

      // CSS/element-правила (##, #@#, #?#) — скрытие DOM, не сетевые запросы
      if (line.includes('##') || line.includes('#@#') || line.includes('#?#')) continue;

      const isException = line.startsWith('@@');
      let rule = isException ? line.slice(2) : line;

      // Обрабатываем опции ($script, $image и т.д.)
      // Опасные опции: $elemhide/$document/$popup — могут блокировать не то
      const optIdx = rule.lastIndexOf('$');
      if (optIdx !== -1) {
        const opts = rule.slice(optIdx + 1).split(',');
        const dangerous = ['elemhide', 'document', 'popup', 'genericblock', 'generichide', 'csp'];
        if (opts.some((o) => dangerous.includes(o.split('=')[0] ?? ''))) continue;
        rule = rule.slice(0, optIdx);
      }
      if (!rule) continue;

      const re = ruleToRegExp(rule);
      if (!re) continue;

      const domain = extractRuleDomain(rule);

      if (isException) {
        if (domain) {
          const arr = exceptByDomain.get(domain) ?? [];
          arr.push(re);
          exceptByDomain.set(domain, arr);
        } else {
          exceptGlobal.push(re);
        }
      } else {
        if (domain) {
          const arr = blockByDomain.get(domain) ?? [];
          arr.push(re);
          blockByDomain.set(domain, arr);
        } else if (globalCount < GLOBAL_RULE_LIMIT) {
          blockGlobal.push(re);
          globalCount++;
        }
      }
    }
  }

  return { blockByDomain, blockGlobal, exceptByDomain, exceptGlobal };
}

// ── AdBlockManager ──────────────────────────────────────────────────────────

export class AdBlockManager {
  #enabled = true;
  #whitelist = new Set<string>();
  #sessionBlockCount = 0;
  #index: FilterIndex | null = null;
  readonly #settingsPath: string;
  readonly #listsDir: string;
  #settingsTimer: ReturnType<typeof setTimeout> | null = null;
  #statsTimer: ReturnType<typeof setTimeout> | null = null;
  #onStateChange: ((state: AdBlockState) => void) | null = null;

  constructor() {
    const userData = app.getPath('userData');
    this.#settingsPath = path.join(userData, 'adblock-settings.json');

    // app.getAppPath() = корень проекта (в dev и в собранном виде без упаковки).
    // При упаковке electron-builder → проверить путь к resources/ в конфиге packager.
    this.#listsDir = path.join(app.getAppPath(), 'resources');
  }

  // Загружает настройки + строит индекс. Вызывается один раз при старте.
  async initialize(onStateChange: (state: AdBlockState) => void): Promise<void> {
    this.#onStateChange = onStateChange;
    this.#loadSettings();
    await this.#buildIndex();
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
    this.#scheduleSettingsSave();
    this.#notify();
  }

  // Домен нормализуется: strip протокола, www., trailing slash.
  // "www.reddit.com" → "reddit.com"; покрывает reddit.com И все поддомены.
  addDomain(raw: string): void {
    const domain = normalizeDomain(raw);
    if (!domain) return;
    this.#whitelist.add(domain);
    this.#scheduleSettingsSave();
    this.#notify();
  }

  removeDomain(domain: string): void {
    this.#whitelist.delete(domain);
    this.#scheduleSettingsSave();
    this.#notify();
  }

  // Вызывается из webRequest.onBeforeRequest на КАЖДЫЙ запрос.
  // Должен быть максимально быстрым: 2–4 Map.get() + ~20 RegExp.test().
  shouldBlock(url: string, referrer?: string): boolean {
    if (!this.#enabled || !this.#index) return false;

    let hostname: string;
    try { hostname = new URL(url).hostname.toLowerCase(); }
    catch { return false; }

    // Whitelist: сам запрашиваемый домен
    if (this.#isWhitelisted(hostname)) return false;

    // Whitelist: страница-источник запроса (referrer)
    if (referrer) {
      try {
        const refHost = new URL(referrer).hostname.toLowerCase();
        if (this.#isWhitelisted(refHost)) return false;
      } catch { /* нет referrer — игнорируем */ }
    }

    // Проверяем доменный индекс (быстро: O(1) lookup на уровень домена)
    for (const re of this.#getDomainRules(this.#index.blockByDomain, hostname)) {
      if (re.test(url)) {
        return !this.#isExcepted(url, hostname);
      }
    }

    // Глобальные правила (медленнее, но ограничены GLOBAL_RULE_LIMIT)
    for (const re of this.#index.blockGlobal) {
      if (re.test(url)) {
        return !this.#isExcepted(url, hostname);
      }
    }

    return false;
  }

  recordBlock(): void {
    this.#sessionBlockCount++;
    this.#scheduleStatsPush();
  }

  // ── Приватные методы ───────────────────────────────────────────────────────

  // Проверяет, покрыт ли hostname пользовательским whitelist.
  // Домен "example.com" покрывает "example.com" и "*.example.com" (www, m, api и т.д.).
  #isWhitelisted(hostname: string): boolean {
    for (const domain of this.#whitelist) {
      if (hostname === domain || hostname.endsWith('.' + domain)) return true;
    }
    return false;
  }

  // Проверяет @@ исключения EasyList для данного url/hostname.
  #isExcepted(url: string, hostname: string): boolean {
    if (!this.#index) return false;
    for (const re of this.#getDomainRules(this.#index.exceptByDomain, hostname)) {
      if (re.test(url)) return true;
    }
    for (const re of this.#index.exceptGlobal) {
      if (re.test(url)) return true;
    }
    return false;
  }

  // Итерирует правила из доменного Map для данного hostname и всех родительских доменов.
  // Пример: "ads.googlesyndication.com" → проверяет "ads.googlesyndication.com", "googlesyndication.com".
  #getDomainRules(map: Map<string, RegExp[]>, hostname: string): RegExp[] {
    const result: RegExp[] = [];
    const parts = hostname.split('.');
    for (let i = 0; i <= parts.length - 2; i++) {
      const domain = parts.slice(i).join('.');
      const rules = map.get(domain);
      if (rules) result.push(...rules);
    }
    return result;
  }

  // ── Инициализация индекса ──────────────────────────────────────────────────

  async #buildIndex(): Promise<void> {
    const texts: string[] = [];

    // Пробуем загрузить полные листы из resources/
    for (const name of ['easylist.txt', 'easyprivacy.txt']) {
      const filePath = path.join(this.#listsDir, name);
      try {
        texts.push(fs.readFileSync(filePath, 'utf8'));
      } catch {
        // Файл не найден — пропускаем. Если ни один не найден, используем fallback.
      }
    }

    if (texts.length === 0) {
      console.warn('[AdBlock] Фильтр-листы не найдены в resources/. Используется встроенный fallback-список.');
      console.warn('[AdBlock] Для полной блокировки запустите: npm run download-filters');
      texts.push(INLINE_RULES);
    } else {
      console.log(`[AdBlock] Загружено фильтр-листов: ${texts.length} (из ${this.#listsDir})`);
    }

    // parseFilterLists синхронный но тяжёлый при полных листах — откладываем в макро-таску
    // чтобы не блокировать создание окна.
    await new Promise<void>((resolve) => {
      setImmediate(() => {
        this.#index = parseFilterLists(...texts);
        const domainCount  = this.#index.blockByDomain.size;
        const globalCount  = this.#index.blockGlobal.length;
        console.log(`[AdBlock] Индекс построен: ${domainCount} доменов, ${globalCount} глобальных правил`);
        resolve();
      });
    });
  }

  // ── Персистенция настроек ─────────────────────────────────────────────────

  #loadSettings(): void {
    try {
      const raw = fs.readFileSync(this.#settingsPath, 'utf8');
      const data = JSON.parse(raw) as unknown;
      if (isValidSettings(data)) {
        this.#enabled  = data.enabled;
        this.#whitelist = new Set(data.whitelist);
        return;
      }
    } catch { /* файл отсутствует, битый JSON или ошибка FS — стартуем с дефолтом */ }
    // Дефолт: блокировка включена, whitelist пуст
    this.#enabled  = true;
    this.#whitelist = new Set();
  }

  #scheduleSettingsSave(): void {
    if (this.#settingsTimer !== null) clearTimeout(this.#settingsTimer);
    this.#settingsTimer = setTimeout(() => {
      this.#settingsTimer = null;
      this.#writeSettings();
    }, SETTINGS_DEBOUNCE_MS);
  }

  #writeSettings(): void {
    const data: PersistedSettings = {
      enabled: this.#enabled,
      whitelist: [...this.#whitelist],
    };
    const tmpPath = this.#settingsPath + '.tmp';
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.#settingsPath);
    } catch { /* ошибка диска — следующий debounce попробует снова */ }
  }

  // Debounced push статистики — не чаще раза в секунду (блоков может быть сотни в минуту)
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

// ── Валидация и нормализация ──────────────────────────────────────────────────

function isValidSettings(v: unknown): v is PersistedSettings {
  if (typeof v !== 'object' || v === null) return false;
  const d = v as Record<string, unknown>;
  return typeof d['enabled'] === 'boolean' &&
    Array.isArray(d['whitelist']) &&
    (d['whitelist'] as unknown[]).every((x) => typeof x === 'string');
}

// Нормализует то, что ввёл пользователь, до голого hostname.
// "https://www.Reddit.com/r/..." → "reddit.com"
export function normalizeDomain(raw: string): string | null {
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  // Добавляем схему если нет — иначе new URL() падает
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    let host = new URL(s).hostname;
    if (host.startsWith('www.')) host = host.slice(4);
    return host || null;
  } catch { return null; }
}
