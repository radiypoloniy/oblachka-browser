// Поиск по настройкам ФРАЗОЙ — ВТОРОЙ эшелон к поиску по ключевым словам (AI-IDEAS.md №6).
//
// ⚠️ Основной путь — `searchSettings` в shared/settingsIndex.ts: мгновенный, без модели и без
// обращений в main. Сюда запрос доходит, ТОЛЬКО когда ключевые слова не нашли ничего («сделать
// шрифт крупнее», «почему сайт банка не открывается»). Ровно так же устроен AutofillFieldMapper:
// модель заполняет пробелы эвристики, а не заменяет её.
//
// ⚠️ Модель ВЫБИРАЕТ номер из нашего же реестра, а не пишет ответ. Значит открыть можно только
// существующий раздел: выдуманных настроек в выдаче не появится в принципе.
import { SETTINGS_INDEX } from '../shared/settingsIndex';
import { runTabOrganizePrompt, isModelWarm } from './TranslationService';

const ANSWER_CUE = 'ANSWER:';
// Сколько находок предлагаем. Это подсказка под строкой поиска, а не выдача поисковика.
const MAX_HITS = 3;

// ⚠️ Инструкция ПО-АНГЛИЙСКИ при русском содержимом — правило проекта, выведенное замерами
// (см. TabSearch.ts): на задачах выбора из списка русская формулировка заставляет модель
// переписывать список обратно вместо ответа.
function buildPrompt(query: string, lines: string[]): string {
  return (
    `Browser settings:\n${lines.join('\n')}\n\n` +
    `The user wants to change something and describes it as: "${query}".\n` +
    `Decide by MEANING — the words of the request may not appear in the setting name at all.\n\n` +
    `Reply with a single line: "${ANSWER_CUE} <number>". ` +
    `If nothing fits, reply "${ANSWER_CUE} none". Nothing else.`
  );
}

/**
 * ⚠️ Разбираем ТОЛЬКО строку после метки. «Любые числа в ответе» вытаскивали бы номера из
 * списка, который модель охотно переписывает, и выдавали их за её выбор — три уверенные
 * подсказки, означающие «модель не поняла вопрос» (урок TabSearch.parseAnswer).
 */
function parseAnswer(out: string, count: number): number[] {
  const line = new RegExp(`${ANSWER_CUE}\\s*([^\\n]*)`, 'i').exec(out)?.[1]?.trim();
  if (!line || /^(нет|none|no)\b/i.test(line)) return [];
  if (!/^[\d\s,;и]+$/i.test(line) || line.length > 24) return [];

  const seen = new Set<number>();
  const picked: number[] = [];
  for (const m of line.matchAll(/\d+/g)) {
    const n = Number(m[0]);
    if (!Number.isInteger(n) || n < 1 || n > count || seen.has(n)) continue;
    seen.add(n);
    picked.push(n);
    if (picked.length >= MAX_HITS) break;
  }
  return picked;
}

/**
 * Ищет настройку по смыслу фразы. Возвращает индексы записей SETTINGS_INDEX.
 *
 * Пустой массив — «не нашлось» и «модели нет» одновременно: для строки поиска это одно и то же,
 * подсказок просто не появится.
 *
 * ⚠️ Гейт isModelWarm — как у подсказок омнибокса: человек печатает в поле поиска, а не заказывал
 * генерацию, и будить ради этого 9B на полминуты нельзя. Пока модель холодная, работает только
 * поиск по ключевым словам — то есть фича остаётся рабочей, просто без второго эшелона.
 */
export async function searchSettingsByMeaning(query: string): Promise<number[]> {
  const q = query.trim();
  if (q.length < 4 || !isModelWarm()) return [];

  const lines = SETTINGS_INDEX.map((e, i) => `${i + 1}. ${e.label} (раздел «${e.sectionLabel}»)`);
  // Фоновая полоса: человек печатает, а не нажал кнопку. Если он в этот же момент закажет
  // перевод, перевод пойдёт первым (см. QwenQueue.ts).
  const res = await runTabOrganizePrompt(buildPrompt(q, lines), { role: 'search', background: true });
  if (!res.ok) {
    console.warn('[settings-search] модель не ответила:', res.error);
    return [];
  }

  const out = res.out.trim();
  const idx = parseAnswer(out, SETTINGS_INDEX.length).map((n) => n - 1);
  console.log(`[settings-search] «${q}» → ${idx.map((i) => SETTINGS_INDEX[i]!.label).join(', ') || 'ничего'}, ответ модели: ${JSON.stringify(out.slice(0, 100))}`);
  return idx;
}
