import { BrowserWindow } from 'electron';
import { contextForWindow, mainContext } from '../WindowRegistry';
import { activeBookmarks } from '../ProfileData';
import { extractPageText } from '../AiPanelManager';
import { extractUrlText } from '../NotebookExtract';
import { clampHistoryLimit, visibleTabs } from '../../shared/mcpPolicy';
import {
  batchTextLimit, bookmarkTargets, clampPageText, readUrlTargets, safeOpenUrl, tidyLinks,
  MCP_SHOT_QUALITY, MCP_SHOT_WIDTH, type McpLink,
} from '../../shared/mcpArgs';
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

/** Пауза перед второй попыткой снимка: столько занимает первая компоновка кадра. */
const EMPTY_FRAME_RETRY_MS = 400;

/**
 * Снять кадр, не роняя вызов.
 *
 * ⚠️ `null` вместо исключения намеренно: «поверхность ещё не готова» — это НЕ ошибка, а состояние
 * вкладки, открытой секунду назад. Вызывающий подождёт и попробует ещё раз; настоящую поломку он
 * отличит по второй неудаче подряд.
 */
async function tryCapture(wc: Electron.WebContents): Promise<Electron.NativeImage | null> {
  try {
    return await wc.capturePage();
  } catch {
    return null;
  }
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
    //
    // ⚠️ ОДНА ПОВТОРНАЯ ПОПЫТКА, и это не перестраховка: агент просит снимок ровно тогда, когда
    // вкладку только открыли, а у такой вкладки поверхность ещё не готова. Живой драйвер поймал
    // оба вида этой неготовности — пустой кадр и отказ «current display surface not available».
    // Пустой кадр агент прочитает как «страница пустая» и уверенно соврёт человеку.
    let shot = await tryCapture(wc);
    if (!shot || shot.isEmpty()) {
      await new Promise((r) => setTimeout(r, EMPTY_FRAME_RETRY_MS));
      if (wc.isDestroyed()) return { ok: false, error: 'The tab died while taking the screenshot.' };
      shot = await tryCapture(wc);
    }
    if (!shot) return { ok: false, error: 'The page is not ready to be captured yet.' };
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
  } catch (e) {
    // ⚠️ Причину говорим словами: «не вышло» без объяснения агент перескажет человеку как
    // «браузер не смог», и разобраться будет не с чем.
    return { ok: false, error: `Screenshot failed: ${(e as Error).message}` };
  }
}

/**
 * Скрипт сбора ссылок.
 *
 * ⚠️ Прост до предела намеренно: он исполняется в ЧУЖОМ документе, на любом сайте мира, и падать
 * ему нельзя — упавший скрипт вернёт агенту пустоту, которую тот прочитает как «ссылок нет».
 * Разбор, отсев и потолок живут в политике (tidyLinks), где их видно и где они проверяются без
 * браузера. Здесь только `href` (уже абсолютный — так его отдаёт DOM) и видимый текст.
 */
const LINKS_SCRIPT = `(() => {
  try {
    const out = [];
    for (const a of document.querySelectorAll('a[href]')) {
      out.push({ url: a.href, text: (a.innerText || a.textContent || '').slice(0, 300) });
      if (out.length >= 600) break;
    }
    return out;
  } catch (e) { return []; }
})()`;

export interface McpLinks {
  ok: boolean;
  error?: string;
  url?: string;
  title?: string;
  links?: McpLink[];
}

/**
 * Ссылки с активной вкладки.
 *
 * ⚠️ Заведено в пару к пакетному чтению: агент видит оглавление раздела за логином, выбирает
 * нужное и читает выбранное ОДНИМ вызовом. Без этого «обойди сайт» превращается в угадывание
 * адресов, а его собственный fetch туда не попадёт вовсе — страница за логином.
 *
 * ⚠️ Границы те же, что у page_text и снимка: активная вкладка и политика видимости.
 */
export async function activePageLinks(): Promise<McpLinks> {
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
    // true — исполнить как жест пользователя: часть страниц иначе не отдаёт DOM целиком.
    const raw: unknown = await wc.executeJavaScript(LINKS_SCRIPT, true);
    const links = tidyLinks(raw, tab.url);
    if (links.length === 0) return { ok: false, error: 'No links found on this page.' };
    return { ok: true, url: tab.url, title: tab.title, links };
  } catch {
    return { ok: false, error: 'Could not read links from this page.' };
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

export interface McpBookmarkHit {
  title: string;
  url: string;
  savedAt: string;
}

/**
 * Поиск по закладкам.
 *
 * ⚠️ Отдельно от истории намеренно, хотя формы ответа похожи: история — это всё, куда человек
 * заходил, а закладки — то, что он ОТОБРАЛ РУКАМИ. На вопрос «та статья, которую я сохранял» это
 * разные источники, и лучший из них — второй.
 *
 * ⚠️ Берём activeBookmarks() на каждый вызов, а не держим ссылку: закладки живут на профиль, и
 * захваченный объект пережил бы переключение профиля — то есть агент искал бы в чужих закладках.
 * Тот же довод, что у истории (см. McpDeps.history).
 */
export function searchBookmarks(query: string, limit: unknown): McpBookmarkHit[] {
  const q = query.trim();
  if (!q) return [];
  return activeBookmarks().search(q, clampHistoryLimit(limit)).map((b) => ({
    title: b.title,
    url: b.url,
    savedAt: new Date(b.createdAt).toISOString(),
  }));
}

// ── Запись. ⚠️ Сюда попадают только после подтверждения человеком (см. McpConfirm.ts). ──

export interface McpWriteResult {
  ok: boolean;
  note: string;
}

/**
 * Сохранить страницы в закладки.
 *
 * ⚠️ Закрывает круг, который до сих пор обрывался: агент находил нужное и не мог его никуда
 * положить — «папку создать не смог, вот ссылки» (живая жалоба 04.09.2026). Найденное без места
 * хранения человек переносит руками, то есть делает ровно ту работу, ради которой звал агента.
 *
 * ⚠️ Пачкой, а не по одной: восемь находок — это восемь карточек подтверждения подряд, и на
 * третьей человек перестаёт читать, что в них написано. Одна карточка перечисляет всё (см.
 * confirmSubject в shared/mcpArgs.ts).
 *
 * ⚠️ Папка ищется/создаётся ПО ИМЕНИ (folderByName): номеров наших папок у агента нет и не будет.
 */
export function addBookmarks(args: Record<string, unknown>): McpWriteResult {
  const targets = bookmarkTargets(args);
  if (!targets.ok) return { ok: false, note: targets.error };

  const store = activeBookmarks();
  const parentId = targets.folder ? store.folderByName(targets.folder) : null;
  // ⚠️ Папку не создали (база не открылась) — кладём в корень, а не бросаем всё: потерять место
  // хуже, чем потерять папку, и человек всё равно найдёт закладку поиском.
  let saved = 0;
  const skipped: string[] = [];
  for (const item of targets.items) {
    const entry = store.add(item.url, item.title || item.url, parentId);
    if (entry) saved++;
    else skipped.push(item.url);
  }
  const where = targets.folder && parentId !== null ? ` в папку «${targets.folder}»` : '';
  const tail = skipped.length > 0 ? `, пропущено ${skipped.length} (уже были или не открылась база)` : '';
  return {
    ok: saved > 0,
    note: saved > 0
      ? `Сохранено ${saved}${where}${tail}`
      : 'Ни одной закладки сохранить не удалось.',
  };
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
