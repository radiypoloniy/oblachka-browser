// Каталог типов подключения к модели и их возможностей.
//
// ⚠️ Типов подключения ЧЕТЫРЕ, а не тридцать, и это главное решение файла. Стандарт де-факто —
// OpenAI-совместимый `/v1/chat/completions`: его принимают OpenAI, OpenRouter, DeepSeek, Groq,
// Together, Mistral, xAI, а также локальные раннеры Ollama, LM Studio, llama.cpp server и vLLM.
// Своя форма запроса только у Anthropic и Gemini. Всё остальное — ПРЕСЕТЫ поверх этих типов, то
// есть заранее подставленный адрес, а не новый код. Список провайдеров в интерфейсе устареет
// через месяц; список ФОРМ ЗАПРОСА не менялся уже второй год.
//
// ⚠️ Секретов здесь нет и быть не может: ключи живут в electron/ai/KeyStore.ts под safeStorage.
// Этот модуль описывает, КУДА идти и ЧТО там умеют, а не чем открывать.
//
// Значимых импортов нет — модуль под проверкой (scripts/ai-providers-check.mjs), а она гоняется
// голым node (см. правило про shared/ в CLAUDE.md).

/** Форма запроса. Всё, что не local, ходит по сети. */
export const PROVIDER_KINDS = ['local', 'openai-compatible', 'anthropic', 'gemini'] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/**
 * Чем провайдер добивается валидного JSON. Разбор — в shared/aiSchema.ts.
 *
 * ⚠️ Это не характеристика качества модели, а характеристика ПРОТОКОЛА. Одна и та же GPT-5 через
 * OpenAI даёт `native`, а через чей-нибудь совместимый прокси — `none`, потому что прокси не
 * обязан поддерживать `response_format`. Поэтому режим хранится у ПОДКЛЮЧЕНИЯ, а не у модели.
 */
export type SchemaMode =
  | 'grammar'  // грамматика llama.cpp: ограничение на каждом токене, невалидный ответ недостижим
  | 'native'   // response_format: json_schema (OpenAI) / responseSchema (Gemini)
  | 'tool'     // единственный инструмент с input_schema, ответ — его аргументы (Anthropic)
  | 'none';    // ничего: схему кладём в промпт и проверяем ответ сами

export interface ProviderCaps {
  schema: SchemaMode;
  stream: boolean;
  /**
   * Считается ли ЗДЕСЬ, на машине человека.
   *
   * ⚠️ Единственный источник правды для метки маршрута в интерфейсе (--dot-local против
   * --dot-cloud). Вычислять это в вёрстке по имени провайдера нельзя: Ollama на localhost — такое
   * же «здесь», как встроенная Qwen, и покрасить её как облако значило бы соврать человеку про
   * то, куда ушёл текст его страницы.
   */
  local: boolean;
}

/** Сколько запросов к этому подключению можно вести одновременно. */
export const DEFAULT_CONCURRENCY = 4;

/**
 * ⚠️ У локальной модели предел ЖЁСТКО единица, и это не настройка. У node-llama-cpp один контекст
 * на процесс — второй одновременный запрос не «медленнее», а невозможен. Отсюда же и вся нынешняя
 * очередь withQwenQueue: она существует ровно потому, что это физика, а не политика.
 */
export const LOCAL_CONCURRENCY = 1;

export interface ProviderPreset {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  /** Нужен ли ключ. Локальные раннеры отвечают кому угодно без него. */
  needsKey: boolean;
  /** Что подставить в поле модели, пока человек не выбрал своё. */
  sampleModel: string;
}

/**
 * Заготовки адресов. ⚠️ Каталогом моделей это не является и не станет: модели меняются каждую
 * неделю, и держать их список внутри браузера — обещание, которое мы не сможем выполнять. Список
 * моделей тянется у самого провайдера там, где он его отдаёт; здесь только адрес и форма.
 */
export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  { id: 'openai', label: 'OpenAI', kind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', needsKey: true, sampleModel: 'gpt-5' },
  { id: 'openrouter', label: 'OpenRouter', kind: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true, sampleModel: 'openai/gpt-5' },
  { id: 'deepseek', label: 'DeepSeek', kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', needsKey: true, sampleModel: 'deepseek-chat' },
  { id: 'groq', label: 'Groq', kind: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1', needsKey: true, sampleModel: 'llama-3.3-70b-versatile' },
  { id: 'ollama', label: 'Ollama', kind: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', needsKey: false, sampleModel: 'qwen3' },
  { id: 'lmstudio', label: 'LM Studio', kind: 'openai-compatible', baseUrl: 'http://localhost:1234/v1', needsKey: false, sampleModel: 'qwen3' },
  { id: 'anthropic', label: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', needsKey: true, sampleModel: 'claude-sonnet-5' },
  { id: 'gemini', label: 'Google Gemini', kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', needsKey: true, sampleModel: 'gemini-2.5-flash' },
];

/** Одно заведённое человеком подключение. Ключа здесь нет — только адрес и выбор. */
export interface Connection {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  concurrency: number;
  /**
   * Умеет ли этот endpoint структурный ответ нативно. Для именных провайдеров известно заранее,
   * для «совместимого» — нет: за одним и тем же адресом может стоять что угодно.
   */
  schema?: SchemaMode;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);

/**
 * Адрес указывает на эту же машину?
 *
 * ⚠️ Нужно в двух местах сразу, и оба важные: метка маршрута (Ollama на localhost — это «здесь»,
 * а не «облако») и разрешение на http (см. validateConnection).
 */
export function isLoopbackUrl(raw: string): boolean {
  const host = urlHost(raw);
  if (host === null) return false;
  return LOOPBACK_HOSTS.has(host) || host.endsWith('.localhost');
}

function urlHost(raw: string): string | null {
  // Без конструктора URL: модуль обязан работать голым node в проверке, а заодно так виднее, что
  // именно мы считаем хостом.
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)/i.exec(raw.trim());
  if (!m) return null;
  const authority = m[2] ?? '';
  const afterAuth = authority.includes('@') ? authority.slice(authority.lastIndexOf('@') + 1) : authority;
  // IPv6 в скобках: порт отрезаем только за закрывающей скобкой.
  if (afterAuth.startsWith('[')) {
    const close = afterAuth.indexOf(']');
    return close === -1 ? null : afterAuth.slice(0, close + 1).toLowerCase();
  }
  const colon = afterAuth.indexOf(':');
  const host = colon === -1 ? afterAuth : afterAuth.slice(0, colon);
  return host === '' ? null : host.toLowerCase();
}

function urlScheme(raw: string): string | null {
  const m = /^([a-z][a-z0-9+.-]*):\/\//i.exec(raw.trim());
  return m ? (m[1] ?? '').toLowerCase() : null;
}

export type ConnectionProblem =
  | 'empty-url' | 'bad-url' | 'bad-scheme' | 'plain-http-remote' | 'empty-model' | 'bad-concurrency';

/**
 * Можно ли этим подключением пользоваться.
 *
 * ⚠️ Главная проверка здесь — `plain-http-remote`, и она не педантизм. По http ключ уходит
 * открытым текстом вместе с каждым запросом, то есть достаётся любому на пути. Для loopback это
 * безразлично (трафик не покидает машину, а Ollama и LM Studio по https и не умеют), для всего
 * остального — отказ. Разрешать «на свой страх» тут нельзя: человек не видит разницы, а цена
 * ошибки — его ключ и его счёт у провайдера.
 */
export function validateConnection(c: Connection): { ok: true } | { ok: false; problem: ConnectionProblem } {
  const url = c.baseUrl.trim();
  if (!url) return { ok: false, problem: 'empty-url' };
  const scheme = urlScheme(url);
  const host = urlHost(url);
  if (scheme === null || host === null) return { ok: false, problem: 'bad-url' };
  if (scheme !== 'http' && scheme !== 'https') return { ok: false, problem: 'bad-scheme' };
  if (scheme === 'http' && !isLoopbackUrl(url)) return { ok: false, problem: 'plain-http-remote' };
  if (!c.model.trim()) return { ok: false, problem: 'empty-model' };
  if (!Number.isInteger(c.concurrency) || c.concurrency < 1 || c.concurrency > 16) {
    return { ok: false, problem: 'bad-concurrency' };
  }
  return { ok: true };
}

/** Возможности подключения. Для локальной модели адрес не смотрим — её «адрес» это наш процесс. */
export function capsFor(c: Connection): ProviderCaps {
  if (c.kind === 'local') return { schema: 'grammar', stream: true, local: true };
  return {
    schema: c.schema ?? defaultSchemaMode(c.kind),
    stream: true,
    local: isLoopbackUrl(c.baseUrl),
  };
}

/**
 * ⚠️ Для «совместимого» по умолчанию `none`, а не `native`, и это осознанный пессимизм. За таким
 * адресом может стоять прокси, старая сборка vLLM или чей-то самодельный шлюз — все они примут
 * запрос и молча проигнорируют `response_format`. Начинать с оптимистичного предположения значит
 * ловить это не на подключении, а посреди работы человека. Определить точнее умеет проба
 * подключения (кнопка «Проверить», часть 1B) — она и поднимет режим до native.
 */
export function defaultSchemaMode(kind: ProviderKind): SchemaMode {
  switch (kind) {
    case 'local': return 'grammar';
    case 'anthropic': return 'tool';
    case 'gemini': return 'native';
    case 'openai-compatible': return 'none';
  }
}

/** Предел одновременных запросов с учётом физики локальной модели. */
export function concurrencyFor(c: Connection): number {
  return c.kind === 'local' ? LOCAL_CONCURRENCY : Math.max(1, c.concurrency);
}

/** Идентификатор встроенной локальной модели. Одно имя на весь проект, чтобы не расходилось. */
export const LOCAL_CONNECTION_ID = 'local';

export function localConnection(model: string): Connection {
  return {
    id: LOCAL_CONNECTION_ID,
    label: 'На этой машине',
    kind: 'local',
    baseUrl: '',
    model,
    concurrency: LOCAL_CONCURRENCY,
    schema: 'grammar',
  };
}
