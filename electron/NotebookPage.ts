import { runTabOrganizePrompt } from './TranslationService';
import type { JsonSchema } from '../shared/aiSchema';
import { sanitizeDocHtml, groupSections, markupTextLength, PAGE_MIN_CHARS, type PageSpec } from '../shared/docMarkup';
import { PAGE_LENGTH_SPEC, PAGE_LENGTH_TOKENS, type PageLength, type PageLengthSpec } from '../shared/ipc';
import type { ActivityHandle } from './AiActivity';
/** Источник документа: имя и адрес. Подставляем МЫ — у модели их не спрашиваем. */
export interface DocSource { title: string; url: string }

// Страница: модель пишет ТЕЛО РАЗМЕТКОЙ, стили пишем мы.
//
// ⚠️ Это ЕДИНСТВЕННЫЙ путь. Структурный (модель отдаёт блоки под грамматикой, вёрстку делаем мы)
// проверялся трижды и удалён 30.08: на живых прогонах он давал пустые заголовки без единого
// абзаца. Заводить его заново не надо — разбор причины в shared/docMarkup.ts.
//
// ⚠️ Ключевое отличие: ЗДЕСЬ НЕТ ГРАММАТИКИ на основном прогоне, и это не небрежность. Разбор
// трёх провалов структурного пути — в шапке shared/docMarkup.ts: под грамматикой модель пишет
// не то, что хочет, и поток обрезается по разрешённым ячейкам, давая синтаксически валидный
// мусор. Свободная проза в разметке — её родной жанр, и мешать ей там нечем.
//
// ⚠️ Числа и источники по-прежнему НЕ у модели: числа берутся коротким прогоном под грамматикой
// (он единственный из структурных доказал, что работает), источники подставляем мы. Это те два
// места, где выдумка выглядит как факт.

const HEAD_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    lede: { type: 'string' },
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

const HEAD_MAX_TOKENS = 200;
const NUMBERS_MAX_TOKENS = 220;
// ⚠️ Тело — единственный длинный прогон, и его потолок теперь ВЫБИРАЕТ ЧЕЛОВЕК (три ступени,
// см. PAGE_LENGTH_TOKENS). Раньше здесь стояло фиксированное 3 200 — примерно 7–8 тысяч знаков
// разметки; оно осталось средней ступенью и значением по умолчанию.
//
// ⚠️ Цена верхней ступени — ВРЕМЯ, линейно: 6 000 токенов идут две-три минуты против минуты у
// средней. Про это написано в подписи к настройке, потому что удивляет человека именно оно.

const CONTEXT_MAX = 18_000;

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Не «любые цифры»: год и номер дома есть везде, и по ним модель охотно сочиняет показатели. */
function hasNumbers(context: string): boolean {
  return /\d[\d\s.,]*\s*(%|млн|млрд|тыс|тысяч|миллион|миллиард|₽|\$|€|раз|человек|компан)/i.test(context);
}

/**
 * Просьба к модели под выбранную ступень объёма.
 *
 * ⚠️ Промпт — ФУНКЦИЯ ОТ СТУПЕНИ, а не константа, и это не украшательство. maxTokens — потолок:
 * он умеет только обрезать и никогда не заставляет писать длиннее. Пока просьба была одна на все
 * ступени, модель писала свои примерно пять тысяч знаков при любом выборе, и настройка не делала
 * ничего — ровно это и было замечено сразу: «не увидел разницы между короткой, средней и
 * длинной». Длину задаёт ПРОСЬБА; потолок остался страховкой от заноса.
 */
function buildBodyPrompt(spec: PageLengthSpec): string {
  return [
    'Напиши по приведённым ниже источникам статью на русском языке.',
    '',
    'ФОРМАТ ОТВЕТА — HTML-разметка тела статьи, без <html>, <head>, <body> и без ```.',
    'Разрешены только эти теги: <h2> — заголовок раздела, <p> — абзац, <ul> и <li> — список,',
    '<blockquote> — мысль, которую стоит запомнить, <table>, <tr>, <td> — таблица «параметр —',
    'значение», <strong> — выделение внутри абзаца.',
    'НЕ пиши <h1>: название статьи ставится отдельно. Не пиши стили, классы и ссылки — они',
    'всё равно будут убраны. Не пиши блок с числами и не перечисляй источники в конце: и то,',
    'и другое добавляется автоматически.',
    '',
    `Что должно получиться: ${spec.sections} раздела, в каждом заголовок <h2> и ${spec.paras} `
    + `абзаца <p> по ${spec.sentences} предложений связного текста.`,
    'Один раз по ходу статьи — <blockquote> с главной мыслью.',
    spec.extras
      ? 'Один раз — <ul> с 3–5 короткими пунктами, и, если материал позволяет, одна <table>.'
      : 'Списков и таблиц не надо: в короткой статье они съедают место у текста.',
    'Последний раздел — вывод.',
    '',
    spec.extras
      ? 'Пиши развёрнуто и по существу: это разбор темы, а не аннотация.'
      : 'Пиши плотно: только главное, без разгона и повторов.',
    'Опирайся ТОЛЬКО на источники ниже, ничего не выдумывай.',
  ].join('\n');
}

export async function buildPage(
  context: string,
  sources: DocSource[],
  act: ActivityHandle,
  onProgress: (chars: number) => void,
  // ⚠️ Ступень приходит СНАРУЖИ, а не читается тут из настроек: этот модуль про сборку
  // страницы, а не про то, где живут настройки приложения. Заодно его можно прогнать с любой
  // ступенью, не поднимая SettingsManager.
  // ⚠️ Ступень, а не только число: от неё зависит и потолок, и САМА ПРОСЬБА. Передавать одно
  // число было бы честно ровно наполовину — потолок длины не назначает.
  length: PageLength,
): Promise<{ ok: true; page: PageSpec } | { ok: false; error: string }> {
  let chars = 0;
  const bump = (n: number) => { chars += n; onProgress(chars); act.progress(chars); };
  const short = context.slice(0, CONTEXT_MAX);
  const stopped = { ok: false as const, error: 'Сборка остановлена' };

  // ── Название и подзаголовок ───────────────────────────────────────────────
  act.note('Придумываю название');
  const head = await ask<{ title?: unknown; lede?: unknown }>(
    'По источникам ниже придумай название статьи (title, 4–9 слов) и подзаголовок одной '
    + 'фразой (lede, до 25 слов, объясняет о чём статья и почему это важно). Только по '
    + 'источникам.\n\n' + short,
    HEAD_SCHEMA, HEAD_MAX_TOKENS, act, bump,
  );
  if (act.cancelled) return stopped;
  const title = (head ? clean(head.title) : '') || 'Документ';
  const lede = head ? clean(head.lede) : '';

  // ── Числа ─────────────────────────────────────────────────────────────────
  const stats: { label: string; value: string }[] = [];
  if (hasNumbers(context)) {
    act.note('Выписываю числа');
    const nums = await ask<{ metrics?: unknown }>(
      'Статья называется «' + title + '». Выпиши из источников 2–4 КОНКРЕТНЫХ числа, которые в '
      + 'них действительно встречаются: label — что это за величина (1–3 слова), value — само '
      + 'число с единицей («37 %», «10 млрд ₽», «1,2 млн»). Ничего не считай и не выдумывай.\n\n'
      + short,
      NUMBERS_SCHEMA, NUMBERS_MAX_TOKENS, act, bump,
    );
    if (act.cancelled) return stopped;
    const raw = Array.isArray(nums?.metrics) ? (nums.metrics as { label?: unknown; value?: unknown }[]) : [];
    for (const p of raw) {
      const label = clean(p.label);
      const value = clean(p.value);
      if (label && value) stats.push({ label, value });
    }
  }

  // ── Тело статьи ───────────────────────────────────────────────────────────
  // ⚠️ Без schema. См. шапку файла: грамматика здесь не помогает, а мешает.
  act.note('Пишу статью');
  const res = await runTabOrganizePrompt(buildBodyPrompt(PAGE_LENGTH_SPEC[length]) + '\n\n' + short, {
    maxTokens: PAGE_LENGTH_TOKENS[length],
    abort: act.signal,
    onChunk: (t) => bump(t.length),
  });
  if (act.cancelled) return stopped;
  if (!res.ok) return { ok: false, error: res.error };

  // ⚠️ Разделы оборачиваем МЫ, а не модель: от этого зависит вся раскладка «Издания»
  // (заголовок на поле, липкий в пределах своего раздела) и нумерация во всех трёх.
  const html = groupSections(sanitizeDocHtml(res.out));
  const len = markupTextLength(html);
  console.log(`[Notebook] страница: ответ=${res.out.length} знаков, после очистки=${len}, stop=${res.stopReason}`);
  // ⚠️ Порог, а не «есть хоть что-то»: три абзаца вместо статьи выглядят сбоем, и честнее
  // предложить повтор, чем показать огрызок под видом результата.
  if (len < PAGE_MIN_CHARS) {
    return { ok: false, error: 'Статья вышла слишком короткой — попробуйте ещё раз' };
  }

  return { ok: true, page: { title, lede, html, stats, sources } };
}

async function ask<T>(
  prompt: string,
  schema: JsonSchema,
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
