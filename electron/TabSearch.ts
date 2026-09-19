// Поиск открытой вкладки ПО СМЫСЛУ — «где вкладка про налоги», когда в заголовке написано
// «Расчёт НДФЛ — Госуслуги» и подстрокой это не найти никогда.
//
// ⚠️ Это второй эшелон, а не замена обычному поиску. Совпадение по заголовку/адресу омнибокс
// считает сам, мгновенно и без модели (см. Toolbar.tsx::buildSuggestions); сюда запрос доходит
// ТОЛЬКО когда быстрый путь не нашёл ничего. Иначе каждое нажатие клавиши уезжало бы в очередь
// генерации, а она в проекте одна и общая (withQwenQueue) — человек ждал бы модель ради того,
// что и так найдено подстрокой.
//
// ⚠️ FTS уже сохранённого текста отвечает и при холодной модели. Qwen вызывается только
// когда она тёплая: холодная загрузка 9B — 31 секунда и ~6 ГБ VRAM (замерено).
//
// ⚠️ Формат ответа — одна строка «ANSWER: N», не JSON и не голое число (см. buildPrompt).
//
// ⚠️ Ищем по вкладкам ВСЕХ окон, а не только окна-спрашивающего (AI-IDEAS.md №8). С многооконностью
// «где-то у меня была вкладка про налоги» чаще всего и означает «в другом окне» — там, где глазами
// её точно не видно, то есть ровно там, где поиск нужнее всего. Окна собирает вызывающий (main),
// сюда они приходят готовым списком: модуль о реестре окон не знает.
import type { TabState } from '../shared/ipc';
import { isModelWarm, runTabOrganizePrompt } from './TranslationService';
import type { HistoryManager } from './HistoryManager';
import { TEXT_EXTRACTION_VERSION } from './HistoryManager';
import { normalizeForOmnibox } from '../shared/frecency';
import { makeSearchSnippet } from './SearchSnippet';

/** Вкладка-кандидат вместе с окном, в котором она живёт. */
export interface TabCandidate {
  tab: TabState;
  windowId: number;
}

// Выше этого числа промпт перестаёт быть коротким, а качество отбора падает: модель начинает
// «терять» середину списка. FTS ищет по всем открытым вкладкам до этого ограничения.
const MAX_TABS = 60;
// Ниже этого числа вкладки видны глазами, и звать ради них модель незачем.
// ⚠️ Порог живёт ЗДЕСЬ, а не в омнибоксе, с тех пор как ищем по всем окнам: у окна-спрашивающего
// вкладок может быть две, а всего открыто двадцать — считать «достаточно ли их» по своему окну
// значит молчать ровно в том случае, ради которого поиск по всем окнам и заводился.
const MIN_TABS = 5;
// Сколько вкладок предлагаем. Это подсказка в омнибоксе, а не выдача поисковика: три строки
// человек прочитает, десять — пролистает мимо.
const MAX_HITS = 3;

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// Метка ответа. ⚠️ Не «просто номер» и не JSON: у ответа должен быть словесный префикс, иначе
// модель достраивает нумерованный список вместо ответа (см. историю ниже).
const ANSWER_CUE = 'ANSWER:';

// ⚠️ Промпт ПО-АНГЛИЙСКИ при русском содержимом — и это не вкусовщина, а вывод из трёх замеров
// подряд на живой модели:
//  1) русский промпт «список → задание» — модель переписывала список обратно;
//  2) русский промпт «задание → список → Ответ:» — то же самое плюс ранжирование ВСЕХ вкладок
//     («Ответ: 1, 2, 3, 5, 4»), то есть задача «выбери» не делалась вовсе;
//  3) русский промпт с меткой «Подходит:» — модель применила метку К КАЖДОЙ строке списка и
//     дописала несуществующие вкладки 6–9.
// Английская инструкция — то, на чём в проекте уже держатся перевод и AI-действия
// (см. buildActionPrompt/buildPageBatchPrompt в TranslationService.ts): у этой модели
// инструкции по-английски исполняются заметно надёжнее, а содержимое остаётся русским.
function buildPrompt(query: string, lines: string[]): string {
  return (
    `Browser tabs:\n${lines.join('\n')}\n\n` +
    `The user is looking for ONE of these tabs and describes it as: "${query}".\n` +
    `Decide by MEANING — the words of the request may not appear in the title at all.\n\n` +
    `Reply with a single line: "${ANSWER_CUE} <number>". ` +
    `If no tab matches, reply "${ANSWER_CUE} none". Nothing else.`
  );
}

/**
 * Разбор ответа модели. Отдельно от вызова, потому что тут вся хрупкость: ответ приходит от
 * маленькой модели, и он бывает не тем, о чём просили.
 *
 * ⚠️ Ответ-эхо (продолжение нумерованного списка) отбрасывается ЦЕЛИКОМ, а не разбирается по
 * числам. Иначе это худший из возможных исходов: человек получает три уверенные подсказки,
 * которые на самом деле означают «модель не поняла вопрос».
 */
function parseAnswer(out: string, count: number): number[] {
  // Только строка с меткой. Всё, что модель написала до неё (а она любит переписать список), нас
  // не касается вовсе — и это принципиально: разбирать «любые числа в ответе» означало бы
  // вытаскивать номера из скопированного перечня и выдавать их за выбор модели. Именно так и
  // выглядел первый вариант: три уверенные подсказки, означающие «модель не поняла вопрос».
  const line = new RegExp(`${ANSWER_CUE}\\s*([^\\n]*)`, 'i').exec(out)?.[1]?.trim();
  if (!line || /^(нет|none|no)\b/i.test(line)) return [];
  // Метка есть, но после неё не номер (пересказ, объяснение) — считаем, что ответа нет.
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
 * Ищет вкладки по смыслу запроса среди ВСЕХ переданных кандидатов (окна собирает вызывающий).
 * Возвращает их в порядке уверенности модели.
 *
 * Пустой массив — не нашлось. Если модель холодная, FTS возвращает свои кандидаты напрямую.
 */
export async function searchTabsByMeaning(
  query: string, tabs: TabCandidate[], history?: HistoryManager,
): Promise<TabCandidate[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  // Хаб и пустые вкладки исключаем: искать «новую вкладку» бессмысленно, а модель, увидев их,
  // охотно предлагает именно их — им нечем не подойти.
  const open = tabs.filter((c) => !c.tab.isHub && (c.tab.title.trim() || c.tab.url.trim()));
  const byUrl = new Map<string, TabCandidate[]>();
  for (const candidate of open) {
    if (candidate.tab.incognito) continue;
    const key = normalizeForOmnibox(candidate.tab.url);
    byUrl.set(key, [...(byUrl.get(key) ?? []), candidate]);
  }
  const openUrls = [...new Set(open.filter((candidate) => !candidate.tab.incognito)
    .flatMap((candidate) => [candidate.tab.url, candidate.tab.url.split('#')[0]!]))];
  const matchingChunks = history?.searchOpenTabChunksFts(q, TEXT_EXTRACTION_VERSION, openUrls, MAX_TABS * 8) ?? [];
  const ftsHits: TabCandidate[] = [];
  const snippets = new Map<string, string>();
  const seen = new Set<string>();
  for (const chunk of matchingChunks) {
    const key = normalizeForOmnibox(chunk.url);
    for (const candidate of byUrl.get(key) ?? []) {
      const tabKey = `${candidate.windowId}:${candidate.tab.id}`;
      if (seen.has(tabKey)) continue;
      seen.add(tabKey);
      ftsHits.push(candidate);
      snippets.set(tabKey, makeSearchSnippet(chunk.text, q, 180));
    }
  }
  // FTS может отвечать без модели; заголовки остаются запасным путём при тёплой модели.
  if (!isModelWarm()) return ftsHits.slice(0, MAX_HITS);
  const candidates = [...ftsHits, ...open.filter((candidate) =>
    !seen.has(`${candidate.windowId}:${candidate.tab.id}`),
  )].slice(0, MAX_TABS);
  if (candidates.length < MIN_TABS) return ftsHits.slice(0, MAX_HITS);

  const lines = candidates.map((c, i) => {
    const snippet = snippets.get(`${c.windowId}:${c.tab.id}`);
    return `${i + 1}. ${c.tab.title.trim() || c.tab.url} — ${hostOf(c.tab.url)}` +
      (snippet ? ` | ${snippet}` : '');
  });
  // ⚠️ Фоновая полоса: человек печатает в омнибоксе, а не заказывал генерацию. Если он в этот
  // же момент нажмёт «перевести», перевод пойдёт первым (см. QwenQueue.ts).
  const res = await runTabOrganizePrompt(buildPrompt(q, lines), { role: 'search', background: true });
  if (!res.ok) {
    console.warn('[tab-search] модель не ответила:', res.error);
    return ftsHits.slice(0, MAX_HITS);
  }

  const out = res.out.trim();
  const picked = parseAnswer(out, candidates.length).map((n) => candidates[n - 1]!);
  // Сырой ответ в логе — это номера, не тексты страниц (см. правило логирования в CLAUDE.md), а
  // без него отличить «модель выбрала не то» от «мы не так разобрали» невозможно.
  console.log(`[tab-search] «${q}» → ${picked.length} из ${candidates.length}, ответ модели: ${JSON.stringify(out.slice(0, 120))}`);
  return picked;
}
