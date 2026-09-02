// Anthropic: своя форма запроса и, главное, СВОЙ способ получить структуру.
//
// ⚠️ Строгого json-режима у Anthropic нет — ни `response_format`, ни грамматики. Ближайшее по
// надёжности — ИНСТРУМЕНТ: объявляем ровно один tool со схемой в `input_schema` и требуем позвать
// именно его (`tool_choice`). Тогда ответ приходит не текстом, который надо разбирать, а готовыми
// аргументами вызова. Это не «обходной путь», а штатный способ: провайдер валидирует аргументы на
// своей стороне.
//
// ⚠️ Отсюда важное отличие от остальных двух адаптеров: generateStructured здесь НЕ РАЗБИРАЕТ
// текст. Объект уже объект — extractJson ему не нужен и был бы вреден (превратил бы готовое
// значение обратно в строку и обратно).
//
// ⚠️ `max_tokens` у Anthropic ОБЯЗАТЕЛЕН — без него запрос отвергается целиком, в отличие от
// OpenAI, где он необязателен. Поэтому дефолт проставляется здесь, а не полагается на провайдера.

import { fetchInProfile } from '../../ProfileSession';
import { capsFor, type Connection, type ProviderCaps } from '../../../shared/aiProviders';
import { toDialect, type JsonSchema } from '../../../shared/aiSchema';
import { ProviderError, viaOf, type ChatResult, type GenOpts, type GenResult, type Provider } from '../Provider';
import { arr, httpError, networkError, num, parseEventJson, pick, readSse, str, trimSlash } from './http';

/** Версия API в заголовке. Anthropic требует её явно и не имеет «последней» по умолчанию. */
const API_VERSION = '2023-06-01';
const TOOL_NAME = 'answer';

interface Msg { role: 'user' | 'assistant'; content: string }

export interface AnthropicDeps {
  connection: Connection;
  getKey: () => string | null;
}

export function createAnthropicProvider(deps: AnthropicDeps): Provider {
  const { connection } = deps;

  async function call(
    body: Record<string, unknown>,
    opts: GenOpts | undefined,
    onText?: (piece: string) => void,
  ): Promise<{ text: string; toolInput: unknown; tokens: number; stop: string }> {
    const key = deps.getKey();
    if (key === null) throw new ProviderError('no-key', `Для «${connection.label}» не задан ключ`);

    const stream = onText !== undefined;
    let res: Response;
    try {
      res = await fetchInProfile(`${trimSlash(connection.baseUrl)}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': API_VERSION,
        },
        body: JSON.stringify({ model: connection.model, max_tokens: opts?.maxTokens ?? 512, stream, ...body }),
        signal: opts?.abort,
      });
    } catch (e) {
      throw networkError(e, opts?.abort);
    }

    if (!res.ok) throw await httpError(res, connection.label);
    return stream ? await readStream(res, onText, opts?.abort) : await readWhole(res);
  }

  return {
    connection,

    caps(): ProviderCaps {
      return capsFor(connection);
    },

    async generate(prompt: string, opts?: GenOpts): Promise<GenResult> {
      // ⚠️ Со схемой путь другой: у Anthropic структуру даёт ИНСТРУМЕНТ, и ответ приходит готовым
      // объектом, а не текстом. Контракт обещает сырой текст — сериализуем обратно. Круг
      // «объект → строка → объект» выглядит лишним, но он честный: другого текста здесь просто не
      // существует, а притвориться, что схему не просили, было бы хуже.
      if (opts?.schema) {
        const withTool = await call(schemaBody(prompt, opts.schema), opts);
        if (withTool.toolInput === null) throw new ProviderError('schema', 'Модель не вызвала инструмент со схемой');
        return { out: JSON.stringify(withTool.toolInput), tokens: withTool.tokens, stopReason: withTool.stop };
      }
      const r = await call({ messages: [{ role: 'user', content: prompt } satisfies Msg] }, opts, opts?.onChunk);
      return { out: r.text, tokens: r.tokens, stopReason: r.stop };
    },

    async generateStructured(schema: JsonSchema, prompt: string, opts?: GenOpts): Promise<unknown> {
      // Стриминг структурного ответа не нужен: показывать человеку недособранный JSON нечего.
      const r = await call(schemaBody(prompt, schema), opts);

      if (r.toolInput === null) throw new ProviderError('schema', 'Модель не вызвала инструмент со схемой');
      return r.toolInput;
    },

    async chat(userText: string, history: unknown[], systemPrompt: string, opts?: GenOpts): Promise<ChatResult> {
      const prior = asMessages(history);
      const t0 = Date.now();
      const r = await call({
        // ⚠️ У Anthropic системный промпт — ОТДЕЛЬНОЕ ПОЛЕ, а не сообщение с ролью system: роли
        // system в массиве messages не существует, и такое сообщение будет отвергнуто.
        ...(systemPrompt ? { system: systemPrompt } : {}),
        messages: [...prior, { role: 'user', content: userText } satisfies Msg],
      }, opts, opts?.onChunk);
      return {
        out: r.text,
        history: [...prior, { role: 'user', content: userText }, { role: 'assistant', content: r.text }],
        ms: Date.now() - t0,
        tokens: r.tokens,
        via: viaOf(connection),
      };
    },
  };
}

/**
 * Запрос со схемой: единственный инструмент плюс принуждение позвать именно его.
 *
 * ⚠️ Без принуждения модель вольна ответить текстом «конечно, сейчас сделаю» и не позвать
 * инструмент вовсе — то есть ровно тот сбой, ради ухода от которого всё и затевалось.
 */
function schemaBody(prompt: string, schema: JsonSchema): Record<string, unknown> {
  return {
    messages: [{ role: 'user', content: prompt } satisfies Msg],
    tools: [{ name: TOOL_NAME, description: 'Верни ответ в этой структуре.', input_schema: toDialect(schema, 'anthropic') }],
    tool_choice: { type: 'tool', name: TOOL_NAME },
  };
}

/** История приходит из SQLite и могла быть записана кем угодно — фильтр, а не приведение типа. */
function asMessages(history: unknown[]): Msg[] {
  const out: Msg[] = [];
  for (const item of history) {
    if (typeof item !== 'object' || item === null) continue;
    const o = item as Record<string, unknown>;
    const content = o['content'];
    const role = o['role'];
    if (typeof content !== 'string') continue;
    // ⚠️ Сообщения с ролью system из чужой истории отбрасываем: у Anthropic такой роли нет, и она
    // сделала бы запрос невалидным целиком.
    if (role === 'user' || role === 'assistant') out.push({ role, content });
  }
  return out;
}

async function readWhole(res: Response): Promise<{ text: string; toolInput: unknown; tokens: number; stop: string }> {
  const json: unknown = await res.json().catch(() => null);
  let text = '';
  let toolInput: unknown = null;
  for (const block of arr(pick(json, ['content']))) {
    const type = str(pick(block, ['type']));
    if (type === 'text') text += str(pick(block, ['text'])) ?? '';
    else if (type === 'tool_use') toolInput = pick(block, ['input']);
  }
  return {
    text,
    toolInput,
    tokens: num(pick(json, ['usage', 'output_tokens'])) ?? 0,
    stop: str(pick(json, ['stop_reason'])) ?? 'end_turn',
  };
}

async function readStream(
  res: Response,
  onText: ((piece: string) => void) | undefined,
  abort?: AbortSignal,
): Promise<{ text: string; toolInput: unknown; tokens: number; stop: string }> {
  let text = '';
  let tokens = 0;
  let stop = 'end_turn';

  await readSse(res, (ev) => {
    const json = parseEventJson(ev.data);
    if (json === null) return;
    const type = str(pick(json, ['type']));
    if (type === 'content_block_delta') {
      // ⚠️ У Anthropic дельта бывает двух видов: text_delta для обычного текста и input_json_delta
      // для аргументов инструмента. Второй нам в потоке не нужен — структурный ответ мы не стримим,
      // — но перепутать их значило бы подать человеку куски JSON вместо текста.
      const piece = str(pick(json, ['delta', 'text']));
      if (piece !== null && piece !== '') { text += piece; onText?.(piece); }
      return;
    }
    if (type === 'message_delta') {
      const s = str(pick(json, ['delta', 'stop_reason']));
      if (s !== null) stop = s;
      const t = num(pick(json, ['usage', 'output_tokens']));
      if (t !== null) tokens = t;
      return;
    }
    if (type === 'error') {
      const msg = str(pick(json, ['error', 'message'])) ?? 'Ошибка провайдера';
      throw new ProviderError('provider', msg);
    }
  }, abort);

  return { text, toolInput: null, tokens, stop };
}
