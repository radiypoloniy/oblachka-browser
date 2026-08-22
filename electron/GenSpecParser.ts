import { runTabOrganizePrompt } from './TranslationService';
import {
  GEN_KIND_SCHEMA, GEN_WEB_VALUE_SCHEMA, genDataSchema, validateGenSpec, isGenKind,
  genKindHint, genKindSize, isAllowedGenUrl, GEN_KINDS, type GenKind, type GenSpec,
} from '../shared/genSpec';
import { jsonSample, jsonLeafPaths, resolveJsonPath, displayableValue } from '../shared/genWeb';
import { fetchGenWeb } from './GenWebSource';

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
  | { ok: false; reason: 'unclear' | 'model-error' | 'link'; error?: string; kind?: GenKind };

/**
 * Виджет по ссылке, которую дал ЧЕЛОВЕК.
 *
 * ⚠️ Порядок здесь важен и обратен привычному: СНАЧАЛА хост идёт по ссылке, и только потом
 * спрашивают модель. Без этого она выбирала бы путь в JSON вслепую — то есть выдумывала бы
 * ключи, ровно как выдумывала историю посещений. Модель отвечает уже по настоящему образцу.
 *
 * ⚠️ Фиду модель не нужна вовсе: заголовки в RSS/Atom лежат по стандарту, спрашивать не о чем.
 */
async function buildFromUrl(
  phrase: string,
  url: string,
  onProgress?: (p: GenSpecProgress) => void,
): Promise<GenSpecOutcome> {
  onProgress?.({ stage: 'kind', chars: 0 });
  const got = await fetchGenWeb(url, true);
  if (!got.ok) return { ok: false, reason: 'link', error: got.error };

  if (got.kind === 'feed') {
    const spec = validateGenSpec({
      kind: 'feed', source: 'web', url, rows: 6,
      title: got.title || phrase.slice(0, 24),
    });
    if (!spec) return { ok: false, reason: 'link', error: 'Ссылка не годится для виджета' };
    onProgress?.({ stage: 'done', chars: 0 });
    return { ok: true, spec, size: genKindSize('feed') };
  }

  const paths = jsonLeafPaths(got.json);
  if (paths.length === 0) {
    return { ok: false, reason: 'link', error: 'В ответе нет ни одного числа или короткой строки' };
  }
  let chars = 0;
  onProgress?.({ stage: 'data', chars: 0 });
  const res = await runTabOrganizePrompt(
    `A browser home-screen tile must show ONE value from this JSON answer.\n`
    + `The user asked, in Russian: "${phrase}"\n\n`
    + `Here is the real answer, shortened:\n${JSON.stringify(jsonSample(got.json))}\n\n`
    + `Paths you may choose from (copy one EXACTLY):\n${paths.slice(0, 24).join('\n')}\n\n`
    + `Give "path" (one of the above), "unit" (a short Russian word or a sign like ₽, may be empty) `
    + `and "title" (1-3 Russian words).\nAnswer as JSON.`,
    {
      maxTokens: 200,
      schema: GEN_WEB_VALUE_SCHEMA,
      onChunk: (t) => { chars += t.length; onProgress?.({ stage: 'data', chars }); },
    },
  );
  onProgress?.({ stage: 'done', chars });
  if (!res.ok) return { ok: false, reason: 'model-error', error: res.error };

  const picked = parseJson(res.out) as { path?: unknown; unit?: unknown; title?: unknown } | null;
  let path = typeof picked?.path === 'string' ? picked.path.trim() : '';
  // ⚠️ Путь проверяем на НАСТОЯЩЕМ ответе, а не верим на слово: грамматика гарантирует форму
  // строки, но не то, что такой ключ существует. Промах — берём первый годный сам, потому что
  // ссылка рабочая и отказывать человеку не за что.
  if (displayableValue(resolveJsonPath(got.json, path)) === null) path = paths[0] ?? '';
  const spec = validateGenSpec({
    kind: 'stat', source: 'web', url, path,
    unit: typeof picked?.unit === 'string' ? picked.unit : '',
    title: typeof picked?.title === 'string' ? picked.title : phrase.slice(0, 24),
  });
  if (!spec) return { ok: false, reason: 'link', error: 'Не удалось выбрать значение в ответе' };
  return { ok: true, spec, size: genKindSize('stat') };
}

function catalogLines(): string {
  return GEN_KINDS.map((k) => `- ${k}: ${genKindHint(k)}`).join('\n');
}

function buildKindPrompt(phrase: string): string {
  return (
    `A browser home-screen tile. The user described it in Russian: "${phrase}"\n\n` +
    `Pick the ONE tile type that fits from this closed catalog:\n${catalogLines()}\n\n` +
    `Rules:\n` +
    `- A random word, quote, fact or advice is "list".\n` +
    `- Anything rolled or drawn is "dice": a die, a coin ("орёл и решка"), "what to cook",\n` +
    `  "who does the dishes", a yes/no draw.\n` +
    `- Push-ups, glasses of water, cigarettes, anything tallied by tapping is "counter".\n` +
    `- Habits, packing, morning routine is "checklist".\n` +
    `- Pomodoro and any countdown of minutes is "timer".\n` +
    `- Pages read, kilometres run, anything with a finish line is "goal".\n` +
    `- Days until a date (holiday, birthday) is "countdown".\n` +
    `- A reminder to keep in sight is "note".\n` +
    `- Time in another city or time zone is "zones" — it is computed locally, no internet needed.\n` +
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
      // ⚠️ Сначала ОДИН явный выбор — числа или слова, — и только потом заполнение. Без него
      // модель заполняла обе формы сразу, а какая победит, решал код: так «кубик со случайным
      // числом» выходил словами, а «орёл и решка» — числами 1 и 2.
      return head
        + 'First choose "mode":\n'
        + '- "numbers" if the tile must show a random NUMBER (a die, "случайное число", a range). '
        + 'Then set "from" and "to" (a usual die is 1 to 6) and leave "items" empty.\n'
        + '- "faces" if the tile must show WORDS (орёл и решка, what to cook, who does the dishes, '
        + 'да/нет). Then write 2-8 items and leave "from"/"to" out.\n'
        + 'A coin is "faces" with "Орёл" and "Решка". A six-sided die is "numbers" from 1 to 6.\n'
        + '"main" is the face itself in Russian, "sub" is a short note or empty.\nAnswer as JSON.';
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
    case 'zones':
      // ⚠️ Просим IANA-идентификаторы, а не «EDT» и «МСК»: аббревиатуры неоднозначны и ICU их
      // не знает, а по идентификатору время считается на месте, без всякой сети.
      return head
        + 'Write 1-4 time zones as IANA identifiers in "main" (America/New_York, Europe/Moscow, '
        + 'Asia/Tokyo) and the city name in Russian in "sub".\n'
        + 'Never write abbreviations like EDT or МСК — only identifiers with a slash.\nAnswer as JSON.';
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
  url?: string,
): Promise<GenSpecOutcome> {
  const p = phrase.trim();
  const link = (url ?? '').trim();
  // Ссылка есть — это другой разговор: тип виджета определяется тем, что по ней лежит.
  if (link) {
    if (!isAllowedGenUrl(link)) {
      return { ok: false, reason: 'link', error: 'Нужна ссылка https на публичный адрес' };
    }
    return buildFromUrl(p || 'Виджет', link, onProgress);
  }
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
