// Фоновая перепроверка цен (отслеживание товаров, срез 2).
//
// ⚠️ Замер (PRICE-TRACKING.md) определил всю конструкцию: сырым запросом читается только часть
// магазинов (Яндекс.Маркет), остальным нужна настоящая загрузка страницы. Поэтому путь ДВА и
// именно в таком порядке — сначала дешёвый, вью только на промахе. Один товар это секунды и
// заметная память, значит проверяем редко, по одному и только пока браузер и так открыт.
//
// ⚠️ Сервер здесь не при чём: браузер закрыт — проверок нет. Это цена приватного браузера без
// облака, и обещать человеку иное нельзя.
import { BrowserWindow, session, app } from 'electron';
import type { TrackingStore } from './TrackingStore';
import { detectProduct } from './ProductDetector';
import { jsonLdBlocksFromHtml, productFromJsonLd, type ProductSignal } from '../shared/productSignal';
import { allContexts } from './WindowRegistry';

// Как часто просыпаемся посмотреть, не пора ли кого проверить.
const TICK_MS = 60 * 60 * 1000;          // час
// Насколько устаревшей должна быть отметка, чтобы товар пошёл на проверку.
const STALE_MS = 20 * 60 * 60 * 1000;    // ~сутки
// Сколько товаров проверяем за один заход. ⚠️ Немного намеренно: это чужие сайты, и ходить к ним
// пачкой раз в час — поведение робота, а не браузера.
const BATCH = 4;
// Пауза между товарами в заходе — та же причина плюс не занимать процессор.
const GAP_MS = 8000;
// Первый заход после запуска: старт браузера и так тяжёлый (сессия, индексация), лезть в сеть
// сразу нельзя.
const FIRST_DELAY_MS = 3 * 60 * 1000;

const LOAD_TIMEOUT_MS = 25_000;
const SETTLE_MS = 2500;

let store: TrackingStore | null = null;
let timer: NodeJS.Timeout | null = null;
let running = false;
let stopped = false;

/** Дешёвый путь: обычный запрос, без запуска страницы. */
async function checkRaw(url: string): Promise<ProductSignal | null> {
  try {
    // Через сессию браузера — с куками человека, нашим UA и клиентскими подсказками: «голый»
    // запрос ловит 403 там, где браузерный проходит (замерено).
    const res = await session.defaultSession.fetch(url, { method: 'GET' });
    if (!res.ok) return null;
    return productFromJsonLd(jsonLdBlocksFromHtml(await res.text()));
  } catch {
    return null;
  }
}

/** Дорогой путь: настоящая загрузка в скрытом окне. */
async function checkView(url: string): Promise<ProductSignal | null> {
  // ⚠️ Окно создаётся и уничтожается на КАЖДЫЙ товар. Держать его между проверками нельзя: пока
  // живо хоть одно окно, приложение не выходит по window-all-closed — то есть закрытый человеком
  // браузер продолжал бы висеть в процессах (ровно на этом обжёгся стенд замера).
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  try {
    const failed = await new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(true), LOAD_TIMEOUT_MS);
      win.webContents.once('did-finish-load', () => { clearTimeout(t); resolve(false); });
      win.webContents.once('did-fail-load', () => { clearTimeout(t); resolve(true); });
      void win.loadURL(url);
    });
    if (failed) return null;
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    return await detectProduct(win.webContents);
  } catch {
    return null;
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

async function checkOne(item: { id: number; url: string }): Promise<boolean> {
  const signal = (await checkRaw(item.url)) ?? (await checkView(item.url));
  if (!signal) {
    store?.markChecked(item.id, false);
    return false;
  }
  store?.addPoint(item.id, signal.price, signal.availability);
  store?.markChecked(item.id, true);
  return true;
}

/**
 * Проверить пачку товаров. Возвращает, сколько удалось.
 *
 * ⚠️ Строго по одному и с паузой: параллельные загрузки чужих страниц — это и нагрузка на машину,
 * и поведение, неотличимое от парсера.
 */
async function runBatch(items: Array<{ id: number; url: string }>, gapMs: number): Promise<number> {
  let ok = 0;
  for (const item of items) {
    if (stopped) break;
    // Окон не осталось — человек закрыл браузер, и держать его живым ради проверок нельзя.
    if (allContexts().length === 0) break;
    if (await checkOne(item)) ok++;
    if (gapMs > 0) await new Promise((r) => setTimeout(r, gapMs));
  }
  return ok;
}

async function tick(): Promise<void> {
  if (running || stopped || !store) return;
  const due = store.dueForCheck(STALE_MS, BATCH);
  if (due.length === 0) return;
  running = true;
  try {
    const ok = await runBatch(due, GAP_MS);
    console.log(`[tracking] фоновая проверка: ${ok} из ${due.length}`);
  } finally {
    running = false;
  }
}

/**
 * Проверить всё прямо сейчас — по кнопке человека.
 *
 * ⚠️ Без пауз между товарами и без гейта «давно не проверяли»: человек нажал и ждёт ответа. Это
 * то же различие, что у остальных функций проекта между фоновой затеей и явным действием.
 */
export async function checkAllNow(): Promise<{ ok: number; total: number }> {
  if (!store) return { ok: 0, total: 0 };
  if (running) return { ok: 0, total: 0 };
  const items = store.allForCheck();
  running = true;
  try {
    const ok = await runBatch(items, 0);
    console.log(`[tracking] проверка по кнопке: ${ok} из ${items.length}`);
    return { ok, total: items.length };
  } finally {
    running = false;
  }
}

export function initTrackingChecker(s: TrackingStore): void {
  store = s;
  if (!s.available) return;
  setTimeout(() => { void tick(); }, FIRST_DELAY_MS);
  timer = setInterval(() => { void tick(); }, TICK_MS);
  // Выход из приложения не должен ждать нашу пачку.
  app.on('before-quit', () => {
    stopped = true;
    if (timer) { clearInterval(timer); timer = null; }
  });
}
