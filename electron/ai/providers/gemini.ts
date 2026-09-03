// Google Gemini: своя форма запроса, нативная схема ответа.
//
// ⚠️ Ключ уходит ЗАГОЛОВКОМ `x-goog-api-key`, а не параметром `?key=` в адресе. Разница не
// косметическая: адрес попадает в логи прокси, в отчёты об ошибках и в историю сетевых запросов —
// то есть ключ, положенный в query, живёт в местах, которые никто не считает секретными.
// Существующий GeminiFactCheck.ts кладёт его в адрес; при переезде на слой это надо будет
// поправить, а не перенести как есть.
//
// ⚠️ Роль ассистента здесь называется `model`, а не `assistant`, и содержимое лежит в `parts`, а не
// в строке. Прямое переиспользование формы OpenAI даёт молча пустой ответ, а не ошибку.
//
// ⚠️ Структурный режим нативный (`responseSchema` + `responseMimeType`), но схема идёт В ДИАЛЕКТЕ
// gemini: это OpenAPI-подмножество, оно не знает `additionalProperties` и не принимает `maxLength`.
// Размеры массива при этом переживают перевод — см. shared/aiSchema.ts.

import { fetchInProfile } from '../../ProfileSession';
import { capsFor, type Connection, type ProviderCaps } from '../../../shared/aiProviders';
import { extractJson, toDialect, type JsonSchema } from '../../../shared/aiSchema';
import { ProviderError, viaOf, type ChatResult, type GenOpts, type GenResult, type Provider, type RawFile } from '../Provider';
import { arr, httpError, networkError, num, parseEventJson, pick, readSse, str, trimSlash } from './http';
import type { UsageDelta } from '../../../shared/aiUsage';
import * as UsageStore from '../UsageStore';

interface Part { text: string }
interface Content { role: 'user' | 'model'; parts: Part[] }
interface Read { text: string; files: RawFile[]; tokens: number; stop: string; usage: UsageDelta }

export interface GeminiDeps {
  connection: Connection;
  getKey: () => string | null;
}

export function createGeminiProvider(deps: GeminiDeps): Provider {
  const { connection } = deps;

  async function call(
    body: Record<string, unknown>,
    opts: GenOpts | undefined,
    onText?: (piece: string) => void,
  ): Promise<Read> {
    const key = deps.getKey();
    if (key === null) throw new ProviderError('no-key', `Для «${connection.label}» не задан ключ`);

    const stream = onText !== undefined;
    // ⚠️ alt=sse обязателен: без него потоковый метод отдаёт МАССИВ JSON, а не события, и разбор
    // потока молча не находит ни одного куска.
    const method = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
    const url = `${trimSlash(connection.baseUrl)}/models/${encodeURIComponent(connection.model)}:${method}`;

    let res: Response;
    try {
      res = await fetchInProfile(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
        signal: opts?.abort,
      });
    } catch (e) {
      throw networkError(e, opts?.abort);
    }

    if (!res.ok) throw await httpError(res, connection.label);
    const read = stream ? await readStream(res, onText, opts?.abort) : await readWhole(res);
    // Счёт расхода — в одной точке на все методы адаптера (см. openaiCompatible.ts).
    UsageStore.record(connection.id, read.usage);
    return read;
  }

  function generationConfig(opts?: GenOpts, schema?: JsonSchema): Record<string, unknown> {
    const cfg: Record<string, unknown> = { maxOutputTokens: opts?.maxTokens ?? 512 };
    if (schema !== undefined) {
      cfg['responseMimeType'] = 'application/json';
      cfg['responseSchema'] = toDialect(schema, 'gemini');
    }
    return cfg;
  }

  return {
    connection,

    caps(): ProviderCaps {
      return capsFor(connection);
    },

    async generate(prompt: string, opts?: GenOpts): Promise<GenResult> {
      const r = await call({
        contents: [{ role: 'user', parts: [{ text: prompt }] } satisfies Content],
        // Схема, если попросили, ограничивает ГЕНЕРАЦИЮ — текст возвращается сырым (см. GenOpts).
        // ⚠️ Со схемой поток не запрашиваем: показывать человеку недособранный JSON нечего.
        generationConfig: generationConfig(opts, opts?.schema),
      }, opts, opts?.schema ? undefined : opts?.onChunk);
      return { out: r.text, tokens: r.tokens, stopReason: r.stop };
    },

    async generateStructured(schema: JsonSchema, prompt: string, opts?: GenOpts): Promise<unknown> {
      // Структурный ответ не стримим: показывать недособранный JSON нечего.
      const r = await call({
        contents: [{ role: 'user', parts: [{ text: prompt }] } satisfies Content],
        generationConfig: generationConfig(opts, schema),
      }, opts);
      const parsed = extractJson(r.text);
      if (!parsed.ok) throw new ProviderError('schema', parsed.error);
      return parsed.value;
    },

    async chat(userText: string, history: unknown[], systemPrompt: string, opts?: GenOpts): Promise<ChatResult> {
      const prior = asContents(history);
      const t0 = Date.now();
      const r = await call({
        // ⚠️ Системная инструкция — отдельное поле, как у Anthropic, и тоже не роль в массиве.
        ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
        contents: [...prior, { role: 'user', parts: [{ text: userText }] } satisfies Content],
        generationConfig: generationConfig(opts),
      }, opts, opts?.onChunk);
      return {
        out: r.text,
        files: r.files,
        history: [...prior, { role: 'user', parts: [{ text: userText }] }, { role: 'model', parts: [{ text: r.text }] }],
        ms: Date.now() - t0,
        tokens: r.tokens,
        via: viaOf(connection),
      };
    },
  };
}

/**
 * История приходит из SQLite и могла быть записана кем угодно — фильтр, а не приведение типа.
 *
 * ⚠️ Заодно понимает форму OpenAI ({role, content}): человек может переключить беседу с одного
 * подключения на другое посреди разговора, и терять при этом всю переписку недопустимо. Роль
 * assistant при этом становится model — иначе Gemini отвергнет запрос.
 */
function asContents(history: unknown[]): Content[] {
  const out: Content[] = [];
  for (const item of history) {
    if (typeof item !== 'object' || item === null) continue;
    const o = item as Record<string, unknown>;
    const rawRole = str(o['role']);
    const role: 'user' | 'model' | null =
      rawRole === 'user' ? 'user'
        : rawRole === 'model' || rawRole === 'assistant' ? 'model'
          : null;
    if (role === null) continue;

    const text = str(o['content']) ?? arr(o['parts']).map((p) => str(pick(p, ['text'])) ?? '').join('');
    if (text === '') continue;
    out.push({ role, parts: [{ text }] });
  }
  return out;
}

/**
 * Картинки из ответа.
 *
 * ⚠️ У Gemini они лежат РЯДОМ С ТЕКСТОМ, отдельными частями того же ответа (inlineData), а не в
 * своём поле: рисующая модель может вернуть подпись и картинку одним ходом. Поэтому части
 * перебираются целиком, а не «берём первую».
 */
function filesOf(json: unknown): RawFile[] {
  const out: RawFile[] = [];
  for (const part of arr(pick(json, ['candidates', '0', 'content', 'parts']))) {
    const mime = str(pick(part, ['inlineData', 'mimeType']));
    const data = str(pick(part, ['inlineData', 'data']));
    if (mime !== null && data !== null && data !== '') out.push({ mime: mime.toLowerCase(), base64: data });
  }
  return out;
}

/**
 * Расход из ответа. ⚠️ Стоимости Gemini не возвращает — её здесь нет и не появится, а выдумывать
 * её по прайс-листу внутри браузера мы не будем (см. shared/aiUsage.ts).
 */
function usageIn(json: unknown): UsageDelta {
  return {
    promptTokens: num(pick(json, ['usageMetadata', 'promptTokenCount'])) ?? undefined,
    completionTokens: num(pick(json, ['usageMetadata', 'candidatesTokenCount'])) ?? undefined,
  };
}

function textOf(json: unknown): string {
  return arr(pick(json, ['candidates', '0', 'content', 'parts']))
    .map((p) => str(pick(p, ['text'])) ?? '')
    .join('');
}

async function readWhole(res: Response): Promise<Read> {
  const json: unknown = await res.json().catch(() => null);
  return {
    text: textOf(json),
    files: filesOf(json),
    usage: usageIn(json),
    tokens: num(pick(json, ['usageMetadata', 'candidatesTokenCount'])) ?? 0,
    stop: str(pick(json, ['candidates', '0', 'finishReason'])) ?? 'STOP',
  };
}

async function readStream(
  res: Response,
  onText: ((piece: string) => void) | undefined,
  abort?: AbortSignal,
): Promise<Read> {
  let text = '';
  let tokens = 0;
  let stop = 'STOP';
  let usage: UsageDelta = {};
  const files: RawFile[] = [];

  await readSse(res, (ev) => {
    const json = parseEventJson(ev.data);
    if (json === null) return;
    // ⚠️ В потоке каждое событие — ПОЛНЫЙ ответ с очередным куском, а не дельта поверх прошлого:
    // куски именно склеиваются, а не заменяют друг друга.
    const piece = textOf(json);
    if (piece !== '') { text += piece; onText?.(piece); }
    files.push(...filesOf(json));
    const s = str(pick(json, ['candidates', '0', 'finishReason']));
    if (s !== null) stop = s;
    const t = num(pick(json, ['usageMetadata', 'candidatesTokenCount']));
    if (t !== null) tokens = t;
    if (pick(json, ['usageMetadata']) !== null) usage = usageIn(json);
  }, abort);

  return { text, files, tokens, usage, stop };
}
