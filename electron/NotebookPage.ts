import { runTabOrganizePrompt } from './TranslationService';
import { sanitizeDocHtml, groupSections, markupTextLength, PAGE_MIN_CHARS, type PageSpec } from '../shared/docMarkup';
import type { ActivityHandle } from './AiActivity';
import type { DocSource } from './NotebookDocument';

// Страница: модель пишет ТЕЛО РАЗМЕТКОЙ, стили пишем мы.
//
// ⚠️ Это второй, принципиально другой путь рядом с NotebookDocument.ts, а не замена ему. Пока не
// проверено на живых источниках, кто из них лучше, оба живут рядом кнопками в Студии. Проиграет
// один — второй удаляется целиком; сейчас удалять что-либо значило бы гадать.
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
// ⚠️ Тело — единственный длинный прогон. 3 200 токенов это примерно 7–8 тысяч знаков разметки,
// то есть статья на 5–6 тысяч знаков текста плюс теги. Больше ставить незачем: дальше растёт
// не глубина, а вода.
const BODY_MAX_TOKENS = 3200;

const CONTEXT_MAX = 18_000;

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Те же числа, что и в NotebookDocument: не «любые цифры», а похожее на измерение. */
function hasNumbers(context: string): boolean {
  return /\d[\d\s.,]*\s*(%|млн|млрд|тыс|тысяч|миллион|миллиард|₽|\$|€|раз|человек|компан)/i.test(context);
}

const BODY_PROMPT = [
  'Напиши по приведённым ниже источникам подробную статью на русском языке.',
  '',
  'ФОРМАТ ОТВЕТА — HTML-разметка тела статьи, без <html>, <head>, <body> и без ```.',
  'Разрешены только эти теги: <h2> — заголовок раздела, <p> — абзац, <ul> и <li> — список,',
  '<blockquote> — мысль, которую стоит запомнить, <table>, <tr>, <td> — таблица «параметр —',
  'значение», <strong> — выделение внутри абзаца.',
  'НЕ пиши <h1>: название статьи ставится отдельно. Не пиши стили, классы и ссылки — они',
  'всё равно будут убраны. Не пиши блок с числами и не перечисляй источники в конце: и то,',
  'и другое добавляется автоматически.',
  '',
  'Что должно получиться: 4–6 разделов, в каждом заголовок <h2> и один-два абзаца <p> по',
  '4–6 предложений связного текста. Один раз по ходу статьи — <blockquote> с главной мыслью,',
  'один раз — <ul> с 3–5 короткими пунктами, и, если материал позволяет, одна <table>.',
  'Последний раздел — вывод.',
  '',
  'Пиши развёрнуто и по существу: это разбор темы, а не аннотация. Опирайся ТОЛЬКО на',
  'источники ниже, ничего не выдумывай.',
].join('\n');

export async function buildPage(
  context: string,
  sources: DocSource[],
  act: ActivityHandle,
  onProgress: (chars: number) => void,
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
  const res = await runTabOrganizePrompt(BODY_PROMPT + '\n\n' + short, {
    maxTokens: BODY_MAX_TOKENS,
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
