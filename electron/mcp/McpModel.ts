// Генерация текста через уже загруженную локальную модель — для чужих программ на этой же машине.
//
// ⚠️ СМЫСЛ ИНСТРУМЕНТА — ОЧЕРЕДЬ, А НЕ ЕЩЁ ОДИН ПРОЦЕСС. Второй Electron с тем же GGUF = вторая
// копия весов в VRAM. Журналист (и любой другой клиент MCP) зовёт этот инструмент, встаёт в
// withQwenQueue рядом с переводом и чатом, и считает на ТОЙ ЖЕ уже тёплой модели. Отдельный
// Ollama/llama.cpp server для этого не нужен — браузер и есть хаб.
//
// ⚠️ ВСЕГДА ВСТРОЕННАЯ ЛОКАЛЬНАЯ, а не маршрут роли. У роли «блокнот» человек мог повесить
// облако — и тогда «поделиться моделью» тихо уехало бы наружу. Этот инструмент существует ровно
// ради процесса с GGUF; облако клиент пусть зовёт сам, своим ключом.

import * as Registry from '../ai/registry';
import { withQwenQueue } from '../QwenQueue';
import { LOCAL_CONNECTION_ID } from '../../shared/aiProviders';

const MAX_TOKENS_CEILING = 8192;
const MAX_TOKENS_DEFAULT = 2048;
const PROMPT_CEILING = 100_000;

export interface GenerateArgs {
  prompt: string;
  system?: string;
  maxTokens?: number;
}

export async function generateText(args: GenerateArgs): Promise<{
  text: string;
  model: string;
  tokens: number;
}> {
  const prompt = args.prompt.trim();
  if (!prompt) throw new Error('Argument "prompt" is required.');
  if (prompt.length > PROMPT_CEILING) {
    throw new Error(`prompt longer than ${PROMPT_CEILING} characters`);
  }

  const system = typeof args.system === 'string' ? args.system.trim() : '';
  if (system.length > PROMPT_CEILING) {
    throw new Error(`system longer than ${PROMPT_CEILING} characters`);
  }

  const maxTokens = clampMaxTokens(args.maxTokens);
  const full = system ? `${system}\n\n${prompt}` : prompt;

  const provider = Registry.providerById(LOCAL_CONNECTION_ID);
  const { out, tokens } = await withQwenQueue(() =>
    provider.generate(full, { maxTokens }),
  );

  return {
    text: out,
    model: provider.connection.model,
    tokens,
  };
}

function clampMaxTokens(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return MAX_TOKENS_DEFAULT;
  const n = Math.floor(raw);
  if (n < 1) return 1;
  if (n > MAX_TOKENS_CEILING) return MAX_TOKENS_CEILING;
  return n;
}
