// «Итоги дня» — три-пять строк о том, чем человек сегодня занимался, по его же истории.
//
// Зачем это локальной модели и почему именно ей: материал — список посещённых страниц, то есть
// самое личное, что есть в браузере. Отправить его в облако нельзя ни при каких обстоятельствах,
// а задача при этом ровно того размера, который 9B тянет: сгруппировать полсотни заголовков в
// несколько тем. Плюс всё, что нужно, уже лежит в SQLite — ни сети, ни ожидания.
//
// ⚠️ Считается ОДИН раз в день и живёт в кэше. Не потому что дорого, а потому что итог дня —
// не живая лента: пересобирать его на каждый показ новой вкладки значит гонять модель десятки
// раз за вечер ради одного и того же текста.
//
// ⚠️ Первый сбор — только по явной кнопке. Модель может быть холодной (загрузка ~31 с), и делать
// это молча, оттого что человек открыл новую вкладку, нельзя — то же правило, что у поиска
// вкладок и разбора полей формы. Зато последующие обновления идут фоном на тёплой модели.
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { HistoryEntry } from '../shared/ipc';
import { isNoisyForEmbedding } from './HistoryNoiseFilter';
import { runTabOrganizePrompt, isModelWarm } from './TranslationService';

export interface DayDigest {
  /** Дата в формате YYYY-MM-DD — она же ключ кэша. */
  date: string;
  lines: string[];
  builtAt: number;
  /** Сколько страниц вошло в разбор — чтобы понять, есть ли смысл пересобирать. */
  visits: number;
}

export type DigestState =
  | { state: 'ready'; digest: DayDigest }
  | { state: 'empty'; reason: 'no-history' | 'not-built' };

const MAX_PAGES = 60;      // столько заголовков модель ещё удерживает целиком
const MAX_LINES = 5;
const KEEP_DAYS = 7;
// Ниже этого числа страниц итог бессмысленен: «зашёл на две страницы» человек и так помнит.
const MIN_PAGES = 5;

let cache: Record<string, DayDigest> | null = null;
let building = false;

function file(): string {
  return path.join(app.getPath('userData'), 'day-digest.json');
}

export function todayKey(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

function load(): Record<string, DayDigest> {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(file(), 'utf8')) as Record<string, DayDigest>;
    cache = (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    cache = {};
  }
  return cache;
}

function save(): void {
  if (!cache) return;
  try {
    // Держим последнюю неделю: итог трёхмесячной давности не нужен никому, а файл должен
    // оставаться крошечным (его читают при старте виджета).
    const keys = Object.keys(cache).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete cache[k];
    const tmp = `${file()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache), 'utf8');
    fs.renameSync(tmp, file());
  } catch { /* диск недоступен — переживём, кэш останется в памяти */ }
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/**
 * Материал для промпта: только осмысленные страницы, без дублей и служебного мусора.
 * ⚠️ Дедуп по ЗАГОЛОВКУ, а не по адресу: человек возвращается на одну и ту же страницу за день
 * по десять раз, и без этого весь список превращался бы в одну повторённую строку.
 */
function pickPages(entries: HistoryEntry[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of entries) {
    const title = (e.title || '').trim();
    const host = hostOf(e.url);
    if (!title || !host) continue;
    if (isNoisyForEmbedding(e.url, title)) continue;
    const key = title.toLowerCase().slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(`${title.slice(0, 90)} — ${host}`);
    if (out.length >= MAX_PAGES) break;
  }
  return out;
}

// Инструкция по-английски при русском содержимом — то же решение и та же причина, что в
// TabSearch.ts/AutofillFieldMapper.ts: русские инструкции эта модель исполняет заметно хуже.
function buildPrompt(pages: string[]): string {
  return (
    `Pages a person visited today (title — site):\n${pages.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\n` +
    `Summarize what this person was busy with today. Group pages into ${MAX_LINES} topics at most, ` +
    `most important first. Write in RUSSIAN.\n` +
    `Every line must start with "- " and be a SHORT phrase (up to 7 words), not a sentence. ` +
    `Do not mention anything that is not in the list. Nothing else in the reply.`
  );
}

/**
 * Разбор ответа. Берём только строки-пункты; всё остальное (вступления, пересказ списка) —
 * мимо. Пустой массив честнее выдуманного текста: виджет просто скажет, что итога нет.
 */
function parseLines(out: string): string[] {
  const lines: string[] = [];
  for (const raw of out.split('\n')) {
    const m = /^\s*[-•*]\s+(.{3,90})$/.exec(raw.trim());
    if (!m) continue;
    const text = m[1]!.replace(/\s+/g, ' ').trim().replace(/[.;]+$/, '');
    // Пункт-эхо: модель иногда повторяет строку списка целиком, вместе с « — сайт».
    if (/ — [a-z0-9.-]+\.[a-z]{2,}$/i.test(text)) continue;
    if (text.length < 3) continue;
    lines.push(text);
    if (lines.length >= MAX_LINES) break;
  }
  return lines;
}

/** Готовый итог за сегодня, если он есть. Модель не трогает. */
export function getDigest(): DigestState {
  const store = load();
  const today = store[todayKey()];
  if (today) return { state: 'ready', digest: today };
  return { state: 'empty', reason: 'not-built' };
}

/**
 * Собрать итог за сегодня.
 *
 * @param explicit человек нажал кнопку — тогда можно и подождать загрузку модели. Фоновая
 *   пересборка (explicit=false) на холодной модели просто не начинается: см. правило про
 *   «никаких неявных тридцатисекундных загрузок».
 */
export async function buildDigest(
  visitsSince: (sinceMs: number) => HistoryEntry[],
  explicit: boolean,
): Promise<DigestState> {
  if (building) return getDigest();
  if (!explicit && !isModelWarm()) return getDigest();

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const pages = pickPages(visitsSince(dayStart.getTime()));
  if (pages.length < MIN_PAGES) return { state: 'empty', reason: 'no-history' };

  building = true;
  try {
    // Фоновая полоса очереди: даже когда человек нажал кнопку сам, он ждёт СВОЙ итог и не
    // должен из-за него ждать перевод (см. QwenQueue.ts). Задача одна и короткая.
    const res = await runTabOrganizePrompt(buildPrompt(pages), { role: 'digest', background: true });
    if (!res.ok) {
      console.warn('[digest] модель не ответила:', res.error);
      return getDigest();
    }
    const lines = parseLines(res.out);
    console.log(`[digest] ${pages.length} страниц → ${lines.length} строк; ответ: ${JSON.stringify(res.out.slice(0, 160))}`);
    if (lines.length === 0) return getDigest();

    const digest: DayDigest = { date: todayKey(), lines, builtAt: Date.now(), visits: pages.length };
    const store = load();
    store[digest.date] = digest;
    save();
    return { state: 'ready', digest };
  } catch (e) {
    console.warn('[digest] ошибка:', e);
    return getDigest();
  } finally {
    building = false;
  }
}

/**
 * Стоит ли пересобрать итог фоном: он есть, но собран давно, а страниц с тех пор прибавилось.
 * ⚠️ Порог по ЧИСЛУ новых страниц, а не по времени: вечер, проведённый на одной вкладке, ничего
 * нового к итогам не добавит, и гонять ради этого модель незачем.
 */
export function shouldRefresh(visitsSince: (sinceMs: number) => HistoryEntry[]): boolean {
  const st = getDigest();
  if (st.state !== 'ready') return false;
  if (Date.now() - st.digest.builtAt < 60 * 60 * 1000) return false;
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  return pickPages(visitsSince(dayStart.getTime())).length >= st.digest.visits + 10;
}
