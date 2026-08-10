// «Куда я это дел» (AI-IDEAS.md №4) — один вопрос по СВОИМ данным сразу: история, закладки,
// загрузки.
//
// Зачем. Сегодня человек должен заранее знать, в каком из трёх мест лежит ответ: статью он читал
// (история), ссылку сохранял (закладки) или файл скачивал (загрузки). Вопрос у него при этом
// один — «где та штука про ипотеку».
//
// ⚠️ Кандидатов собирает КОД, модель только переранжирует и отсекает — та же схема, что в
// HistorySearch.ts, просто источников три вместо одного. Модель ничего не пишет и ничего не
// выдумывает: всё, что она может, — назвать номера из нашего же списка.
//
// ⚠️ Кандидаты истории берутся ТЕМ ЖЕ collectHistoryCandidates, что и в умном поиске истории, а не
// своей второй копией логики: лексика + FTS + дедуп по странице там уже выстраданы.
import type { HistoryManager } from './HistoryManager';
import type { BookmarkManager } from './BookmarkManager';
import type { DownloadManager } from './DownloadManager';
import type { BookmarkNode, StuffHit } from '../shared/ipc';
import { collectHistoryCandidates } from './HistorySearch';
import { rerankHistoryCandidates } from './TranslationService';

// Сколько кандидатов даём модели. Больше — промпт перестаёт быть коротким, и качество отбора падает
// (тот же потолок, что у умного поиска истории).
const MAX_CANDIDATES = 24;
const MAX_PER_SOURCE = 8;

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// ⚠️ «ё» к «е» — иначе «ипотёка» и «ипотека» разные слова; та же нормализация, что в поиске по
// настройкам. Слова короче трёх букв не ищем: они совпадают со всем подряд.
function tokensOf(query: string): string[] {
  return query.toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-я0-9]+/).filter((t) => t.length >= 3);
}

function matches(haystack: string, tokens: string[]): boolean {
  const hay = haystack.toLowerCase().replace(/ё/g, 'е');
  return tokens.some((t) => hay.includes(t));
}

/** Плоский список закладок из дерева — папки сами по себе ответом быть не могут. */
function flattenBookmarks(nodes: BookmarkNode[], out: BookmarkNode[] = []): BookmarkNode[] {
  for (const n of nodes) {
    if (n.kind === 'link') out.push(n);
    if (n.children) flattenBookmarks(n.children, out);
  }
  return out;
}

/**
 * Ищет по истории, закладкам и загрузкам сразу.
 *
 * ⚠️ Зовётся по ЯВНОМУ действию (Enter в строке поиска), поэтому гейта isModelWarm тут нет и
 * полоса пользовательская: человек нажал и ждёт — такое действие вправе ждать загрузку модели
 * (то же решение, что у смыслового Ctrl+F).
 *
 * Отказ модели — не отказ поиска: отдаём то, что нашёл код, пометив `degraded`. Найденное
 * подстрокой полезно и без переранжирования.
 */
export async function searchStuff(
  history: HistoryManager,
  bookmarks: BookmarkManager,
  downloads: DownloadManager,
  query: string,
  limit = 12,
): Promise<{ hits: StuffHit[]; degraded: boolean }> {
  const q = query.trim();
  const tokens = tokensOf(q);
  if (!q || tokens.length === 0) return { hits: [], degraded: false };

  const hits: StuffHit[] = [];

  // История — тем же сбором, что у умного поиска.
  for (const c of collectHistoryCandidates(history, q).slice(0, MAX_PER_SOURCE * 2)) {
    hits.push({
      kind: 'history',
      title: c.title || c.url,
      url: c.url,
      subtitle: hostOf(c.url),
      snippet: c.snippet,
    });
  }

  // Закладки — простое совпадение по заголовку и адресу: их немного, и они уже отобраны человеком.
  try {
    for (const b of flattenBookmarks(bookmarks.listTree())) {
      if (!matches(`${b.title} ${b.url}`, tokens)) continue;
      hits.push({ kind: 'bookmark', title: b.title || b.url, url: b.url, subtitle: hostOf(b.url) });
      if (hits.filter((h) => h.kind === 'bookmark').length >= MAX_PER_SOURCE) break;
    }
  } catch (e) {
    console.warn('[stuff-search] закладки не прочитались:', (e as Error).message);
  }

  // Загрузки — по имени файла. ⚠️ Пропавшие с диска не предлагаем: «нашлось» без возможности
  // открыть хуже, чем не нашлось вовсе.
  try {
    let taken = 0;
    for (const d of downloads.getAll()) {
      if (d.state !== 'completed' || !d.savePath || d.fileMissing) continue;
      if (!matches(d.filename, tokens)) continue;
      // ⚠️ Подпись загрузки — ДАТА, а не домен источника. Домен у файлов почти всегда бессмысленная
      // раздача («doc-0g-6k-docstext.googleusercontent.com» вместо Google Docs) — он не помогает
      // узнать файл, а место в строке занимает. «Когда я это скачал» человек помнит, «с какой CDN» — нет.
      const when = new Date(d.startedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
      hits.push({ kind: 'download', title: d.filename, url: d.savePath, subtitle: when, downloadId: d.id });
      if (++taken >= MAX_PER_SOURCE) break;
    }
  } catch (e) {
    console.warn('[stuff-search] загрузки не прочитались:', (e as Error).message);
  }

  const candidates = hits.slice(0, MAX_CANDIDATES);
  if (candidates.length === 0) return { hits: [], degraded: false };

  try {
    // ⚠️ Тот же реранкер, что у истории. Он ждёт кандидатов с id/title/url/snippet — id тут
    // синтетический (позиция в списке), потому что у трёх источников свои нумерации и общего
    // идентификатора нет; наружу он не отдаётся.
    const order = await rerankHistoryCandidates(q, candidates.map((c, i) => ({
      id: i,
      title: c.title,
      url: c.url,
      score: 1,
      snippet: c.snippet,
    })));
    // ⚠️ Модель ответила, но не выбрала НИЧЕГО — это тоже «выдача не отобрана моделью», и метка
    // обязана быть той же, что при её отказе. Иначе экран молчит про модель, показывая при этом
    // сырое совпадение по словам, — то есть выдаёт список кода за её выбор.
    if (order.length === 0) return { hits: candidates.slice(0, limit), degraded: true };
    console.log(`[stuff-search] «${q}»: кандидатов ${candidates.length}, оставлено ${order.length}`);
    return { hits: order.slice(0, limit).map((i) => candidates[i]!).filter(Boolean), degraded: false };
  } catch (e) {
    console.warn('[stuff-search] реранк не удался, отдаю найденное кодом:', (e as Error).message);
    return { hits: candidates.slice(0, limit), degraded: true };
  }
}
