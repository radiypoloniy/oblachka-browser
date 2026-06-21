import { app, session as electronSession } from 'electron';
import { ElectronBlocker, adsAndTrackingLists } from '@ghostery/adblocker-electron';
import fs from 'node:fs';
import path from 'node:path';
import type { AdBlockState } from '../shared/ipc';

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
  whitelist: string[];
}

// ── AdBlockManager ──────────────────────────────────────────────────────────

export class AdBlockManager {
  #blocker: ElectronBlocker | null = null;
  #enabled = true;
  #whitelist = new Set<string>();
  #sessionBlockCount = 0;
  readonly #settingsPath: string;
  readonly #enginePath: string;
  #settingsTimer: ReturnType<typeof setTimeout> | null = null;
  #statsTimer:    ReturnType<typeof setTimeout> | null = null;
  #onStateChange: ((state: AdBlockState) => void) | null = null;

  constructor() {
    const userData = app.getPath('userData');
    this.#settingsPath = path.join(userData, 'adblock-settings.json');
    // Кэш движка Ghostery: при повторных стартах грузится за <50ms без сети.
    // Хранит только базовые листы — пользовательский whitelist поверх через updateFromDiff.
    this.#enginePath = path.join(userData, 'ghostery-engine.bin');
  }

  // Загружает настройки + строит движок. Вызывается один раз при старте приложения.
  async initialize(onStateChange: (state: AdBlockState) => void): Promise<void> {
    this.#onStateChange = onStateChange;
    this.#loadSettings();

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

    // Пользовательские исключения (whitelist) применяем поверх базового движка
    // при каждом старте — НЕ кэшируем в engine.bin, чтобы кэш оставался стабильным.
    this.#applyWhitelist();

    // Нативный коллбэк Ghostery на каждую заблокированную сеть-заявку.
    // Точнее, чем onErrorOccurred: срабатывает ровно на блокировки адблока.
    blocker.on('request-blocked', () => { this.recordBlock(); });

    if (this.#enabled) {
      blocker.enableBlockingInSession(electronSession.defaultSession);
      console.log('[AdBlock] Ghostery активен (сетевая блокировка; косметика — Electron 35+)');
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
        this.#blocker.enableBlockingInSession(electronSession.defaultSession);
      } else {
        this.#blocker.disableBlockingInSession(electronSession.defaultSession);
      }
    }
    this.#scheduleSettingsSave();
    this.#notify();
  }

  // Домен нормализуется: strip протокола, www., trailing slash.
  // "www.reddit.com" → "reddit.com"; покрывает reddit.com И все поддомены.
  addDomain(raw: string): void {
    const domain = normalizeDomain(raw);
    if (!domain) return;
    this.#whitelist.add(domain);
    if (this.#blocker) {
      // Добавляем исключение в живой движок без перезагрузки кэша.
      this.#blocker.updateFromDiff({ added: [`@@||${domain}^$important`] });
    }
    this.#scheduleSettingsSave();
    this.#notify();
  }

  removeDomain(domain: string): void {
    this.#whitelist.delete(domain);
    if (this.#blocker) {
      this.#blocker.updateFromDiff({ removed: [`@@||${domain}^$important`] });
    }
    this.#scheduleSettingsSave();
    this.#notify();
  }

  recordBlock(): void {
    this.#sessionBlockCount++;
    this.#scheduleStatsPush();
  }

  // ── Приватные методы ───────────────────────────────────────────────────────

  // Применяет текущий whitelist поверх движка (вызывается при каждом старте).
  #applyWhitelist(): void {
    if (!this.#blocker || this.#whitelist.size === 0) return;
    const rules = [...this.#whitelist].map((d) => `@@||${d}^$important`);
    this.#blocker.updateFromDiff({ added: rules });
  }

  async #loadBlocker(): Promise<ElectronBlocker | null> {
    try {
      // fromLists с loadCosmeticFilters:false — обходим session.registerPreloadScript,
      // которого нет в Electron 31 (добавлен в Electron 35). Сетевая блокировка работает.
      // Кэш: при повторных стартах грузится из engine.bin без сети (<50ms).
      const load = ElectronBlocker.fromLists(
        (url) => fetch(url),
        adsAndTrackingLists,
        { loadCosmeticFilters: false },
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
      console.log('[AdBlock] движок загружен (Ghostery, только сетевая блокировка)');
      return blocker;
    } catch (e) {
      console.warn('[AdBlock] не удалось загрузить движок:', (e as Error).message);
      return null;
    }
  }

  // ── Персистенция ──────────────────────────────────────────────────────────

  #loadSettings(): void {
    try {
      const raw = fs.readFileSync(this.#settingsPath, 'utf8');
      const data = JSON.parse(raw) as unknown;
      if (isValidSettings(data)) {
        this.#enabled  = data.enabled;
        this.#whitelist = new Set(data.whitelist);
        return;
      }
    } catch { /* файл отсутствует или битый JSON — стартуем с дефолтом */ }
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
    const data: PersistedSettings = { enabled: this.#enabled, whitelist: [...this.#whitelist] };
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
  return typeof d['enabled'] === 'boolean' &&
    Array.isArray(d['whitelist']) &&
    (d['whitelist'] as unknown[]).every((x) => typeof x === 'string');
}

// Нормализует ввод пользователя до голого hostname.
// "https://www.Reddit.com/r/..." → "reddit.com"
export function normalizeDomain(raw: string): string | null {
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    let host = new URL(s).hostname;
    if (host.startsWith('www.')) host = host.slice(4);
    return host || null;
  } catch { return null; }
}
