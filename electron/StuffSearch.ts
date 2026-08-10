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
import { queryTokens, countMatches } from '../shared/wordMatch';
import { rerankHistoryCandidates } from './TranslationService';

// Сколько кандидатов даём модели. Больше — промпт перестаёт быть коротким, и качество отбора падает
// (тот же потолок, что у умного поиска истории).
const MAX_CANDIDATES = 24;
const MAX_PER_SOURCE = 8;

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// ⚠️ Сопоставление — в shared/wordMatch.ts, и это не украшение архитектуры, а починка. Здесь была
// обычная подстрока, и она не знает русских склонений: файл «отчет по исследованию.docx» не
// находился ни по «исследования», ни по «исследование» (поймано на живом профиле). История это
// переживала сама — у FTS5 свой стеммер, — а закладки и загрузки оставались слепыми.

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
  const tokens = queryTokens(q);
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

  // Закладки — совпадение по заголовку и адресу: их немного, и они уже отобраны человеком.
  // ⚠️ Берём ЛУЧШИЕ по числу совпавших слов, а не первые попавшиеся: место в квоте источника
  // ограничено, и раньше его занимал кто успел — на живом профиле закладка, совпавшая одним
  // частым словом («документ»), вытесняла то, что человек искал.
  try {
    const scored = flattenBookmarks(bookmarks.listTree())
      .map((b) => ({ b, score: countMatches(`${b.title} ${b.url}`, tokens) }))
      .filter((x) => x.score > 0)
      .sort((a, z) => z.score - a.score)
      .slice(0, MAX_PER_SOURCE);
    for (const { b } of scored) {
      hits.push({ kind: 'bookmark', title: b.title || b.url, url: b.url, subtitle: hostOf(b.url) });
    }
  } catch (e) {
    console.warn('[stuff-search] закладки не прочитались:', (e as Error).message);
  }

  // Загрузки — по имени файла. ⚠️ Пропавшие с диска не предлагаем: «нашлось» без возможности
  // открыть хуже, чем не нашлось вовсе.
  try {
    const scored = downloads.getAll()
      .filter((d) => d.state === 'completed' && d.savePath && !d.fileMissing)
      .map((d) => ({ d, score: countMatches(d.filename, tokens) }))
      .filter((x) => x.score > 0)
      .sort((a, z) => z.score - a.score)
      .slice(0, MAX_PER_SOURCE);
    for (const { d } of scored) {
      // ⚠️ Подпись загрузки — ДАТА, а не домен источника. Домен у файлов почти всегда бессмысленная
      // раздача («doc-0g-6k-docstext.googleusercontent.com» вместо Google Docs) — он не помогает
      // узнать файл, а место в строке занимает. «Когда я это скачал» человек помнит, «с какой CDN» — нет.
      const when = new Date(d.startedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
      hits.push({ kind: 'download', title: d.filename, url: d.savePath, subtitle: when, downloadId: d.id });
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
