import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_INSIGHTS, normalizeInsights, type InsightsConfig } from '../../shared/pageInsights';

// Только настройки и счёт запросов. Текст страниц и карточки остаются в памяти процесса.
let loadedPath = '';
let config: InsightsConfig = { ...DEFAULT_INSIGHTS };
let day = '';
let count = 0;
function load(): string {
  const file = path.join(app.getPath('userData'), 'page-insights.json');
  if (file === loadedPath) return file;
  loadedPath = file; config = { ...DEFAULT_INSIGHTS }; day = ''; count = 0;
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    config = normalizeInsights(value.config);
    if (typeof value.day === 'string') day = value.day;
    if (typeof value.count === 'number' && Number.isFinite(value.count)) count = Math.max(0, Math.floor(value.count));
  } catch { /* Первый запуск или неполный файл: фон не получает разрешение на облако. */ }
  return file;
}
function save(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify({ config, day, count }), 'utf8');
  fs.renameSync(file + '.tmp', file);
}
export function insightsConfig(): InsightsConfig { load(); return { ...config }; }
export function setInsightsConfig(patch: unknown): InsightsConfig {
  const file = load(), before = config;
  config = normalizeInsights(patch, config);
  try { save(file); } catch (error) { config = before; throw error; }
  return { ...config };
}
export function reserveInsightRequest(now = new Date()): boolean {
  const file = load(), today = now.toISOString().slice(0, 10);
  if (day !== today) { day = today; count = 0; }
  if (count >= config.dailyLimit) return false;
  // Счёт резервируется ДО сети: сбой или перезапуск не открывает платный повтор без лимита.
  count++;
  try { save(file); return true; } catch { count--; return false; }
}
