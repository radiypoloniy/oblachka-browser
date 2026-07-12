import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SEARCH_ENGINE_ID, isSearchEngineId } from '../shared/searchEngines';
import type { SearchEngineId } from '../shared/searchEngines';
import type { HubMode } from '../shared/ipc';
import type { EngineId } from './TranslationEngine';

const DEFAULT_HUB_MODE: HubMode = 'tiles';
// 'qwen' — единственный движок, доступный на Этапе 1 (см. TranslationEngineRegistry.ts) — Bergamot
// появится Этапом 3, но поле уже персистится сейчас, чтобы регистри могла читать сохранённый выбор
// с первого дня, не дожидаясь UI-переключателя.
const DEFAULT_TRANSLATION_ENGINE: EngineId = 'qwen';

interface PersistedSettings {
  searchEngine: SearchEngineId;
  hubMode: HubMode;
  translationEngine: EngineId;
}

function isHubMode(v: unknown): v is HubMode {
  return v === 'tiles' || v === 'ai';
}

function isEngineId(v: unknown): v is EngineId {
  return v === 'qwen' || v === 'bergamot';
}

// Простые пользовательские настройки (поисковик по умолчанию + режим Hub) — JSON в userData,
// атомарная запись через tmp-файл, по паттерну AdBlockManager#writeSettings. Записи редкие
// (смена настройки вручную/капсулой), поэтому без дебаунса — пишем сразу.
export class SettingsManager {
  #searchEngine: SearchEngineId = DEFAULT_SEARCH_ENGINE_ID;
  #hubMode: HubMode = DEFAULT_HUB_MODE;
  #translationEngine: EngineId = DEFAULT_TRANSLATION_ENGINE;
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
      }
    } catch { /* файла нет или битый JSON — остаёмся на дефолте */ }
  }

  #write(): void {
    const data: PersistedSettings = {
      searchEngine: this.#searchEngine,
      hubMode: this.#hubMode,
      translationEngine: this.#translationEngine,
    };
    const tmpPath = this.#settingsPath + '.tmp';
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.#settingsPath);
    } catch { /* ошибка диска — настройка останется применённой в памяти на эту сессию */ }
  }
}
