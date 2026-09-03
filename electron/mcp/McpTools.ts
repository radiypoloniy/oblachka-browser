import { BrowserWindow } from 'electron';
import { contextForWindow, mainContext } from '../WindowRegistry';
import { extractPageText } from '../AiPanelManager';
import { extractUrlText } from '../NotebookExtract';
import { clampHistoryLimit, clampPageText, safeOpenUrl, visibleTabs } from '../../shared/mcpPolicy';
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
export async function readUrl(rawUrl: unknown): Promise<McpPageText> {
  const url = safeOpenUrl(rawUrl);
  if (!url) return { ok: false, error: 'Only http(s) addresses can be read.' };
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
  if (!win) return { ok: false, error: 'No browser window is open.' };

  const res = await extractUrlText(win, url);
  if (!res.ok || !res.text?.trim()) {
    return { ok: false, error: 'Could not read this page (it did not load, or has no readable text).' };
  }
  return { ok: true, title: res.title, url, text: clampPageText(res.text) };
}
