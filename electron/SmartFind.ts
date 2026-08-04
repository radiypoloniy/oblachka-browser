// Смысловой Ctrl+F — «где тут про возврат денег» на странице, где слова «возврат» нет вовсе,
// а написано «если товар не подошёл, деньги вернутся на карту в течение 10 дней».
//
// ⚠️ ГЛАВНОЕ РЕШЕНИЕ: модель НЕ пишет ответ своими словами и вообще не пишет текст. Она только
// ВЫБИРАЕТ НОМЕР фрагмента из списка, который мы сами собрали со страницы, — а цитату берём из
// своего массива. Отсюда два следствия разом: врать негде (текст физически со страницы, не из
// модели), и у нас на руках готовая строка для штатной подсветки `findInPage`. Попроси мы модель
// «процитировать» — на 9B пришёл бы пересказ с переставленными словами, который findInPage не
// нашёл бы на странице никогда.
//
// ⚠️ Второй эшелон, а не замена обычному Ctrl+F: подстрочный поиск мгновенен и бесплатен, сюда
// человек уходит сам, переключив режим кнопкой. Это явное действие, поэтому — в отличие от
// «поиска вкладки по смыслу» и «вы это уже читали» — гейта `isModelWarm()` тут НЕТ: нажавший
// кнопку вправе подождать загрузку модели (см. правило в CLAUDE.md).
//
// ⚠️ Длинная страница режется на НЕСКОЛЬКО коротких прогонов, а не отдаётся одним куском: как раз
// на длинных страницах (оферта, условия возврата, документация) фича и нужна, а ответ там обычно
// внизу — то есть в один промпт материал не влезает. Правило «дробить работу на короткие прогоны»
// записано в QwenQueue.ts: прервать начатую генерацию node-llama-cpp не даёт, поэтому один
// десятисекундный прогон отменить нельзя, а три двухсекундных — можно не начинать.
import type { WebContents } from 'electron';
import { PAGE_FACTS_SCRIPT } from './pageFacts';
import { runTabOrganizePrompt } from './TranslationService';

// Короче — это подпись, пункт меню или крошки навигации: в них нечего искать по смыслу, а место
// в промпте они съедают.
const MIN_FRAGMENT_CHARS = 40;
// Длиннее — обычно не абзац, а слипшийся блок вёрстки. Обрезаем: для выбора номера хватает начала.
const MAX_FRAGMENT_CHARS = 320;
// Сколько фрагментов вообще собираем со страницы (дальше уже не читает и человек).
const MAX_FRAGMENTS = 240;
// Бюджет одного прогона по символам материала. ~6000 симв. ≈ 2k токенов — короткий промпт,
// на котором эта модель ещё уверенно выбирает, а не «теряет середину списка».
const BATCH_CHARS = 6000;
// Потолок прогонов. Три — это уже до ~18 000 символов страницы; больше человек не станет ждать.
const MAX_BATCHES = 3;

// Метка ответа. ⚠️ Не голое число и не JSON — урок, оплаченный замерами (см. TabSearch.ts):
// без словесной метки модель достраивает нумерованный список вместо ответа.
const ANSWER_CUE = 'ANSWER:';

/**
 * Сбор фрагментов с ЖИВОЙ страницы.
 *
 * ⚠️ Именно с живой, а не через `extractPageText`: тот отдаёт текст с ОЧИЩЕННОГО КЛОНА плюс
 * синтетическую карточку фактов («Название: …»), то есть строки, которых на странице может не быть
 * дословно. Для показа модели этого хватает, а для подсветки — нет: `findInPage` ищет по реальному
 * DOM. Поэтому берём innerText видимых блоков как есть.
 * ⚠️ Чистку от обвязки и отзывов переиспользуем из `pageFacts.ts` (`__oblakoJunkNodes`) — своих
 * эвристик «что тут мусор» не заводим, они там уже выстраданы на живых страницах.
 * ⚠️ Невидимые блоки пропускаем: подсветить то, чего не видно, нельзя — человек получил бы
 * «нашлось» без единого видимого следа.
 */
const FRAGMENTS_SCRIPT = `(function(){
  ${PAGE_FACTS_SCRIPT}

  var junk = [];
  try { junk = __oblakoJunkNodes(); } catch (e) { junk = []; }
  // Помечаем атрибутом — так предок проверяется одним closest(), без обхода вручную (тот же приём,
  // что в buildExtractionScript). Страница пользователя, поэтому метки снимаем ниже безусловно.
  for (var m = 0; m < junk.length; m++) {
    try { junk[m].setAttribute('data-oblako-junk', '1'); } catch (e) { /* узел исчез */ }
  }

  var out = [];
  try {
    var SEL = 'p, li, dd, dt, td, th, h1, h2, h3, h4, h5, h6, blockquote, figcaption, pre, summary';
    var nodes = document.body ? document.body.querySelectorAll(SEL) : [];
    var seen = Object.create(null);
    var section = '';
    for (var n = 0; n < nodes.length; n++) {
      var el = nodes[n];
      try { if (el.closest('[data-oblako-junk]')) continue; } catch (e) { /* closest нет — берём */ }
      var r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      var t = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
      // Заголовок сам фрагментом не становится — он запоминается как НАЗВАНИЕ РАЗДЕЛА для тех,
      // что идут ниже. Порядок querySelectorAll документный, поэтому «ниже» тут буквально.
      if (/^H[1-6]$/.test(el.tagName)) { section = t.slice(0, 80); continue; }
      if (t.length < ${MIN_FRAGMENT_CHARS}) continue;
      // Вложенные блоки (li > p, td > p) дают один и тот же текст дважды — по началу и дедупим.
      var key = t.slice(0, 120);
      if (seen[key]) continue;
      seen[key] = 1;
      out.push({ text: t.slice(0, ${MAX_FRAGMENT_CHARS}), section: section });
      if (out.length >= ${MAX_FRAGMENTS}) break;
    }
  } catch (e) { /* нестандартная вёрстка — отдаём, что успели собрать */ }

  for (var u = 0; u < junk.length; u++) {
    try { junk[u].removeAttribute('data-oblako-junk'); } catch (e) { /* узел исчез */ }
  }
  return out;
})()`;

export type SmartFindFailure = 'no-text' | 'not-found' | 'model-error';

export type SmartFindPick =
  | { ok: true; quote: string; scanned: number; total: number }
  | { ok: false; reason: SmartFindFailure; error?: string };

// Фрагмент страницы: сам текст (он же будущая цитата) и НАЗВАНИЕ РАЗДЕЛА, под которым он стоит.
// ⚠️ Раздел — не украшение промпта: без него модель выбирает по совпадению слов, а не по смыслу.
// Замер на оферте магазина: на вопрос «сколько ждать курьера» без разделов выбирался абзац про
// осмотр посылки «в присутствии КУРЬЕРА», а нужный жил под заголовком «Доставка».
interface Fragment { text: string; section: string }
type NumberedFragment = Fragment & { n: number };

/** Фрагменты страницы, пронумерованные глобально (номер переживает разбиение на прогоны). */
async function collectFragments(wc: WebContents): Promise<Fragment[]> {
  try {
    const res: unknown = await wc.executeJavaScript(FRAGMENTS_SCRIPT, true);
    if (!Array.isArray(res)) return [];
    return res
      .filter((x): x is Fragment => !!x && typeof x.text === 'string' && x.text.length >= MIN_FRAGMENT_CHARS)
      .map((x) => ({ text: x.text, section: typeof x.section === 'string' ? x.section : '' }));
  } catch (e) {
    console.warn('[smart-find] не удалось собрать фрагменты:', e);
    return [];
  }
}

/** Разбиение на прогоны по бюджету символов. Номера остаются сквозными — их вернёт модель. */
function toBatches(fragments: Fragment[]): NumberedFragment[][] {
  const batches: NumberedFragment[][] = [];
  let current: NumberedFragment[] = [];
  let size = 0;
  for (let i = 0; i < fragments.length; i++) {
    const frag = fragments[i]!;
    const text = frag.text;
    if (current.length > 0 && size + text.length > BATCH_CHARS) {
      batches.push(current);
      if (batches.length >= MAX_BATCHES) return batches;
      current = [];
      size = 0;
    }
    current.push({ n: i + 1, ...frag });
    size += text.length;
  }
  if (current.length > 0) batches.push(current);
  return batches.slice(0, MAX_BATCHES);
}

// ⚠️ Инструкция ПО-АНГЛИЙСКИ при русском содержимом — то же, на чём держатся перевод, AI-действия
// и поиск вкладки по смыслу. Русские формулировки на этой модели заставляют её переписывать
// список обратно вместо выбора (три замера подряд, см. TabSearch.ts).
function buildPrompt(query: string, batch: NumberedFragment[]): string {
  // Раздел идёт в квадратных скобках ПЕРЕД текстом: так модель видит, к чему абзац относится,
  // а цитатой наружу уходит по-прежнему только сам текст.
  const lines = batch.map((f) => `${f.n}. ${f.section ? `[${f.section}] ` : ''}${f.text}`).join('\n');
  return (
    `Fragments of a web page:\n${lines}\n\n` +
    `The user asks where the page talks about: "${query}".\n` +
    `Pick the ONE fragment that answers it. Decide by MEANING — the words of the question may ` +
    `not appear in the fragment at all.\n\n` +
    `Reply with a single line: "${ANSWER_CUE} <number>". ` +
    `If no fragment answers it, reply "${ANSWER_CUE} none". Nothing else.`
  );
}

/**
 * Разбор ответа. ⚠️ Только строка ПОСЛЕ метки: «любые числа в ответе» вытаскивали бы номера из
 * списка, который модель любит переписать, и выдавали бы их за её выбор. Пустой ответ честнее
 * выдуманного — тут особенно, потому что за ним последует прыжок страницы к чужому абзацу.
 */
function parseAnswer(out: string, allowed: Set<number>): number | null {
  const line = new RegExp(`${ANSWER_CUE}\\s*([^\\n]*)`, 'i').exec(out)?.[1]?.trim();
  if (!line || /^(нет|none|no)\b/i.test(line)) return null;
  const m = /^\d+/.exec(line);
  if (!m) return null;
  const n = Number(m[0]);
  return allowed.has(n) ? n : null;
}

/**
 * Ищет на странице фрагмент, отвечающий на вопрос. Возвращает ЦИТАТУ со страницы — её же потом
 * подсвечивает `TabManager.findQuoteInPage`.
 */
export async function pickFragmentByMeaning(wc: WebContents | null, query: string): Promise<SmartFindPick> {
  const q = query.trim();
  if (!wc || wc.isDestroyed() || q.length < 3) return { ok: false, reason: 'no-text' };

  const fragments = await collectFragments(wc);
  if (fragments.length === 0) return { ok: false, reason: 'no-text' };

  const batches = toBatches(fragments);
  let scanned = 0;
  for (const batch of batches) {
    scanned += batch.length;
    const allowed = new Set(batch.map((f) => f.n));
    const res = await runTabOrganizePrompt(buildPrompt(q, batch));
    if (!res.ok) {
      console.warn('[smart-find] модель не ответила:', res.error);
      return { ok: false, reason: 'model-error', error: res.error };
    }
    const picked = parseAnswer(res.out.trim(), allowed);
    console.log(
      `[smart-find] «${q.slice(0, 40)}» фрагменты ${batch[0]!.n}–${batch[batch.length - 1]!.n}: ` +
      `ответ модели ${JSON.stringify(res.out.trim().slice(0, 60))}`,
    );
    // Нашлось — дальше не идём: остальные прогоны стоили бы времени человека впустую.
    if (picked !== null) return { ok: true, quote: fragments[picked - 1]!.text, scanned, total: fragments.length };
  }
  return { ok: false, reason: 'not-found' };
}

/**
 * Строки-кандидаты для подсветки, от длинной к короткой.
 *
 * ⚠️ Лесенка, а не одна строка: цитата собрана из `innerText`, где пробелы уже схлопнуты, а на
 * странице тот же текст может быть разорван вёрсткой (перенос строки внутри абзаца, вставленный
 * `<span>` со своим отступом). Длинная строка тогда не находится, а короткая — находится. Первое
 * предложение целиком пробуем первым: чем длиннее совпадение, тем точнее место.
 */
export function highlightCandidates(quote: string): string[] {
  const clean = quote.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  // Первое предложение — естественная граница; если его нет, режем по словам.
  const sentence = /^[^.!?…]{20,}?[.!?…]/.exec(clean)?.[0] ?? clean;
  const out: string[] = [];
  for (const limit of [90, 40, 20]) {
    const src = limit <= sentence.length ? sentence : clean;
    const cut = src.slice(0, limit);
    // По границе слова — обрубок посреди слова findInPage нашёл бы, но подсветил бы половину слова.
    const trimmed = cut.length < src.length ? cut.replace(/\s+\S*$/, '') : cut;
    const candidate = trimmed.trim();
    if (candidate.length >= 8 && !out.includes(candidate)) out.push(candidate);
  }
  return out;
}
