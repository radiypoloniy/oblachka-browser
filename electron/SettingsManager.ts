import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SEARCH_ENGINE_ID, isSearchEngineId } from '../shared/searchEngines';
import type { SearchEngineId } from '../shared/searchEngines';

interface PersistedSettings {
  searchEngine: SearchEngineId;
}

// Простые пользовательские настройки (пока только поисковик по умолчанию) — JSON в userData,
// атомарная запись через tmp-файл, по паттерну AdBlockManager#writeSettings. Записи редкие
// (смена настройки вручную/капсулой), поэтому без дебаунса — пишем сразу.
export class SettingsManager {
  #searchEngine: SearchEngineId = DEFAULT_SEARCH_ENGINE_ID;
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

  #load(): void {
    try {
      const raw = fs.readFileSync(this.#settingsPath, 'utf8');
      const data = JSON.parse(raw) as unknown;
      if (typeof data === 'object' && data !== null) {
        const v = (data as Record<string, unknown>)['searchEngine'];
        if (isSearchEngineId(v)) this.#searchEngine = v;
      }
    } catch { /* файла нет или битый JSON — остаёмся на дефолте */ }
  }

  #write(): void {
    const data: PersistedSettings = { searchEngine: this.#searchEngine };
    const tmpPath = this.#settingsPath + '.tmp';
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.#settingsPath);
    } catch { /* ошибка диска — настройка останется применённой в памяти на эту сессию */ }
  }
}
