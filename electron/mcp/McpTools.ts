import { BrowserWindow } from 'electron';
import { contextForWindow, mainContext } from '../WindowRegistry';
import { activeBookmarks, activeTracking } from '../ProfileData';
import { extractPageText } from '../AiPanelManager';
import { extractUrlText } from '../NotebookExtract';
import { clampHistoryLimit, domainAllowed, visibleTabs } from '../../shared/mcpPolicy';
import {
  batchTextLimit, clampPageText, readUrlTargets, tidyLinks, trackingFreeUrl,
  MCP_SHOT_QUALITY, MCP_SHOT_WIDTH, type McpLink,
} from '../../shared/mcpArgs';
import type { HistoryManager } from '../HistoryManager';

// Чтение: что браузер РАССКАЗЫВАЕТ о себе внешнему агенту.
//
// ⚠️ Действия живут отдельно (McpActions.ts), и граница проходит там же, где в политике: чтение
// идёт молча по согласию, данному при подключении, а каждое изменение проходит через карточку.
//
// ⚠️ НИЧЕГО НОВОГО ЗДЕСЬ НЕ СЧИТАЕТСЯ. Вкладки уже знает TabManager, текст страницы — тот же
// extractPageText, что кормит AI-панель и индексатор истории, поиск — тот же HistoryManager, что
// стоит за адресной строкой. Второй фасад к готовому, а не вторая реализация: разъехавшись, они
// дали бы агенту картину, отличную от той, что человек видит в браузере.
//
// ⚠️ ФИЛЬТРУЕМ НЕ ЗДЕСЬ. Что видно снаружи, решает shared/mcpPolicy.ts, и эти функции обязаны
// звать его, а не повторять условия своими словами: приватная вкладка, просочившаяся мимо
// фильтра, — это не баг отображения, это чужая почта в чужих руках.

/**
 * Отказ по белому списку — ОДНОЙ ФРАЗОЙ на все инструменты.
 *
 * ⚠️ Формулировка важна: агент перескажет её человеку. «Нет доступа» тот прочитает как поломку
 * браузера, а «этой программе открыты только такие-то сайты» — как своё же решение, которое он
 * может изменить.
 */
export const OUT_OF_SCOPE = 'This page is outside the sites the user allowed for this client. '
  + 'The list is in the browser: Library → Agents → this program.';

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

export function listTabs(domains: readonly string[] = []): McpTabView[] {
  const ctx = activeContext();
  if (!ctx) return [];
  // ⚠️ Белый список фильтрует и СПИСОК, а не только чтение: адрес вкладки сам по себе говорит,
  // где человек сидит. «Только docs и github» без этого означало бы «читать нельзя, а видеть, что
  // ты в почте, — можно».
  // snapshot() отдаёт и хаб, и псевдо-вкладки; наружу идёт только то, что прошло политику.
  return visibleTabs(ctx.tabs.snapshot()).filter((t) => domainAllowed(t.url, domains)).map((t) => ({
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
export async function activePageText(domains: readonly string[] = []): Promise<McpPageText> {
  const ctx = activeContext();
  if (!ctx) return { ok: false, error: 'No browser window is open.' };

  const tab = ctx.tabs.snapshot().find((t) => t.isActive);
  if (!tab) return { ok: false, error: 'No active tab.' };
  // Приватная вкладка и наш интерфейс не отдаются даже как «активная страница».
  if (visibleTabs([tab]).length === 0) {
    return { ok: false, error: 'The active tab is private or an internal browser page; its content is not exposed.' };
  }

  // ⚠️ Белый список действует и на АКТИВНУЮ вкладку: человек мог открыть почту сам, но разрешение
  // «только docs и github» дано этой программе, а не этой странице.
  if (!domainAllowed(tab.url, domains)) return { ok: false, error: OUT_OF_SCOPE };

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
export async function screenshotActiveTab(domains: readonly string[] = []): Promise<McpShot> {
  const ctx = activeContext();
  if (!ctx) return { ok: false, error: 'No browser window is open.' };

  const tab = ctx.tabs.snapshot().find((t) => t.isActive);
  if (!tab) return { ok: false, error: 'No active tab.' };
  if (visibleTabs([tab]).length === 0) {
    return { ok: false, error: 'The active tab is private or an internal browser page; it is not exposed.' };
  }

  if (!domainAllowed(tab.url, domains)) return { ok: false, error: OUT_OF_SCOPE };

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
export async function activePageLinks(domains: readonly string[] = []): Promise<McpLinks> {
  const ctx = activeContext();
  if (!ctx) return { ok: false, error: 'No browser window is open.' };

  const tab = ctx.tabs.snapshot().find((t) => t.isActive);
  if (!tab) return { ok: false, error: 'No active tab.' };
  if (visibleTabs([tab]).length === 0) {
    return { ok: false, error: 'The active tab is private or an internal browser page; it is not exposed.' };
  }

  if (!domainAllowed(tab.url, domains)) return { ok: false, error: OUT_OF_SCOPE };

  const wc = ctx.tabs.getActiveWebContents();
  if (!wc) return { ok: false, error: 'The active tab has no live page yet (still loading or asleep).' };

  try {
    // true — исполнить как жест пользователя: часть страниц иначе не отдаёт DOM целиком.
    const raw: unknown = await wc.executeJavaScript(LINKS_SCRIPT, true);
    // ⚠️ И сами ссылки фильтруем: страница разрешена, а ведёт она куда угодно.
    const links = tidyLinks(raw, tab.url).filter((l) => domainAllowed(l.url, domains));
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
  domains: readonly string[] = [],
): McpHistoryHit[] {
  const q = query.trim();
  if (!q) return [];
  // ⚠️ Фильтр ДО обрезки по лимиту: иначе десять запрещённых адресов съедают всю выдачу, и
  // человек видит «ничего не нашлось» там, где нашлось.
  return history.search(q).filter((h) => domainAllowed(h.url, domains))
    .slice(0, clampHistoryLimit(limit)).map((h) => ({
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
export function searchBookmarks(
  query: string,
  limit: unknown,
  domains: readonly string[] = [],
): McpBookmarkHit[] {
  const q = query.trim();
  if (!q) return [];
  // ⚠️ Берём с запасом и фильтруем: иначе запрещённые адреса вытесняют разрешённые из выдачи.
  return activeBookmarks().search(q, 100).filter((b) => domainAllowed(b.url, domains))
    .slice(0, clampHistoryLimit(limit)).map((b) => ({
    title: b.title,
    url: b.url,
    savedAt: new Date(b.createdAt).toISOString(),
  }));
}

export interface McpTracked {
  title: string;
  url: string;
  shop: string;
  price: number | null;
  currency: string;
  /** Изменение с первой известной цены: «-3000» дешевле, «+500» дороже, null — точек мало. */
  changed: number | null;
  lastCheckOk: boolean;
}

/**
 * Что человек уже отслеживает.
 *
 * ⚠️ Отдаём ПОСЛЕДНЮЮ и ПЕРВУЮ цену, а не всю историю точек: агенту нужно ответить «подешевело
 * ли», а полная кривая — это сотни чисел в его контексте, за которые платит человек.
 *
 * ⚠️ Неудачную проверку показываем флагом. Иначе последняя известная цена выглядит свежей, и
 * решение о покупке принимается по данным непонятной давности — тот же довод, что в интерфейсе.
 */
export function listTracked(domains: readonly string[] = []): McpTracked[] {
  return activeTracking().list()
    .filter((t) => domainAllowed(t.url, domains))
    .map((t) => {
      const points = t.points ?? [];
      const last = points[points.length - 1];
      const first = points[0];
      return {
        title: t.title,
        url: t.url,
        shop: t.host,
        price: last?.price ?? null,
        currency: t.currency,
        changed: last && first && points.length > 1 ? last.price - first.price : null,
        lastCheckOk: t.lastCheckOk === 1,
      };
    });
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
export async function readUrl(
  args: Record<string, unknown>,
  domains: readonly string[] = [],
): Promise<McpPageBatch> {
  const targets = readUrlTargets(args);
  if (!targets.ok) return { pages: [], dropped: 0, error: targets.error };
  // ⚠️ Отсекаем ЗАПРЕЩЁННЫЕ адреса поштучно, как и битые: в списке из восьми ссылок одна может
  // вести на почту, и ронять из-за неё семь разрешённых незачем.
  const allowed = targets.urls.filter((u) => domainAllowed(u, domains));
  if (allowed.length === 0) return { pages: [], dropped: targets.dropped, error: OUT_OF_SCOPE };
  const blocked = targets.urls.length - allowed.length;
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
  if (!win) return { pages: [], dropped: targets.dropped, error: 'No browser window is open.' };

  const limit = batchTextLimit(allowed.length);
  const pages = await inLanes(allowed, READ_LANES, (url) => readOne(win, url, limit));
  return { pages, dropped: targets.dropped + blocked };
}

/**
 * Одна страница: сперва кеш, потом браузер.
 *
 * ⚠️ Кеш держит СЫРОЙ текст, а обрезаем при выдаче: тот же адрес в пачке из восьми и в одиночном
 * вызове получает разный бюджет знаков, и хранить уже обрезанное значило бы отдать второму
 * вызову огрызок от первого.
 */
async function readOne(win: BrowserWindow, url: string, limit: number): Promise<McpPage> {
  // ⚠️ Ключ кеша — адрес БЕЗ МЕТОК СЛЕЖЕНИЯ: у маркетплейса та же карточка приходит с новым
  // `advert` при каждом показе, и по полному адресу кеш промахивался бы всегда.
  const key = trackingFreeUrl(url);
  const hit = cached(key);
  if (hit) return { ok: true, url, title: hit.title, text: clampTo(hit.text, limit), cached: true };

  const res = await extractUrlText(win, url);
  if (!res.ok || !res.text?.trim()) {
    return { ok: false, url, error: 'Could not read this page (it did not load, or has no readable text).' };
  }
  remember(key, res.title, res.text);
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
