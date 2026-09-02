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
import { createSseParser, isSseDone } from '../../../shared/sseParse';
import { ProviderError, type ChatResult, type GenOpts, type GenResult, type Provider } from '../Provider';

interface Msg { role: 'system' | 'user' | 'assistant'; content: string }

export interface OpenAiCompatDeps {
  connection: Connection;
  /** Ключ на момент запроса. Функция, а не строка: человек может подключить его между вызовами. */
  getKey: () => string | null;
}

export function createOpenAiCompatibleProvider(deps: OpenAiCompatDeps): Provider {
  const { connection } = deps;

  async function call(body: Record<string, unknown>, opts?: GenOpts): Promise<{ text: string; tokens: number; stop: string }> {
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
      if (opts?.abort?.aborted) throw new ProviderError('aborted', 'Прервано');
      throw new ProviderError('unreachable', e instanceof Error ? e.message : 'Сеть недоступна');
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
      const r = await call({
        messages: [{ role: 'user', content: prompt } satisfies Msg],
        max_tokens: opts?.maxTokens ?? 512,
      }, opts);
      return { out: r.text, tokens: r.tokens, stopReason: r.stop };
    },

    async generateStructured(schema: JsonSchema, prompt: string, opts?: GenOpts): Promise<unknown> {
      const mode = capsFor(connection).schema;
      // ⚠️ Схема уходит В ДИАЛЕКТЕ, а не как есть: strict-режим не принимает maxLength/minItems и
      // отвергает ЗАПРОС ЦЕЛИКОМ, если они там встретились. Границы после этого держит
      // validateAgainst этажом выше (см. shared/aiSchema.ts) — провайдер их уже не знает.
      const body: Record<string, unknown> = mode === 'native'
        ? {
          messages: [{ role: 'user', content: prompt } satisfies Msg],
          max_tokens: opts?.maxTokens ?? 512,
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'answer', strict: true, schema: toDialect(schema, 'openai') },
          },
        }
        : {
          // Режим none: гарантий нет никаких, схема идёт словами в промпт. Разбирает ответ
          // extractJson, а годность проверяет валидатор с одним ремонтным повтором.
          messages: [{ role: 'user', content: prompt } satisfies Msg],
          max_tokens: opts?.maxTokens ?? 512,
        };

      const r = await call(body, opts);
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
        // ⚠️ История возвращается БЕЗ системного промпта: он приклеивается на каждом запросе заново
        // и, попав в историю, удваивался бы с каждым ходом беседы.
        history: [...prior, { role: 'user', content: userText }, { role: 'assistant', content: r.text }],
        ms: Date.now() - t0,
        tokens: r.tokens,
      };
    },
  };
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

async function readWhole(res: Response): Promise<{ text: string; tokens: number; stop: string }> {
  const json: unknown = await res.json().catch(() => null);
  const choice = pick(json, ['choices', '0']);
  const text = str(pick(choice, ['message', 'content'])) ?? '';
  return {
    text,
    tokens: num(pick(json, ['usage', 'completion_tokens'])) ?? 0,
    stop: str(pick(choice, ['finish_reason'])) ?? 'stop',
  };
}

async function readStream(res: Response, opts?: GenOpts): Promise<{ text: string; tokens: number; stop: string }> {
  const body = res.body;
  if (!body) throw new ProviderError('provider', 'Поток пуст');

  const parser = createSseParser();
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let text = '';
  let stop = 'stop';
  let tokens = 0;

  const handle = (data: string): void => {
    if (isSseDone(data)) return;
    let json: unknown;
    // ⚠️ Один битый кусок в середине потока не должен ронять весь ответ: остальные пришли целыми,
    // и человек уже видит их на экране.
    try { json = JSON.parse(data); } catch { return; }
    const choice = pick(json, ['choices', '0']);
    const piece = str(pick(choice, ['delta', 'content']));
    if (piece !== null && piece !== '') { text += piece; opts?.onChunk?.(piece); }
    const finish = str(pick(choice, ['finish_reason']));
    if (finish !== null) stop = finish;
    const used = num(pick(json, ['usage', 'completion_tokens']));
    if (used !== null) tokens = used;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const ev of parser.push(decoder.decode(value, { stream: true }))) handle(ev.data);
    }
    for (const ev of parser.flush()) handle(ev.data);
  } catch (e) {
    if (opts?.abort?.aborted) throw new ProviderError('aborted', 'Прервано');
    throw new ProviderError('provider', e instanceof Error ? e.message : String(e));
  } finally {
    reader.releaseLock();
  }

  return { text, tokens, stop };
}

/**
 * Ответ об ошибке → код, различимый для интерфейса.
 *
 * ⚠️ Текст провайдера сохраняется в message, но НЕ становится тем, что видит человек напрямую:
 * там встречается и ключ в открытом виде (некоторые шлюзы возвращают запрос целиком), и простыня
 * на десять строк. Показывать решает верхний слой, у него для этого есть код.
 */
async function httpError(res: Response, label: string): Promise<ProviderError> {
  const body = await res.text().catch(() => '');
  const short = body.slice(0, 300);
  if (res.status === 401 || res.status === 403) return new ProviderError('no-key', `«${label}» не принял ключ (${res.status})`);
  if (res.status === 429) return new ProviderError('rate-limited', `«${label}»: слишком много запросов (429)`);
  // 413 — запрос не влез; 400 с упоминанием контекста — то же самое другими словами.
  if (res.status === 413 || (res.status === 400 && /context|token/i.test(short))) {
    return new ProviderError('context', `«${label}»: запрос не помещается в контекст модели`);
  }
  return new ProviderError('provider', `«${label}» ответил ${res.status}: ${short}`);
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

// Мелкие безопасные доставалки: ответы провайдеров — чужой JSON, и обращаться к нему как к
// известной структуре нельзя. `any` тут не нужен, хватает unknown с сужением.
function pick(v: unknown, pathParts: readonly string[]): unknown {
  let cur = v;
  for (const p of pathParts) {
    if (Array.isArray(cur)) { cur = cur[Number(p)]; continue; }
    if (typeof cur !== 'object' || cur === null) return null;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur ?? null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
