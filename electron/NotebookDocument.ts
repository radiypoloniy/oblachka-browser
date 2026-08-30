import { runTabOrganizePrompt } from './TranslationService';
import { normalizeDoc, type DocBlock, type DocSpec } from '../shared/notebookDoc';
import type { ActivityHandle } from './AiActivity';

// Сборка документа-исследования ПО ФАЗАМ.
//
// ⚠️ ПОЧЕМУ НЕ ОДНИМ ПРОГОНОМ — разобрано на живых прогонах, не переоткрывать. Одна просьба
// «собери документ из 14–20 блоков» под общей грамматикой даёт ПЛАН ВМЕСТО ДОКУМЕНТА: 4B-модель
// раз за разом выдавала обложку и семь заголовков подряд, без единого абзаца. Это не лень модели
// и не слабый промпт: схема блока разрешает объект, у которого заполнен только заголовок, значит
// цепочка коротких heading — САМЫЙ ДЕШЁВЫЙ структурно валидный ответ, и жадная выборка идёт по
// нему. Уговаривать бесполезно, пока форма запроса поощряет пустоту.
//
// ⚠️ Лечится ФОРМОЙ ЗАПРОСА, а не текстом просьбы. На фазе наполнения схема — массив СТРОК с
// minItems: грамматика не разрешает туда ничего, кроме прозы, и «отделаться заголовками»
// становится физически недостижимо. Тот же приём, что вытащил виджеты и инфографику: не просить
// модель принять трудное решение, а сделать неверный ответ непредставимым.
//
// ⚠️ Цена — несколько коротких прогонов вместо одного длинного. Токенов генерируется столько же,
// добавляется только повторный разбор контекста; зато каждая просьба простая, а ход работы
// становится честным («раздел 3 из 6» вместо растущего числа знаков, которое ничего не обещает).

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    subtitle: { type: 'string' },
    sections: { type: 'array', minItems: 4, maxItems: 6, items: { type: 'string' } },
  },
} as const;

// ⚠️ minItems: 2 у массива СТРОК — это и есть замок. Массив строк нельзя «заполнить структурой»:
// единственное, что грамматика позволяет сюда положить, — текст.
const SECTION_SCHEMA = {
  type: 'object',
  properties: {
    paragraphs: { type: 'array', minItems: 2, maxItems: 3, items: { type: 'string' } },
  },
} as const;

const NUMBERS_SCHEMA = {
  type: 'object',
  properties: {
    metrics: {
      type: 'array',
      minItems: 2,
      maxItems: 4,
      items: {
        type: 'object',
        properties: { label: { type: 'string' }, value: { type: 'string' } },
      },
    },
  },
} as const;

const POINT_SCHEMA = {
  type: 'object',
  properties: { point: { type: 'string' } },
} as const;

const PLAN_MAX_TOKENS = 320;
const SECTION_MAX_TOKENS = 620;
const SMALL_MAX_TOKENS = 220;

// Контекст на фазу наполнения режем: раздел пишется по своей теме, а не по всему корпусу, и
// полный ввод на каждом из шести прогонов стоил бы времени больше, чем даёт качества.
const SECTION_CONTEXT_MAX = 12_000;

export interface DocSource { title: string; url: string }

async function ask<T>(
  prompt: string,
  schema: unknown,
  maxTokens: number,
  act: ActivityHandle,
  onChars: (n: number) => void,
): Promise<T | null> {
  const res = await runTabOrganizePrompt(prompt, {
    maxTokens, schema, abort: act.signal, onChunk: (t) => onChars(t.length),
  });
  if (!res.ok || act.cancelled) return null;
  try { return JSON.parse(res.out) as T; } catch { return null; }
}

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const cleanList = (v: unknown): string[] =>
  (Array.isArray(v) ? v.map(clean).filter((x) => x.length > 0) : []);

/**
 * Есть ли в источниках числа, о которых вообще имеет смысл спрашивать.
 *
 * ⚠️ Не «любые цифры»: год, номер дома и время есть на любой странице, и по ним модель охотно
 * сочиняет «показатели». Ищем то, что похоже на ИЗМЕРЕНИЕ — с единицей.
 */
function hasNumbers(context: string): boolean {
  return /\d[\d\s.,]*\s*(%|млн|млрд|тыс|тысяч|миллион|миллиард|₽|\$|€|раз|человек|компан)/i.test(context);
}

export async function buildDocument(
  context: string,
  sources: DocSource[],
  act: ActivityHandle,
  onProgress: (chars: number) => void,
): Promise<{ ok: true; doc: DocSpec } | { ok: false; error: string }> {
  let chars = 0;
  const bump = (n: number) => { chars += n; onProgress(chars); act.progress(chars); };
  const short = context.slice(0, SECTION_CONTEXT_MAX);
  const stopped = { ok: false as const, error: 'Сборка остановлена' };

  // ── Фаза 1: план ──────────────────────────────────────────────────────────
  act.note('Продумываю разделы');
  const plan = await ask<{ title?: unknown; subtitle?: unknown; sections?: unknown }>(
    'По приведённым ниже источникам продумай план документа-исследования на русском. '
    + 'Верни название документа (title), одну строку подписи под ним (subtitle) и 4–6 названий '
    + 'разделов (sections) по 2–6 слов каждое. Разделы идут от общего к частному, последний — '
    + 'вывод. Опирайся ТОЛЬКО на источники.\n\n' + context,
    PLAN_SCHEMA, PLAN_MAX_TOKENS, act, bump,
  );
  if (act.cancelled) return stopped;
  const sections = plan ? cleanList(plan.sections) : [];
  if (sections.length === 0) return { ok: false, error: 'Не удалось спланировать документ — попробуйте ещё раз' };

  const title = (plan ? clean(plan.title) : '') || 'Документ';
  const subtitle = plan ? clean(plan.subtitle) : '';
  const blocks: DocBlock[] = [{ kind: 'cover', title, ...(subtitle ? { text: subtitle } : {}) }];

  // ── Фаза 2: числа, и только если в источниках есть что выписывать ─────────
  if (hasNumbers(context)) {
    act.note('Выписываю числа');
    const nums = await ask<{ metrics?: unknown }>(
      'Документ называется «' + title + '». Выпиши из источников 2–4 КОНКРЕТНЫХ числа, которые '
      + 'в них действительно встречаются: label — что это за величина (1–3 слова), value — само '
      + 'число с единицей («37 %», «10 млрд ₽», «1,2 млн»). Ничего не считай и не выдумывай: '
      + 'только то, что написано в тексте.\n\n' + short,
      NUMBERS_SCHEMA, SMALL_MAX_TOKENS, act, bump,
    );
    if (act.cancelled) return stopped;
    const raw = Array.isArray(nums?.metrics) ? (nums.metrics as { label?: unknown; value?: unknown }[]) : [];
    const pairs = raw.map((p) => ({ label: clean(p.label), value: clean(p.value) }))
      .filter((p) => p.label && p.value);
    if (pairs.length >= 2) blocks.push({ kind: 'metrics', pairs });
  }

  // ── Фаза 3: разделы, по одному прогону на каждый ──────────────────────────
  for (let i = 0; i < sections.length; i++) {
    const head = sections[i]!;
    act.note(`Пишу раздел ${i + 1} из ${sections.length}`);
    const filled = await ask<{ paragraphs?: unknown }>(
      'Ты пишешь документ «' + title + '». Напиши 2–3 абзаца для раздела «' + head + '» — и только '
      + 'для него, остальные разделы пишутся отдельно. Каждый абзац — 3–5 предложений связного '
      + 'текста, полными фразами, без списков и без заголовка. Опирайся ТОЛЬКО на источники ниже, '
      + 'ничего не выдумывай.\n\n' + short,
      SECTION_SCHEMA, SECTION_MAX_TOKENS, act, bump,
    );
    if (act.cancelled) return stopped;
    const paragraphs = cleanList(filled?.paragraphs);
    // ⚠️ Раздел без единого абзаца НЕ ставим вовсе. Пустой заголовок — ровно то, из-за чего
    // затевалась вся конструкция; лучше документ на пять разделов, чем на шесть с дырой.
    if (paragraphs.length === 0) continue;
    blocks.push({ kind: 'heading', title: head });
    for (const text of paragraphs) blocks.push({ kind: 'text', text });
  }

  // ── Фаза 4: мысль на память ───────────────────────────────────────────────
  act.note('Ищу главную мысль');
  const point = await ask<{ point?: unknown }>(
    'Документ «' + title + '». Сформулируй ОДНО предложение — главную мысль, которую стоит '
    + 'запомнить. Без вводных слов и без кавычек, до 25 слов. Опирайся только на источники.\n\n' + short,
    POINT_SCHEMA, SMALL_MAX_TOKENS, act, bump,
  );
  if (act.cancelled) return stopped;
  const quote = clean(point?.point);
  // Врезка встаёт ПЕРЕД последним разделом: последний по плану — вывод, и мысль на память перед
  // ним читается подводкой, а после него — повтором того, что только что сказано.
  if (quote) {
    const headings = blocks.map((b, i) => (b.kind === 'heading' ? i : -1)).filter((i) => i >= 0);
    const last = headings[headings.length - 1];
    blocks.splice(last !== undefined && last > 0 ? last : blocks.length, 0, { kind: 'quote', text: quote });
  }

  // ── Источники: НАШИ, а не модели ──────────────────────────────────────────
  // ⚠️ Список источников известен точно — человек сам их добавил. Спрашивать его у модели значит
  // приглашать её выдумать адрес, которого не было; это единственное место документа, где
  // выдумка выглядит как факт и проверяется дольше всего.
  const srcPairs = sources
    .map((s) => ({ label: s.title.trim(), value: s.url.trim() }))
    .filter((p) => p.label || p.value);
  if (srcPairs.length) blocks.push({ kind: 'sources', title: 'Источники', pairs: srcPairs });

  const doc = normalizeDoc({ title, blocks });
  return doc ? { ok: true, doc } : { ok: false, error: 'Не удалось собрать документ — попробуйте ещё раз' };
}
