import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SEARCH_ENGINE_ID, isSearchEngineId } from '../shared/searchEngines';
import type { SearchEngineId } from '../shared/searchEngines';
import type { HubMode, ModelLoadMode, SearchChipsConfig } from '../shared/ipc';
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

interface PersistedSettings {
  searchEngine: SearchEngineId;
  hubMode: HubMode;
  translationEngine: EngineId;
  aiPanelWidth: number;
  modelLoadMode: ModelLoadMode;
  // Онбординг импорта из другого браузера показывался ли уже (см. electron/browserImport/).
  // Однократное предложение при первом запуске — потом только вручную из настроек.
  importOffered: boolean;
  // Требовать подтверждение Windows (нативный диалог, см. electron/osAuth.ts) перед показом/
  // копированием пароля. Тумблер в настройках паролей; он же — страховка от лок-аута, если
  // проверка на конкретной машине не срабатывает.
  passwordAuthEnabled: boolean;
}

function clampAiPanelWidth(v: number): number {
  return Math.max(AI_PANEL_WIDTH_MIN, Math.min(AI_PANEL_WIDTH_MAX, v));
}

function isHubMode(v: unknown): v is HubMode {
  return v === 'tiles' || v === 'ai';
}

function isEngineId(v: unknown): v is EngineId {
  return v === 'qwen' || v === 'bergamot';
}

function isModelLoadMode(v: unknown): v is ModelLoadMode {
  return v === 'startup' || v === 'on-demand';
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
  #importOffered = false;
  #passwordAuthEnabled = true; // доп. защита по умолчанию включена (см. PersistedSettings)
  #searchChips: SearchChipsConfig = { mode: 'auto', pinned: [] };
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

  getPasswordAuthEnabled(): boolean {
    return this.#passwordAuthEnabled;
  }

  setPasswordAuthEnabled(enabled: boolean): void {
    this.#passwordAuthEnabled = !!enabled;
    this.#write();
  }

  getSearchChips(): SearchChipsConfig {
    return { mode: this.#searchChips.mode, pinned: [...this.#searchChips.pinned] };
  }

  setSearchChips(cfg: SearchChipsConfig): void {
    this.#searchChips = {
      mode: cfg.mode === 'pinned' ? 'pinned' : 'auto',
      pinned: Array.isArray(cfg.pinned) ? cfg.pinned.filter((x) => typeof x === 'string') : [],
    };
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
        const io = (data as Record<string, unknown>)['importOffered'];
        if (typeof io === 'boolean') this.#importOffered = io;
        const pa = (data as Record<string, unknown>)['passwordAuthEnabled'];
        if (typeof pa === 'boolean') this.#passwordAuthEnabled = pa;
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
      importOffered: this.#importOffered,
      passwordAuthEnabled: this.#passwordAuthEnabled,
    };
    const tmpPath = this.#settingsPath + '.tmp';
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.#settingsPath);
    } catch { /* ошибка диска — настройка останется применённой в памяти на эту сессию */ }
  }
}
