// Склейка одного товара с разных сайтов (отслеживание товаров, срез 4).
//
// ⚠️ Слоя два, и порядок несущий:
//  1. КОДЫ (штрихкод, артикул производителя с брендом) — склеиваем САМИ, без вопросов. Правила в
//     shared/productMatch.ts, под прогоном.
//  2. МОДЕЛЬ — только там, где кодов нет, и только ПРЕДЛАГАЕТ. Склеивает человек.
//
// Почему модель не решает сама: ошибка означала бы два разных товара в одной карточке с общим
// графиком цен — то есть враньё ровно в том, ради чего фича существует. Это тот самый случай из
// CLAUDE.md, где ответ модели обязан подтверждать человек.
import type { TrackingStore } from './TrackingStore';
import { sameProductByCodes, worthAsking } from '../shared/productMatch';
import { runTabOrganizePrompt, isModelWarm } from './TranslationService';

// Один разбор за раз: очередь генерации общая, а товары ставят на слежение подряд.
let busy = false;

// ⚠️ Инструкция ПО-АНГЛИЙСКИ при русском содержимом — правило проекта (см. TabSearch.ts).
// ⚠️ Ответ помеченной строкой, а не голым YES/NO: у ответа должна быть метка, иначе модель
// достраивает рассуждение и разбирать его приходится наугад (урок RuleParser).
function buildPrompt(a: string, b: string): string {
  return (
    `Two online shops list a product. Are these the SAME product?\n\n` +
    `A: ${a}\nB: ${b}\n\n` +
    `Same product means: same model, same key specs (capacity, size, colour may be written ` +
    `differently but must not contradict). Different capacity or different model is NOT the same.\n` +
    `Answer with exactly one line: "ANSWER: yes" or "ANSWER: no".`
  );
}

function parseYes(out: string): boolean {
  const line = /ANSWER:\s*([^\n]*)/i.exec(out)?.[1]?.trim().toLowerCase() ?? '';
  return /^(yes|да)\b/.test(line);
}

/**
 * Поискать пару для только что добавленного товара.
 *
 * Сначала коды — они склеивают сразу. Если кодов нет, спрашиваем модель об одном самом похожем
 * кандидате и, если она согласна, кладём ПРЕДЛОЖЕНИЕ; объединит человек.
 *
 * ⚠️ Гейт isModelWarm: человек нажал «отслеживать», а не «поищи мне пару». Будить ради этого 9B
 * нельзя — на холодной модели работает только склейка по кодам, и это честно.
 */
export async function findMatchFor(store: TrackingStore, id: number): Promise<void> {
  const self = store.codesFor(id);
  if (!self) return;
  const others = store.othersFor(id);
  if (others.length === 0) return;

  // 1. Коды — без модели и без спроса.
  for (const other of others) {
    if (sameProductByCodes(self, other)) {
      store.joinGroup(id, other.id);
      console.log(`[tracking] склеено по кодам: ${id} + ${other.id}`);
      return;
    }
  }

  // 2. Модель — только по кандидатам, прошедшим грубый отсев.
  if (busy || !isModelWarm()) return;
  const candidates = others.filter((o) => worthAsking(self.title, o.title));
  if (candidates.length === 0) return;

  busy = true;
  try {
    // Спрашиваем про ОДНОГО кандидата — самого длинного по совпадению названия хватает, а каждый
    // лишний вопрос это отдельный прогон модели (правило «дробить, но не размножать»).
    const other = candidates[0]!;
    const res = await runTabOrganizePrompt(buildPrompt(self.title, other.title), { role: 'page', background: true });
    if (!res.ok) return;
    const yes = parseYes(res.out);
    console.log(`[tracking] пара ${id}+${other.id}: модель ответила ${yes ? 'да' : 'нет'}`);
    if (yes) store.addSuggestion(id, other.id);
  } catch (e) {
    console.warn('[tracking] сопоставление не удалось:', (e as Error).message);
  } finally {
    busy = false;
  }
}
