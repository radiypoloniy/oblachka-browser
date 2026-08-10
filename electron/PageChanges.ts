// «Что изменилось с прошлого раза» (AI-IDEAS.md №7) — страница, которую человек уже читал,
// сравнивается со снимком из индекса истории.
//
// ⚠️ Разделение труда здесь такое же, как в правилах-автоматизациях: почти всё делает обычный код,
// модель участвует ровно один раз и только НАЗЫВАЕТ уже найденное изменение одной фразой. Сам diff
// и весь отсев шума — в shared/textDiff.ts (без импортов, под прогон npm run text-diff-check).
//
// ⚠️ Снимок берётся из history_content_chunks и ПЕРЕЗАПИСЫВАЕТСЯ после того, как мы рассказали об
// изменении. Без этого «с прошлого раза» врало бы: индексация идемпотентна (см. HistoryIndexer —
// повторный визит уже проиндексированной страницы no-op), снимок остался бы вечно первым, и одно
// и то же изменение показывалось бы человеку на каждом визите до скончания времён.
import type { WebContents } from 'electron';
import type { HistoryManager } from './HistoryManager';
import { TEXT_EXTRACTION_VERSION } from './HistoryManager';
import { buildTextChunks, extractEnrichedText } from './HistoryIndexer';
import { diffPageText, type PageChange } from '../shared/textDiff';
import { runTabOrganizePrompt, isModelWarm } from './TranslationService';

export interface PageChangesResult {
  /** Нашлось ли осмысленное изменение. false — и «не менялось», и «сравнивать не с чем». */
  changed: boolean;
  /** Фраза от модели. Пусто — модель холодная или промолчала; тогда показываем сам факт. */
  summary?: string;
  /** Отобранные куски — на случай, если фразы нет: показать хотя бы первое изменение. */
  pieces?: PageChange[];
}

const NOTHING: PageChangesResult = { changed: false };

// Один разбор за раз: человек может щёлкать замочком подряд, а очередь генерации общая.
let busy = false;

// ⚠️ Инструкция ПО-АНГЛИЙСКИ при русском содержимом — правило проекта (см. TabSearch.ts).
// ⚠️ Модель получает ТОЛЬКО отобранные куски, а не страницу: вход короткий, выход короткий.
function buildPrompt(pieces: PageChange[]): string {
  const lines = pieces.map((p, i) => {
    if (!p.before) return `${i + 1}. ADDED: ${p.after}`;
    if (!p.after) return `${i + 1}. REMOVED: ${p.before}`;
    return `${i + 1}. WAS: ${p.before}\n   NOW: ${p.after}`;
  });
  return (
    `A page the user read earlier has changed. The changes:\n${lines.join('\n')}\n\n` +
    `Say in ONE short Russian phrase what changed, as a person would tell a friend ` +
    `("изменилась цена и срок доставки", "добавили раздел о гарантии").\n` +
    `- Up to 100 characters. No quotes, no explanations, no list.\n` +
    // ⚠️ Отказ обязан быть законным ответом: если изменения косметические, честное молчание
    // полезнее выдуманной важности (то же правило, что у прочерка в разборе адреса).
    `- If the changes are cosmetic and not worth telling, answer exactly: NONE\n\n` +
    `Answer with the phrase only.`
  );
}

function cleanSummary(raw: string): string {
  let s = raw.trim().split(/\r?\n/)[0]?.trim() ?? '';
  s = s.replace(/^(изменени[ея]|ответ|answer)\s*[:—-]\s*/i, '');
  s = s.replace(/^["'«»„“]+|["'«»„“.]+$/g, '').trim();
  if (!s || /^none$/i.test(s)) return '';
  // Длинную фразу не режем, а отбрасываем: обрывок на середине слова хуже отсутствия подписи
  // (урок TabRenamer).
  return s.length <= 100 ? s : '';
}

/**
 * Считает, что изменилось на странице с прошлого визита.
 *
 * ⚠️ Зовётся по ЯВНОМУ действию (открытие поповера сведений о сайте), но сама по себе фича
 * незаказанная, поэтому модель — только тёплая и фоновой полосой. На холодной вернём факт
 * изменения без фразы: «страница изменилась» и сами куски человеку уже полезны, а будить ради
 * подписи 9B на полминуты нельзя.
 */
export async function getPageChanges(
  history: HistoryManager,
  url: string,
  wc: WebContents | null,
): Promise<PageChangesResult> {
  if (busy || !url || !/^https?:/i.test(url)) return NOTHING;

  const historyId = history.getIdByUrl(url);
  if (historyId === null) return NOTHING;
  const before = history.getContentText(historyId, TEXT_EXTRACTION_VERSION);
  if (!before) return NOTHING; // страницу не индексировали — сравнивать не с чем

  busy = true;
  try {
    const after = await extractEnrichedText(wc, url);
    if (!after) return NOTHING;

    const diff = diffPageText(before, after);
    if (!diff.changed) return NOTHING;

    // ⚠️ Снимок обновляем СРАЗУ после успешного сравнения, а не после ответа модели: рассказать
    // об изменении мы уже готовы, а фраза — необязательное украшение. Заодно свежеет и текст для
    // поиска по истории: страница изменилась, а в индексе лежала её старая версия.
    const chunks = buildTextChunks(after).map((text, i) => ({
      chunkIndex: i, url, title: '', text, vector: new Float32Array(0), dims: 0,
    }));
    history.saveContentChunks(historyId, chunks, TEXT_EXTRACTION_VERSION);

    let summary = '';
    if (isModelWarm()) {
      const res = await runTabOrganizePrompt(buildPrompt(diff.pieces), { background: true });
      if (res.ok) summary = cleanSummary(res.out);
      else console.warn('[page-changes] модель не ответила:', res.error);
    }
    // В лог — сколько кусков и есть ли фраза. Сам текст страницы человека в логах не место.
    console.log(`[page-changes] ${diff.pieces.length} изменений, фраза: ${summary ? 'есть' : 'нет'}`);
    return { changed: true, summary: summary || undefined, pieces: diff.pieces };
  } catch (e) {
    console.warn('[page-changes] ошибка:', (e as Error).message);
    return NOTHING;
  } finally {
    busy = false;
  }
}
