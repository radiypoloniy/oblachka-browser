import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SEARCH_ENGINE_ID, isSearchEngineId } from '../shared/searchEngines';
import type { SearchEngineId } from '../shared/searchEngines';
import { THEME_PALETTE_IDS } from '../shared/ipc';
import type { HubMode, ModelLoadMode, PageLength, RecommendedSite, SearchChipsConfig, ThemeMode, ThemePaletteId } from '../shared/ipc';
import type { EngineId } from './TranslationEngine';

const DEFAULT_HUB_MODE: HubMode = 'tiles';
// Ширина AI-дока (заход 3 — из поповера в правый split-view-подобный док). Клампы —
// 300 (чат ещё читаем) / 640 (не должен отжирать пол-окна на обычных размерах).
const DEFAULT_AI_PANEL_WIDTH = 360;
const AI_PANEL_WIDTH_MIN = 300;
const AI_PANEL_WIDTH_MAX = 640;
// 'bergamot' — дефолт с Этапа 5 (по ручной проверке пользователя после Этапов 1-4). Если файлов
// модели нет на диске или воркер не поднялся — TranslationEngineRegistry.getActiveEngine() тихо
// откатывается на Qwen (isReady()===false), см. её же комментарий — переключение дефолта не
// требует, чтобы Bergamot гарантированно был доступен у конкретного пользователя, деградация
// уже отработана раньше. Qwen остаётся выбираемым в Settings.tsx как «AI-перевод (медленно,
// выше качество)».
const DEFAULT_TRANSLATION_ENGINE: EngineId = 'bergamot';
// on-demand по умолчанию — экономит ~6 ГБ RAM, пока пользователь не проявил явное намерение
// работать с AI (открытие AI-панели/хаба в режиме AI, см. main.ts). См. комментарий у типа
// ModelLoadMode в shared/ipc.ts.
const DEFAULT_MODEL_LOAD_MODE: ModelLoadMode = 'on-demand';

// Набор «Рекомендуемые» в панели омнибокса — то, с чем начинается рабочий день у большинства.
// ⚠️ Это ДЕФОЛТ, а не рекомендация от нас: человек правит набор карандашом прямо в панели, и его
// правка хранится отдельно (см. #recommendedSites — null значит «не трогал»). Ничего в этот список
// не попадает само: ни рекламы, ни партнёров, ни «умного» подбора по истории.
const DEFAULT_RECOMMENDED: RecommendedSite[] = [
  { url: 'https://mail.google.com/',    title: 'Почта' },
  { url: 'https://calendar.google.com/', title: 'Календарь' },
  { url: 'https://drive.google.com/',   title: 'Диск' },
  { url: 'https://github.com/',         title: 'GitHub' },
  { url: 'https://www.notion.so/',      title: 'Notion' },
  { url: 'https://www.figma.com/',      title: 'Figma' },
  { url: 'https://chatgpt.com/',        title: 'ChatGPT' },
  { url: 'https://www.youtube.com/',    title: 'YouTube' },
];
// Потолок набора: панель рисует его в две строки по четыре, и всё сверх этого просто не поместится
// без скролла внутри папки.
const RECOMMENDED_MAX = 8;

interface PersistedSettings {
  searchEngine: SearchEngineId;
  hubMode: HubMode;
  translationEngine: EngineId;
  aiPanelWidth: number;
  modelLoadMode: ModelLoadMode;
  pageLength: PageLength;
  // Онбординг импорта из другого браузера показывался ли уже (см. electron/browserImport/).
  // Однократное предложение при первом запуске — потом только вручную из настроек.
  importOffered: boolean;
  askDownloadLocation: boolean;
  // Требовать подтверждение Windows (нативный диалог, см. electron/osAuth.ts) перед показом/
  // копированием пароля. Тумблер в настройках паролей; он же — страховка от лок-аута, если
  // проверка на конкретной машине не срабатывает.
  passwordAuthEnabled: boolean;
  // Отдавать ли браузер наружу как MCP-сервер (electron/mcp/). ⚠️ По умолчанию ВЫКЛЮЧЕНО и
  // включается только руками: это доступ внешнего агента к живому профилю человека, и
  // «включилось само после обновления» здесь недопустимо.
  mcpEnabled: boolean;
  // Полоса целей поповера Ctrl+E (режим, закреплённые, цель по умолчанию — см. shared/ipc.ts).
  searchChips: SearchChipsConfig;
  // Оформление: светло/темно/как в системе + нейтральная палитра (см. ThemePrefs в shared/ipc.ts).
  themeMode: ThemeMode;
  themePalette: ThemePaletteId;
  // ⚠️ null, а не пустой массив, когда человек набор не трогал. Разница принципиальна: пустой
  // массив — это осознанно опустошённая папка, и подсовывать в неё дефолт обратно нельзя.
  recommendedSites: RecommendedSite[] | null;
  // Сайты, которые человек запретил выгружать из памяти (ПКМ по вкладке). Решение ПРО САЙТ, а не
  // про вкладку: закрыл вкладку — правило остаётся, открыл ту же почту завтра — она снова под
  // защитой. Плюс формат сессии не приходится трогать вовсе, а его поломка = потеря вкладок.
  neverSleepSites: string[];
}

// Хосты приходят и из меню, и с диска — нормализатор один. Пустые и мусорные строки выбрасываем
// молча: в списке им делать нечего, а падать из-за битого файла настроек тем более незачем.
function normalizeHosts(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const raw of v) {
    if (typeof raw !== 'string') continue;
    const host = raw.trim().toLowerCase().replace(/^www\./, '');
    if (!host || host.length > 253 || out.includes(host)) continue;
    out.push(host);
    if (out.length >= NEVER_SLEEP_MAX) break;
  }
  return out;
}
// Потолок списка — защита от бесконечного роста файла настроек, не продуктовое ограничение.
const NEVER_SLEEP_MAX = 200;

// Приходит из renderer и читается с диска — оба источника недоверенные, нормализатор один на обе
// двери (тот же приём, что у полосы целей выше).
function normalizeRecommended(v: unknown): RecommendedSite[] | null {
  if (!Array.isArray(v)) return null;
  const out: RecommendedSite[] = [];
  for (const raw of v) {
    if (typeof raw !== 'object' || raw === null) continue;
    const { url, title } = raw as Partial<RecommendedSite>;
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) continue;
    if (out.some((s) => s.url === url)) continue;
    out.push({ url, title: typeof title === 'string' && title ? title.slice(0, 60) : url });
    if (out.length >= RECOMMENDED_MAX) break;
  }
  return out;
}

const DEFAULT_SEARCH_CHIPS: SearchChipsConfig = { mode: 'auto', pinned: [], defaultId: null };

// Настройка приходит из renderer и читается с диска — оба источника недоверенные, поэтому
// один нормализатор на обе двери.
function normalizeSearchChips(v: unknown): SearchChipsConfig {
  if (typeof v !== 'object' || v === null) return { ...DEFAULT_SEARCH_CHIPS };
  const cfg = v as Partial<SearchChipsConfig>;
  return {
    mode: cfg.mode === 'pinned' ? 'pinned' : 'auto',
    pinned: Array.isArray(cfg.pinned) ? cfg.pinned.filter((x): x is string => typeof x === 'string') : [],
    // Существует ли такая цель на самом деле, здесь не проверяем: список целей собирается
    // динамически (бэнги/выученные сайты), и цель может временно отсутствовать. Промах гасится
    // в SearchTargets.ts — просто вернётся прежний порядок.
    defaultId: typeof cfg.defaultId === 'string' && cfg.defaultId ? cfg.defaultId : null,
  };
}

function clampAiPanelWidth(v: number): number {
  return Math.max(AI_PANEL_WIDTH_MIN, Math.min(AI_PANEL_WIDTH_MAX, v));
}

function isHubMode(v: unknown): v is HubMode {
  return v === 'tiles' || v === 'ai' || v === 'graph';
}

function isEngineId(v: unknown): v is EngineId {
  return v === 'qwen' || v === 'bergamot';
}

function isModelLoadMode(v: unknown): v is ModelLoadMode {
  return v === 'startup' || v === 'on-demand';
}

function isThemeMode(v: unknown): v is ThemeMode {
  return v === 'light' || v === 'dark' || v === 'system';
}

function isThemePalette(v: unknown): v is ThemePaletteId {
  return typeof v === 'string' && (THEME_PALETTE_IDS as readonly string[]).includes(v);
}

// Простые пользовательские настройки (поисковик по умолчанию + режим Hub) — JSON в userData,
// атомарная запись через tmp-файл, по паттерну AdBlockManager#writeSettings. Записи редкие
// (смена настройки вручную/капсулой), поэтому без дебаунса — пишем сразу.
export class SettingsManager {
  #searchEngine: SearchEngineId = DEFAULT_SEARCH_ENGINE_ID;
  #hubMode: HubMode = DEFAULT_HUB_MODE;
  #translationEngine: EngineId = DEFAULT_TRANSLATION_ENGINE;
  #aiPanelWidth: number = DEFAULT_AI_PANEL_WIDTH;
  #modelLoadMode: ModelLoadMode = DEFAULT_MODEL_LOAD_MODE;
  #pageLength: PageLength = 'normal';
  #importOffered = false;
  // Спрашивать папку для каждого файла. По умолчанию НЕТ — см. DownloadManager.
  #askDownloadLocation = false;
  #passwordAuthEnabled = true; // доп. защита по умолчанию включена (см. PersistedSettings)
  #mcpEnabled = false;         // ⚠️ выключено по умолчанию — см. PersistedSettings
  #searchChips: SearchChipsConfig = { ...DEFAULT_SEARCH_CHIPS };
  // Светлая по умолчанию, а не 'system': тёмной темы в браузере до сих пор не было вовсе, и
  // молча перекрасить интерфейс у тех, у кого Windows в тёмном режиме, значило бы сменить вид
  // приложения без единого действия человека. Выбор «как в системе» стоит рядом в настройках.
  #themeMode: ThemeMode = 'light';
  // ⚠️ «Мята», а не нейтральный «Уголь»: первое, что человек видит после установки, — это лицо
  // продукта, и серый интерфейс по умолчанию рассказывает о нём ровно ничего. Палитра меняется
  // одним щелчком в «Интерфейсе», а вот впечатление от первого запуска второй раз не создать.
  #themePalette: ThemePaletteId = 'mint';
  // null — набор не трогали, отдаём дефолтный (см. DEFAULT_RECOMMENDED).
  #recommendedSites: RecommendedSite[] | null = null;
  #neverSleepSites: string[] = [];
  readonly #settingsPath: string;

  constructor() {
    this.#settingsPath = path.join(app.getPath('userData'), 'settings.json');
    this.#load();
  }

  getSearchEngine(): SearchEngineId {
    return this.#searchEngine;
  }

  setSearchEngine(id: SearchEngineId): void {
    if (!isSearchEngineId(id)) return;
    this.#searchEngine = id;
    this.#write();
  }

  getHubMode(): HubMode {
    return this.#hubMode;
  }

  setHubMode(mode: HubMode): void {
    if (!isHubMode(mode)) return;
    this.#hubMode = mode;
    this.#write();
  }

  getTranslationEngine(): EngineId {
    return this.#translationEngine;
  }

  setTranslationEngine(id: EngineId): void {
    if (!isEngineId(id)) return;
    this.#translationEngine = id;
    this.#write();
  }

  getAiPanelWidth(): number {
    return this.#aiPanelWidth;
  }

  setAiPanelWidth(px: number): void {
    if (!Number.isFinite(px)) return;
    this.#aiPanelWidth = clampAiPanelWidth(px);
    this.#write();
  }

  getModelLoadMode(): ModelLoadMode {
    return this.#modelLoadMode;
  }

  setModelLoadMode(mode: ModelLoadMode): void {
    if (!isModelLoadMode(mode)) return;
    this.#modelLoadMode = mode;
    this.#write();
  }

  /** Объём страницы Студии. Читает NotebookPage, показывает раздел «Модель». */
  getPageLength(): PageLength {
    return this.#pageLength;
  }

  setPageLength(v: PageLength): void {
    if (v !== 'short' && v !== 'normal' && v !== 'long') return;
    this.#pageLength = v;
    this.#write();
  }

  getImportOffered(): boolean {
    return this.#importOffered;
  }

  // Взводится однократно после показа онбординга импорта — обратно не сбрасывается (повторно
  // предлагать импорт при каждом старте не нужно, дальше только вручную из настроек).
  setImportOffered(): void {
    if (this.#importOffered) return;
    this.#importOffered = true;
    this.#write();
  }

  getAskDownloadLocation(): boolean {
    return this.#askDownloadLocation;
  }

  setAskDownloadLocation(value: boolean): void {
    this.#askDownloadLocation = value;
    this.#write();
  }

  getPasswordAuthEnabled(): boolean {
    return this.#passwordAuthEnabled;
  }

  getMcpEnabled(): boolean {
    return this.#mcpEnabled;
  }

  setMcpEnabled(enabled: boolean): void {
    this.#mcpEnabled = !!enabled;
    this.#write();
  }

  setPasswordAuthEnabled(enabled: boolean): void {
    this.#passwordAuthEnabled = !!enabled;
    this.#write();
  }

  getSearchChips(): SearchChipsConfig {
    return { ...this.#searchChips, pinned: [...this.#searchChips.pinned] };
  }

  setSearchChips(cfg: SearchChipsConfig): void {
    this.#searchChips = normalizeSearchChips(cfg);
    this.#write();
  }

  getThemeMode(): ThemeMode {
    return this.#themeMode;
  }

  getThemePalette(): ThemePaletteId {
    return this.#themePalette;
  }

  // Одной дверью: тема и палитра меняются из одного места в UI, и раздельная запись означала бы
  // два сообщения и два перерисованных окна на одно действие человека.
  /** Сайты, которые нельзя выгружать из памяти (см. neverSleepSites). Копия — список не наш. */
  getNeverSleepSites(): string[] {
    return [...this.#neverSleepSites];
  }

  isNeverSleepHost(host: string): boolean {
    const h = host.trim().toLowerCase().replace(/^www\./, '');
    return !!h && this.#neverSleepSites.includes(h);
  }

  /** Переключатель для пункта меню: возвращает НОВОЕ состояние («защищён ли теперь»). */
  toggleNeverSleepHost(host: string): boolean {
    const h = host.trim().toLowerCase().replace(/^www\./, '');
    if (!h) return false;
    const on = !this.#neverSleepSites.includes(h);
    this.#neverSleepSites = on
      ? [...this.#neverSleepSites, h].slice(0, NEVER_SLEEP_MAX)
      : this.#neverSleepSites.filter((x) => x !== h);
    this.#write();
    return on;
  }

  setNeverSleepSites(list: string[]): void {
    this.#neverSleepSites = normalizeHosts(list);
    this.#write();
  }

  getRecommendedSites(): RecommendedSite[] {
    return this.#recommendedSites ?? DEFAULT_RECOMMENDED;
  }

  setRecommendedSites(list: RecommendedSite[]): void {
    this.#recommendedSites = normalizeRecommended(list) ?? [];
    this.#write();
  }

  setTheme(mode: ThemeMode, palette: ThemePaletteId): void {
    if (isThemeMode(mode)) this.#themeMode = mode;
    if (isThemePalette(palette)) this.#themePalette = palette;
    this.#write();
  }

  #load(): void {
    try {
      const raw = fs.readFileSync(this.#settingsPath, 'utf8');
      const data = JSON.parse(raw) as unknown;
      if (typeof data === 'object' && data !== null) {
        const v = (data as Record<string, unknown>)['searchEngine'];
        if (isSearchEngineId(v)) this.#searchEngine = v;
        const hm = (data as Record<string, unknown>)['hubMode'];
        if (isHubMode(hm)) this.#hubMode = hm;
        const te = (data as Record<string, unknown>)['translationEngine'];
        if (isEngineId(te)) this.#translationEngine = te;
        const pw = (data as Record<string, unknown>)['aiPanelWidth'];
        if (typeof pw === 'number' && Number.isFinite(pw)) this.#aiPanelWidth = clampAiPanelWidth(pw);
        const lm = (data as Record<string, unknown>)['modelLoadMode'];
        if (isModelLoadMode(lm)) this.#modelLoadMode = lm;
        const pl = (data as Record<string, unknown>)['pageLength'];
        if (pl === 'short' || pl === 'normal' || pl === 'long') this.#pageLength = pl;
        const io = (data as Record<string, unknown>)['importOffered'];
        if (typeof io === 'boolean') this.#importOffered = io;
        const dl = (data as Record<string, unknown>)['askDownloadLocation'];
        if (typeof dl === 'boolean') this.#askDownloadLocation = dl;
        const pa = (data as Record<string, unknown>)['passwordAuthEnabled'];
        if (typeof pa === 'boolean') this.#passwordAuthEnabled = pa;
        const mcp = (data as Record<string, unknown>)['mcpEnabled'];
        if (typeof mcp === 'boolean') this.#mcpEnabled = mcp;
        // Раньше полоса целей не сохранялась вовсе (в #write её просто не было) — режим и
        // закреплённые сбрасывались на каждый запуск. Ключа нет у старых профилей — нормализатор
        // отдаст дефолт.
        const sc = (data as Record<string, unknown>)['searchChips'];
        if (sc !== undefined) this.#searchChips = normalizeSearchChips(sc);
        const tm = (data as Record<string, unknown>)['themeMode'];
        if (isThemeMode(tm)) this.#themeMode = tm;
        const tp = (data as Record<string, unknown>)['themePalette'];
        if (isThemePalette(tp)) this.#themePalette = tp;
        // Ключа нет у старых профилей — остаёмся на null, то есть на дефолтном наборе.
        const rs = (data as Record<string, unknown>)['recommendedSites'];
        if (rs !== undefined && rs !== null) this.#recommendedSites = normalizeRecommended(rs) ?? [];
        this.#neverSleepSites = normalizeHosts((data as Record<string, unknown>)['neverSleepSites']);
      }
    } catch { /* файла нет или битый JSON — остаёмся на дефолте */ }
  }

  #write(): void {
    const data: PersistedSettings = {
      searchEngine: this.#searchEngine,
      hubMode: this.#hubMode,
      translationEngine: this.#translationEngine,
      aiPanelWidth: this.#aiPanelWidth,
      modelLoadMode: this.#modelLoadMode,
      pageLength: this.#pageLength,
      importOffered: this.#importOffered,
      askDownloadLocation: this.#askDownloadLocation,
      passwordAuthEnabled: this.#passwordAuthEnabled,
      mcpEnabled: this.#mcpEnabled,
      searchChips: this.#searchChips,
      themeMode: this.#themeMode,
      themePalette: this.#themePalette,
      recommendedSites: this.#recommendedSites,
      neverSleepSites: this.#neverSleepSites,
    };
    const tmpPath = this.#settingsPath + '.tmp';
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.#settingsPath);
    } catch { /* ошибка диска — настройка останется применённой в памяти на эту сессию */ }
  }
}
