import { runTabOrganizePrompt } from './TranslationService';
import {
  GEN_KIND_SCHEMA, genDataSchema, validateGenSpec, isGenKind, genKindHint, genKindSize,
  GEN_KINDS, type GenKind, type GenSpec,
} from '../shared/genSpec';

// Фраза человека → спека виджета. Модель НЕ ПИШЕТ КОД — она выбирает тип и заполняет поля.
//
// ⚠️ Почему так, а не как раньше — разобрано в шапке shared/genSpec.ts. Здесь важно одно
// следствие: оба прогона идут ПОД ГРАММАТИКОЙ, то есть ответ обязан быть валидным JSON нужной
// формы. Разбирать текст, чинить забор из ```, вырезать хвосты и угадывать намерение больше
// не нужно — этого класса задач не существует.
//
// ⚠️ Прогонов ДВА, и объединять их не надо. Одно решение на прогон — правило проекта (см.
// CLAUDE.md о том, почему ответ «плавает»): выбор типа и заполнение полей под этот тип — разные
// решения, и схема данных во втором прогоне зависит от исхода первого.

/** Сколько токенов хватает на каждый прогон. Ответ — короткий JSON, не текст. */
const KIND_MAX_TOKENS = 120;
const DATA_MAX_TOKENS = 900;

export interface GenSpecProgress {
  stage: 'kind' | 'data' | 'done';
  chars: number;
}

export type GenSpecOutcome =
  | { ok: true; spec: GenSpec; size: { w: number; h: number } }
  // 'unclear' — фраза не легла ни в один тип каталога. Это НОРМАЛЬНЫЙ исход, и человеку про
  // него говорят словами: раньше в такой ситуации на стол вставала пустая плитка.
  | { ok: false; reason: 'unclear' | 'model-error'; error?: string; kind?: GenKind };

function catalogLines(): string {
  return GEN_KINDS.map((k) => `- ${k}: ${genKindHint(k)}`).join('\n');
}

function buildKindPrompt(phrase: string): string {
  return (
    `A browser home-screen tile. The user described it in Russian: "${phrase}"\n\n` +
    `Pick the ONE tile type that fits from this closed catalog:\n${catalogLines()}\n\n` +
    `Rules:\n` +
    `- A random word, quote, fact or advice is "list".\n` +
    `- Anything rolled or drawn ("what to cook", "who does the dishes", a die, a coin) is "dice".\n` +
    `- Push-ups, glasses of water, cigarettes, anything tallied by tapping is "counter".\n` +
    `- Habits, packing, morning routine is "checklist".\n` +
    `- Pomodoro and any countdown of minutes is "timer".\n` +
    `- Pages read, kilometres run, anything with a finish line is "goal".\n` +
    `- Days until a date (holiday, birthday) is "countdown".\n` +
    `- A reminder to keep in sight is "note".\n` +
    // ⚠️ Всё, что про САМ БРАУЗЕР, обязано уходить в feed/stat: выдумать историю модель не может,
    // и на «список последних посещённых сайтов» она честно сочиняла афоризмы (живой случай 22.08).
    `- Anything about the BROWSER ITSELF — visited sites, history, open tabs, downloads, blocked\n` +
    `  trackers — is "feed" (a list) or "stat" (one number). Never "list": you do not know these data,\n` +
    `  the browser does.\n\n` +
    `Also write a Russian title for the tile: 1-3 words, no quotes.\n` +
    `Answer as JSON.`
  );
}

function buildDataPrompt(phrase: string, kind: GenKind, title: string): string {
  const head = `The user asked for a home-screen tile, in Russian: "${phrase}" (title: ${title}).\n`;
  switch (kind) {
    case 'list':
      return head
        + 'Write 8-12 items for it. "main" is what the tile shows LARGE, "sub" is the quiet line under it.\n'
        + 'For a word widget: main = the English word, sub = the Russian translation.\n'
        + 'For a quote widget: main = the WHOLE quote in Russian, sub = the author.\n'
        + 'For facts or advice: main = the fact itself in Russian, sub = a short note or empty.\n'
        + 'Match the request. Never turn a quote request into single words.\n'
        + 'Answer as JSON.';
    case 'dice':
      // ⚠️ Числовой бросок называется ПЕРВЫМ: «кубик, показывающий случайное число» модель
      // заполняла словами («Карты», «Шашки»), потому что про числа её никто не спрашивал.
      return head
        + 'If the user wants a random NUMBER (a die, "случайное число", a range), set "from" and "to" '
        + 'and leave "items" empty. A usual die is from 1 to 6.\n'
        + 'Otherwise write the faces to draw from: 2-8 items, "main" is the face itself in Russian '
        + '(a dish, a name, "Да"/"Нет"), "sub" is a short note or empty.\nAnswer as JSON.';
    case 'checklist':
      return head + 'Write 3-6 checklist rows in Russian. "main" is the row, "sub" is empty.\nAnswer as JSON.';
    case 'counter':
      return head
        + 'Give the counting unit in Russian ("раз", "стакан", "шаг"), the step of one tap (usually 1), '
        + 'and the starting value (usually 0).\nAnswer as JSON.';
    case 'goal':
      return head
        + 'Give the target number, the unit in Russian ("страниц", "км") and the starting value (usually 0).\n'
        + 'If the user named a number, use exactly that number.\nAnswer as JSON.';
    case 'timer':
      return head
        + 'Give the length in SECONDS. Pomodoro is 1500. If the user named minutes, convert them.\nAnswer as JSON.';
    case 'countdown':
      return head
        + `Give the date in YYYY-MM-DD. Today is ${new Date().toISOString().slice(0, 10)}. `
        + 'The date must be in the future.\nAnswer as JSON.';
    case 'note':
      return head + 'Write the note text in Russian, up to 200 characters.\nAnswer as JSON.';
    case 'feed':
      return head
        + 'Pick the browser source: "history" (recently visited sites), "topsites" (most visited), '
        + '"tabs" (tabs open now), "downloads" (downloaded files). Also give how many rows to show (3-12).\n'
        + 'Answer as JSON.';
    case 'stat':
      return head
        + 'Pick the browser source for one big number: "tabs" (tabs open now), "blocked" '
        + '(trackers blocked this session), "downloads" (files downloaded).\nAnswer as JSON.';
  }
}

/** Ответ под грамматикой — уже валидный JSON. Try/catch здесь на случай обрыва по maxTokens. */
function parseJson(out: string): unknown {
  try {
    return JSON.parse(out.trim());
  } catch {
    return null;
  }
}

export async function parsePhraseToGenSpec(
  phrase: string,
  onProgress?: (p: GenSpecProgress) => void,
): Promise<GenSpecOutcome> {
  const p = phrase.trim();
  if (p.length < 3) return { ok: false, reason: 'unclear' };

  let kindChars = 0;
  const kindRes = await runTabOrganizePrompt(buildKindPrompt(p), {
    maxTokens: KIND_MAX_TOKENS,
    schema: GEN_KIND_SCHEMA,
    onChunk: (t) => { kindChars += t.length; onProgress?.({ stage: 'kind', chars: kindChars }); },
  });
  if (!kindRes.ok) return { ok: false, reason: 'model-error', error: kindRes.error };

  const head = parseJson(kindRes.out) as { kind?: unknown; title?: unknown } | null;
  if (!head || !isGenKind(head.kind)) return { ok: false, reason: 'unclear' };
  const kind = head.kind;
  const title = typeof head.title === 'string' ? head.title : '';

  let dataChars = 0;
  onProgress?.({ stage: 'data', chars: 0 });
  const dataRes = await runTabOrganizePrompt(buildDataPrompt(p, kind, title), {
    maxTokens: DATA_MAX_TOKENS,
    schema: genDataSchema(kind),
    onChunk: (t) => { dataChars += t.length; onProgress?.({ stage: 'data', chars: dataChars }); },
  });
  onProgress?.({ stage: 'done', chars: dataChars });
  if (!dataRes.ok) return { ok: false, reason: 'model-error', error: dataRes.error };

  const data = parseJson(dataRes.out);
  const spec = validateGenSpec({ ...(data as object ?? {}), kind, title });
  // ⚠️ Тип назвать смогли, а данные под него — нет (список из двух строк, цель без числа,
  // дата в прошлом). Говорим об этом прямо и называем тип: человеку это подсказка, что
  // переформулировать, а не глухое «не получилось».
  if (!spec) return { ok: false, reason: 'unclear', kind };

  return { ok: true, spec, size: genKindSize(kind) };
}
