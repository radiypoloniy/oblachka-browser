// Один адаптер на большую часть мира.
//
// ⚠️ `/v1/chat/completions` — стандарт де-факто: в этой форме отвечают OpenAI, OpenRouter,
// DeepSeek, Groq, Together, Mistral, xAI, а из локальных — Ollama, LM Studio, llama.cpp server и
// vLLM. Поэтому «поддержать провайдера» здесь почти всегда означает подставить адрес, а не
// написать код. Своей формы требуют только Anthropic и Gemini — им отдельные файлы.
//
// ⚠️ В сеть ходим ТОЛЬКО через fetchInProfile. Глобальный fetch идёт мимо сессии Electron, то есть
// мимо прокси, мимо kill switch и мимо адблока: при включённом VPN он отдал бы реальный IP, и
// человек об этом не узнал бы. Сторож scripts/network-egress-check.mjs это ловит, но помнить
// дешевле, чем чинить.
//
// ⚠️ Следствие, принятое сознательно: запросы к модели идут ЧЕРЕЗ ТУННЕЛЬ, когда VPN включён. Это
// стоит задержки и иногда упирается в геоблоки провайдера. Вариант «AI мимо туннеля» не
// рассматривается — это ровно та дыра, которую закрывали в августе.

import { fetchInProfile } from '../../ProfileSession';
import { capsFor, type Connection, type ProviderCaps } from '../../../shared/aiProviders';
import { extractJson, toDialect, type JsonSchema } from '../../../shared/aiSchema';
import { isSseDone } from '../../../shared/sseParse';
import { ProviderError, viaOf, type ChatResult, type GenOpts, type GenResult, type Provider, type RawFile } from '../Provider';
import { arr, httpError, networkError, num, parseEventJson, pick, readSse, str, trimSlash } from './http';
import { parseDataUrl } from '../../../shared/aiAttachments';

interface Msg { role: 'system' | 'user' | 'assistant'; content: string }
interface Read { text: string; files: RawFile[]; tokens: number; stop: string }

export interface OpenAiCompatDeps {
  connection: Connection;
  /** Ключ на момент запроса. Функция, а не строка: человек может подключить его между вызовами. */
  getKey: () => string | null;
}

export function createOpenAiCompatibleProvider(deps: OpenAiCompatDeps): Provider {
  const { connection } = deps;

  async function call(body: Record<string, unknown>, opts?: GenOpts): Promise<Read> {
    const key = deps.getKey();
    // ⚠️ Локальные раннеры ключа не требуют вовсе — отказывать им «нет ключа» значило бы не пускать
    // Ollama, у которой его не бывает по устройству.
    if (key === null && !capsFor(connection).local) {
      throw new ProviderError('no-key', `Для «${connection.label}» не задан ключ`);
    }

    const stream = opts?.onChunk !== undefined;
    let res: Response;
    try {
      res = await fetchInProfile(`${trimSlash(connection.baseUrl)}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(key !== null ? { Authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify({ model: connection.model, stream, ...body }),
        signal: opts?.abort,
      });
    } catch (e) {
      throw networkError(e, opts?.abort);
    }

    if (!res.ok) throw await httpError(res, connection.label);
    return stream ? await readStream(res, opts) : await readWhole(res);
  }

  return {
    connection,

    caps(): ProviderCaps {
      return capsFor(connection);
    },

    async generate(prompt: string, opts?: GenOpts): Promise<GenResult> {
      // Схема, если попросили, ограничивает ГЕНЕРАЦИЮ — текст возвращается сырым (см. GenOpts).
      const native = capsFor(connection).schema === 'native';
      const r = await call(promptBody(prompt, opts, opts?.schema, native), opts);
      return { out: r.text, tokens: r.tokens, stopReason: r.stop };
    },

    async generateStructured(schema: JsonSchema, prompt: string, opts?: GenOpts): Promise<unknown> {
      const native = capsFor(connection).schema === 'native';
      const r = await call(promptBody(prompt, opts, schema, native), opts);
      const parsed = extractJson(r.text);
      if (!parsed.ok) throw new ProviderError('schema', parsed.error);
      return parsed.value;
    },

    async chat(userText: string, history: unknown[], systemPrompt: string, opts?: GenOpts): Promise<ChatResult> {
      const prior = asMessages(history);
      const messages: Msg[] = [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt } as Msg] : []),
        ...prior,
        { role: 'user', content: userText },
      ];
      const t0 = Date.now();
      const r = await call({ messages, max_tokens: opts?.maxTokens ?? 512 }, opts);
      return {
        out: r.text,
        files: r.files,
        // ⚠️ История возвращается БЕЗ системного промпта: он приклеивается на каждом запросе заново
        // и, попав в историю, удваивался бы с каждым ходом беседы.
        history: [...prior, { role: 'user', content: userText }, { role: 'assistant', content: r.text }],
        ms: Date.now() - t0,
        tokens: r.tokens,
        via: viaOf(connection),
      };
    },
  };
}


/**
 * Тело запроса на одну реплику. Схема, если она есть, уходит В ДИАЛЕКТЕ, а не как есть.
 *
 * ⚠️ strict-режим не принимает maxLength/minItems и отвергает ЗАПРОС ЦЕЛИКОМ, если они там
 * встретились. Границы после этого держит validateAgainst этажом выше (shared/aiSchema.ts) —
 * провайдер про них уже не знает.
 *
 * ⚠️ Когда режим НЕ native, схема в запрос не кладётся вовсе: за таким адресом может стоять
 * прокси, который примет response_format и молча его проигнорирует. Тогда ответ разбирает
 * extractJson, а годность проверяет валидатор с одним ремонтным повтором.
 */
function promptBody(
  prompt: string, opts: GenOpts | undefined, schema: JsonSchema | undefined, native: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    messages: [{ role: 'user', content: prompt } satisfies Msg],
    max_tokens: opts?.maxTokens ?? 512,
  };
  if (schema && native) {
    body['response_format'] = {
      type: 'json_schema',
      json_schema: { name: 'answer', strict: true, schema: toDialect(schema, 'openai') },
    };
  }
  return body;
}

/**
 * История приходит непрозрачным значением (её выдал этот же провайдер), но между перезапусками она
 * лежит в SQLite и могла быть записана кем угодно. Поэтому — не приведение типа, а фильтр.
 */
function asMessages(history: unknown[]): Msg[] {
  const out: Msg[] = [];
  for (const item of history) {
    if (typeof item !== 'object' || item === null) continue;
    const o = item as Record<string, unknown>;
    const role = o['role'];
    const content = o['content'];
    if (typeof content !== 'string') continue;
    if (role === 'user' || role === 'assistant' || role === 'system') out.push({ role, content });
  }
  return out;
}

async function readWhole(res: Response): Promise<Read> {
  const json: unknown = await res.json().catch(() => null);
  const choice = pick(json, ['choices', '0']);
  const text = str(pick(choice, ['message', 'content'])) ?? '';
  return {
    text,
    files: imagesIn(pick(choice, ['message'])),
    tokens: num(pick(json, ['usage', 'completion_tokens'])) ?? 0,
    stop: str(pick(choice, ['finish_reason'])) ?? 'stop',
  };
}

/**
 * Картинки из ответа.
 *
 * ⚠️ Поля `images` В СПЕЦИФИКАЦИИ chat/completions НЕТ — его завели шлюзы (первым OpenRouter),
 * когда через тот же протокол пошли рисующие модели. Поэтому и разбор терпимый: нет поля — просто
 * нет картинок, а не ошибка. Ждать здесь стандарта неоткуда, стандарт сюда не дошёл.
 *
 * ⚠️ Берём только data-URL. Ссылку на чужой хост мы бы потом пошли скачивать сами — то есть завели
 * бы ещё один канал наружу, мимо профиля и kill switch, ради картинки.
 */
function imagesIn(message: unknown): RawFile[] {
  const out: RawFile[] = [];
  for (const item of arr(pick(message, ['images']))) {
    const url = str(pick(item, ['image_url', 'url'])) ?? str(pick(item, ['url']));
    if (url === null) continue;
    const parsed = parseDataUrl(url);
    if (parsed !== null) out.push(parsed);
  }
  return out;
}

async function readStream(res: Response, opts?: GenOpts): Promise<Read> {
  let text = '';
  let stop = 'stop';
  let tokens = 0;
  const files: RawFile[] = [];

  await readSse(res, (ev) => {
    if (isSseDone(ev.data)) return;
    const json = parseEventJson(ev.data);
    if (json === null) return;
    const choice = pick(json, ['choices', '0']);
    const piece = str(pick(choice, ['delta', 'content']));
    if (piece !== null && piece !== '') { text += piece; opts?.onChunk?.(piece); }
    // ⚠️ Картинка приезжает НЕ дельтой по кускам, а целиком в одном событии — обычно последнем.
    // Складываем, а не заменяем: рисующие модели умеют вернуть несколько за один ответ.
    files.push(...imagesIn(pick(choice, ['delta'])), ...imagesIn(pick(choice, ['message'])));
    const finish = str(pick(choice, ['finish_reason']));
    if (finish !== null) stop = finish;
    // ⚠️ usage приходит последним событием и только если его попросили — поэтому не перетираем
    // накопленное нулём, а обновляем только когда число реально пришло.
    const used = num(pick(json, ['usage', 'completion_tokens']));
    if (used !== null) tokens = used;
  }, opts?.abort);

  return { text, files, tokens, stop };
}
