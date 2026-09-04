import { BrowserWindow } from 'electron';
import { contextForWindow, mainContext } from '../WindowRegistry';
import { extractPageText } from '../AiPanelManager';
import { extractUrlText } from '../NotebookExtract';
import {
  batchTextLimit, clampHistoryLimit, clampPageText, readUrlTargets, safeOpenUrl, visibleTabs,
  MCP_SHOT_QUALITY, MCP_SHOT_WIDTH,
} from '../../shared/mcpPolicy';
import type { HistoryManager } from '../HistoryManager';

// Три инструмента на чтение — тела вызовов MCP-сервера.
//
// ⚠️ НИЧЕГО НОВОГО ЗДЕСЬ НЕ СЧИТАЕТСЯ. Вкладки уже знает TabManager, текст страницы — тот же
// extractPageText, что кормит AI-панель и индексатор истории, поиск — тот же HistoryManager, что
// стоит за адресной строкой. Второй фасад к готовому, а не вторая реализация: разъехавшись, они
// дали бы агенту картину, отличную от той, что человек видит в браузере.
//
// ⚠️ ФИЛЬТРУЕМ НЕ ЗДЕСЬ. Что видно снаружи, решает shared/mcpPolicy.ts, и эти функции обязаны
// звать его, а не повторять условия своими словами: приватная вкладка, просочившаяся мимо
// фильтра, — это не баг отображения, это чужая почта в чужих руках.

export interface McpTabView {
  id: string;
  title: string;
  url: string;
  active: boolean;
}

/**
 * Окно, о котором отвечаем.
 *
 * ⚠️ Одно окно, а не все сразу, и это осознанная узость первого захода. У агента нет понятия
 * «окно»: отдав вкладки трёх окон одним списком, мы получим ответ «у тебя открыто 40 вкладок» на
 * вопрос про текущую работу. Берём то, куда человек смотрит; окна как понятие — отдельная задача.
 */
function activeContext() {
  return contextForWindow(BrowserWindow.getFocusedWindow()) ?? mainContext();
}

export function listTabs(): McpTabView[] {
  const ctx = activeContext();
  if (!ctx) return [];
  // snapshot() отдаёт и хаб, и псевдо-вкладки; наружу идёт только то, что прошло политику.
  return visibleTabs(ctx.tabs.snapshot()).map((t) => ({
    id: t.id,
    title: t.title,
    url: t.url,
    active: t.isActive,
  }));
}

/** Одна прочитанная страница в ответе. `cached` — отдана из памяти, браузер её не открывал. */
export interface McpPage {
  ok: boolean;
  url: string;
  title?: string;
  text?: string;
  error?: string;
  cached?: boolean;
}

/** Ответ пакетного чтения: сколько прочитали и сколько адресов выбросили негодными. */
export interface McpPageBatch {
  pages: McpPage[];
  dropped: number;
  error?: string;
}

export interface McpPageText {
  ok: boolean;
  title?: string;
  url?: string;
  text?: string;
  error?: string;
}

/**
 * Текст активной вкладки.
 *
 * ⚠️ Отказы здесь ОБЯЗАНЫ быть словами, а не пустым текстом. Спящая вкладка, наш собственный
 * интерфейс, страница, которая ещё грузится, — для агента это разные ситуации, и «пусто» он
 * прочитает как «страница пустая» и уверенно соврёт человеку.
 */
export async function activePageText(): Promise<McpPageText> {
  const ctx = activeContext();
  if (!ctx) return { ok: false, error: 'No browser window is open.' };

  const tab = ctx.tabs.snapshot().find((t) => t.isActive);
  if (!tab) return { ok: false, error: 'No active tab.' };
  // Приватная вкладка и наш интерфейс не отдаются даже как «активная страница».
  if (visibleTabs([tab]).length === 0) {
    return { ok: false, error: 'The active tab is private or an internal browser page; its content is not exposed.' };
  }

  const wc = ctx.tabs.getActiveWebContents();
  if (!wc) return { ok: false, error: 'The active tab has no live page yet (still loading or asleep).' };

  const extracted = await extractPageText(wc);
  if (!extracted.ok || !extracted.text.trim()) {
    return { ok: false, error: 'Could not extract readable text from this page.' };
  }
  return { ok: true, title: tab.title, url: tab.url, text: clampPageText(extracted.text) };
}

export interface McpShot {
  ok: boolean;
  error?: string;
  /** base64 без префикса data: — протокол ждёт голые байты в поле data. */
  data?: string;
  mime?: string;
  width?: number;
  height?: number;
  title?: string;
  url?: string;
}

/**
 * Снимок активной вкладки.
 *
 * ⚠️ ЭТО ТО, ЧЕГО ЧУЖОЙ FETCH НЕ МОЖЕТ В ПРИНЦИПЕ. Текст страницы агент ещё как-то добудет сам,
 * а увидеть дашборд за логином, график, карту или форму, на которой человек застрял, — нет.
 * Снимок идёт через ЕГО сессию и показывает ровно то, что у него на экране.
 *
 * ⚠️ Границы те же, что у page_text: только АКТИВНАЯ вкладка и только если она проходит политику
 * видимости. Приватная вкладка и наш собственный интерфейс не снимаются — иначе «покажи, что у
 * меня открыто» однажды отдаст наружу чужую почту.
 *
 * ⚠️ Снимаем ВИДИМУЮ ОБЛАСТЬ, а не страницу целиком, и говорим об этом в описании инструмента.
 * Полная страница — это прокрутка со склейкой кадров, то есть заметное время и вмешательство в
 * то, что человек сейчас читает.
 */
export async function screenshotActiveTab(): Promise<McpShot> {
  const ctx = activeContext();
  if (!ctx) return { ok: false, error: 'No browser window is open.' };

  const tab = ctx.tabs.snapshot().find((t) => t.isActive);
  if (!tab) return { ok: false, error: 'No active tab.' };
  if (visibleTabs([tab]).length === 0) {
    return { ok: false, error: 'The active tab is private or an internal browser page; it is not exposed.' };
  }

  const wc = ctx.tabs.getActiveWebContents();
  if (!wc) return { ok: false, error: 'The active tab has no live page yet (still loading or asleep).' };

  try {
    // ⚠️ capturePage ждёт следующего скомпонованного кадра и на загруженной машине занимает
    // заметное время — урок оплачен в ScreenshotManager.ts.
    const shot = await wc.capturePage();
    if (shot.isEmpty()) return { ok: false, error: 'The page produced an empty frame (still rendering?).' };
    const size = shot.getSize();
    // Только ширина — высоту NativeImage считает сам, по пропорции кадра. Кадр уже, чем предел,
    // не растягиваем: увеличенный снимок не добавляет модели ни одной детали, только байты.
    const scaled = size.width > MCP_SHOT_WIDTH ? shot.resize({ width: MCP_SHOT_WIDTH }) : shot;
    const out = scaled.getSize();
    return {
      ok: true,
      data: scaled.toJPEG(MCP_SHOT_QUALITY).toString('base64'),
      mime: 'image/jpeg',
      width: out.width,
      height: out.height,
      title: tab.title,
      url: tab.url,
    };
  } catch {
    return { ok: false, error: 'The tab died while taking the screenshot.' };
  }
}

export interface McpHistoryHit {
  title: string;
  url: string;
  lastVisit: string;
  visits: number;
}

/**
 * Поиск по посещённому.
 *
 * ⚠️ Дату отдаём строкой ISO, а не миллисекундами: число агент перескажет человеку как число.
 */
export function searchHistory(
  history: HistoryManager,
  query: string,
  limit: unknown,
): McpHistoryHit[] {
  const q = query.trim();
  if (!q) return [];
  return history.search(q).slice(0, clampHistoryLimit(limit)).map((h) => ({
    title: h.title,
    url: h.url,
    lastVisit: new Date(h.lastVisit).toISOString(),
    visits: h.visitCount,
  }));
}

// ── Запись. ⚠️ Сюда попадают только после подтверждения человеком (см. McpConfirm.ts). ──

export interface McpWriteResult {
  ok: boolean;
  note: string;
}

/**
 * Открыть адрес новой вкладкой.
 *
 * ⚠️ Адрес проходит через safeOpenUrl ЗДЕСЬ ЖЕ, ещё раз, хотя карточка подтверждения показывала
 * человеку уже проверенный. Это не дубль: между показом и выполнением лежит целый круг через
 * клиента, и повтор вызова с другим адресом обязан упереться в ту же проверку, а не в память о
 * том, что «пользователь уже согласился».
 */
export function openTab(rawUrl: unknown, background: unknown): McpWriteResult {
  const ctx = activeContext();
  if (!ctx) return { ok: false, note: 'No browser window is open.' };
  const url = safeOpenUrl(rawUrl);
  if (!url) return { ok: false, note: 'Only http(s) addresses can be opened.' };
  const id = ctx.tabs.createTab(url, background === true);
  return { ok: !!id, note: id ? `Opened ${url}` : 'The browser refused to open this address.' };
}

/**
 * Переключиться на уже открытую вкладку.
 *
 * ⚠️ Переключать можно ТОЛЬКО то, что и так видно снаружи: приватная вкладка и наш интерфейс
 * недоступны и здесь. Иначе агент, знающий чужой id, вытаскивал бы на экран спрятанное.
 */
export function activateTab(rawId: unknown): McpWriteResult {
  const ctx = activeContext();
  if (!ctx) return { ok: false, note: 'No browser window is open.' };
  const id = typeof rawId === 'string' ? rawId : '';
  const tab = visibleTabs(ctx.tabs.snapshot()).find((t) => t.id === id);
  if (!tab) return { ok: false, note: 'No such tab. Call tabs.list first.' };
  ctx.tabs.activate(id);
  return { ok: true, note: `Switched to ${tab.title || tab.url}` };
}

/** Закрыть вкладку. ⚠️ Необратимо отсюда — потому и destructiveHint, и вопрос человеку. */
export function closeTab(rawId: unknown): McpWriteResult {
  const ctx = activeContext();
  if (!ctx) return { ok: false, note: 'No browser window is open.' };
  const id = typeof rawId === 'string' ? rawId : '';
  const tab = visibleTabs(ctx.tabs.snapshot()).find((t) => t.id === id);
  if (!tab) return { ok: false, note: 'No such tab. Call tabs.list first.' };
  ctx.tabs.closeTab(id);
  return { ok: true, note: `Closed ${tab.title || tab.url}` };
}

/** Обрезать текст под бюджет вызова — вслух, как clampPageText (см. shared/mcpPolicy.ts). */
function clampTo(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n[… обрезано: страница длиннее ${limit} знаков]`;
}

/**
 * Прочитать страницу по адресу — профилем человека.
 *
 * ⚠️ ЭТО САМЫЙ ЦЕННЫЙ ИНСТРУМЕНТ НАБОРА, и заведён он по живому провалу: на просьбу «зайди на
 * сайт и собери материалы» агент пошёл своим fetch'ем и получил 404 там, где у человека в
 * браузере всё открывается. Разница ровно в том, ради чего браузер вообще отдают наружу: запрос
 * идёт через ЕГО сессию — куки, логины, адблок, туннель.
 *
 * ⚠️ Ничего нового не считаем: extractUrlText сперва пробует УЖЕ ОТКРЫТУЮ вкладку (она прошла
 * антибот и логин), и только потом открывает скрытую вью. Тот же путь, что у блокнота.
 */
export async function readUrl(args: Record<string, unknown>): Promise<McpPageBatch> {
  const targets = readUrlTargets(args);
  if (!targets.ok) return { pages: [], dropped: 0, error: targets.error };
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
  if (!win) return { pages: [], dropped: targets.dropped, error: 'No browser window is open.' };

  const limit = batchTextLimit(targets.urls.length);
  const pages = await inLanes(targets.urls, READ_LANES, (url) => readOne(win, url, limit));
  return { pages, dropped: targets.dropped };
}

/**
 * Одна страница: сперва кеш, потом браузер.
 *
 * ⚠️ Кеш держит СЫРОЙ текст, а обрезаем при выдаче: тот же адрес в пачке из восьми и в одиночном
 * вызове получает разный бюджет знаков, и хранить уже обрезанное значило бы отдать второму
 * вызову огрызок от первого.
 */
async function readOne(win: BrowserWindow, url: string, limit: number): Promise<McpPage> {
  const hit = cached(url);
  if (hit) return { ok: true, url, title: hit.title, text: clampTo(hit.text, limit), cached: true };

  const res = await extractUrlText(win, url);
  if (!res.ok || !res.text?.trim()) {
    return { ok: false, url, error: 'Could not read this page (it did not load, or has no readable text).' };
  }
  remember(url, res.title, res.text);
  return { ok: true, url, title: res.title, text: clampTo(res.text, limit) };
}

/**
 * Читаем несколько страниц одновременно, но не все сразу.
 *
 * ⚠️ Каждый непрочитанный адрес — это скрытая WebContentsView, то есть настоящий рендерер со своей
 * памятью (замер: ~28 МБ на вкладку, см. `npm run memory`). Восемь сразу — четверть гигабайта ради
 * одного вызова; полосы держат цену круга в разумных рамках, почти не теряя в скорости: время
 * упирается в загрузку страницы, а не в наш код.
 */
async function inLanes<T, R>(items: T[], lanes: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await run(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(lanes, items.length) }, worker));
  return out;
}

/**
 * Кеш прочитанного — ТОЛЬКО В ПАМЯТИ и ненадолго.
 *
 * ⚠️ На диск он не поедет никогда: файл со списком прочитанных адресов и их текстом — это вторая
 * история посещений рядом с той, которую человек умеет чистить, и заводить её мимо его ведома
 * нельзя. Тот же довод, что у журнала обращений (см. McpLog.ts).
 *
 * ⚠️ Живёт минуты, а не часы. Агент читает одни и те же страницы в пределах одной задачи — там
 * повтор обычен и стоит круга; через час это уже другой вопрос человека, и отвечать на него
 * вчерашним снимком страницы значит тихо соврать.
 */
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 32;
const READ_LANES = 3;

const cache = new Map<string, { title?: string; text: string; at: number }>();

function cached(url: string): { title?: string; text: string } | null {
  const hit = cache.get(url);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(url); return null; }
  return hit;
}

function remember(url: string, title: string | undefined, text: string): void {
  // Самая давняя запись уходит первой: Map хранит порядок вставки, и этого здесь достаточно.
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(url, { title, text, at: Date.now() });
}

/** Забыть прочитанное — при выключении сервера и отзыве клиента. */
export function forgetReadCache(): void {
  cache.clear();
}
