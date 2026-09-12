// Сборка нейтральной панели омнибокса: строки «Продолжить» и одна полка сайтов.
//
// ⚠️ Потолок «продолжить» — три, не вкусовщина. Полоска сайта + полка + ряд связанных
// уже едят карточку (MAX_HEIGHT 520 в suggestdropdown.tsx); четвёртая строка увозит
// ИИ-карточки во внутренний скролл. Архив — библиотека.
//
// ⚠️ Полка: пока человек набор карандашом не трогал, дефолт Gmail/ChatGPT в панель
// не кладём — это заглушка настроек, не «ваши сайты». Пустой массив после правки
// остаётся пустым и frecency его не подменяет в НАБОРЕ, но частые по-прежнему
// добирают полку: прыжок на сайт со страницы никуда не делся.

import type { ClosedTab } from './closedTabStack';

export const RESUME_MAX = 3;
export const SHELF_MAX = 8;

export interface OtherWindowTab {
  tabId: string;
  windowId: number;
  title: string;
  url: string;
  windowLabel: string;
}

export interface ResumeRow {
  url: string;
  title: string;
  meta: string;
  /** Метка окна — тег, а не время. */
  tagged: boolean;
  tabId?: string;
  windowId?: number;
}

export interface ShelfSite {
  url: string;
  title: string;
}

function originOf(url: string): string {
  try { return new URL(url).origin; } catch { return url; }
}

function isHttp(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

// Тот же ключ страницы, что `normalizeForOmnibox` в frecency.ts. Копия, а не импорт:
// этот модуль гоняется голым node из проверки, а frecency тянет типы истории.
function pageKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) {
      if (/^utm_/i.test(key)) u.searchParams.delete(key);
    }
    let result = u.toString();
    if (result.length > 1 && result.endsWith('/')) result = result.slice(0, -1);
    return result;
  } catch {
    return url;
  }
}

/**
 * Относительное время закрытия. Эталон — литералы в omnibox-resume-check.mjs:
 * пороги 60 с / 60 мин / 24 ч, округление вниз, «вчера» ровно на одном дне.
 */
export function formatClosedAgo(now: number, closedAt: number): string {
  const sec = Math.max(0, Math.floor((now - closedAt) / 1000));
  if (sec < 60) return 'только что';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} мин назад`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ч назад`;
  const day = Math.floor(hr / 24);
  if (day === 1) return 'вчера';
  return `${day} дн. назад`;
}

/**
 * Три строки: сначала свежие закрытые этого окна, потом открытые в других.
 * Текущую страницу и не-http выбрасываем; чужая вкладка с тем же адресом, что
 * уже есть в закрытых, не дублируется.
 */
export function pickResume(
  closed: ClosedTab[],
  other: OtherWindowTab[],
  currentUrl: string,
  now: number,
): ResumeRow[] {
  const current = pageKey(currentUrl);
  const seen = new Set<string>(current ? [current] : []);
  const out: ResumeRow[] = [];

  for (const tab of closed) {
    if (out.length >= RESUME_MAX) break;
    if (!isHttp(tab.url)) continue;
    const key = pageKey(tab.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      url: tab.url,
      title: tab.title || tab.url,
      meta: formatClosedAgo(now, tab.closedAt),
      tagged: false,
    });
  }

  for (const tab of other) {
    if (out.length >= RESUME_MAX) break;
    if (!isHttp(tab.url)) continue;
    const key = pageKey(tab.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      url: tab.url,
      title: tab.title || tab.url,
      meta: tab.windowLabel,
      tagged: true,
      tabId: tab.tabId,
      windowId: tab.windowId,
    });
  }

  return out;
}

/**
 * Одна полка из восьми. `custom === null` — набор не трогали, в полку идут только частые.
 * Непустой custom стоит первыми, частые добирают без повторного origin.
 */
export function mergeOmniboxShelf(
  custom: ShelfSite[] | null,
  frequent: ShelfSite[],
): ShelfSite[] {
  const out: ShelfSite[] = [];
  const seen = new Set<string>();
  const take = (site: ShelfSite) => {
    if (out.length >= SHELF_MAX) return;
    if (!isHttp(site.url)) return;
    const key = originOf(site.url);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(site);
  };
  if (custom) for (const s of custom) take(s);
  for (const s of frequent) take(s);
  return out;
}
