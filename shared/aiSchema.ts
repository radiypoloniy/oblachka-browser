// Мост между НАШЕЙ схемой ответа и тем, что понимает конкретный провайдер.
//
// ⚠️ Зачем это вообще нужно. Всё AI-ядро проекта стоит на грамматике node-llama-cpp
// (createGrammarForJsonSchema): ограничение применяется на КАЖДОМ токене, поэтому невалидный
// ответ не «редкий», а недостижимый. Именно это снимает главную слабость моделей 3–4B — они
// плывут в структуре, а не в понимании. В облаке грамматики нет, и единой замены ей тоже нет:
// у OpenAI это `response_format: json_schema`, у Gemini — `responseSchema`, у Anthropic строгого
// JSON-режима нет вовсе и ближайшее — единственный инструмент с `input_schema`, а за произвольным
// «OpenAI-совместимым» адресом может не оказаться ничего.
//
// ⚠️ И главное: провайдер гарантирует ФОРМУ, но теряет ГРАНИЦЫ. `maxLength`, `minItems`,
// `maxItems` в строгих режимах либо не поддерживаются, либо молча игнорируются — а у нас на них
// держится вёрстка (виджет на 40 элементов вместо 16 разъедет плитку). Поэтому здесь ДВЕ функции,
// и они не дублируют друг друга: toDialect() отдаёт провайдеру то, что он примет, а
// validateAgainst() проверяет ответ по ИСХОДНОЙ схеме — включая всё, что диалект выбросил.
//
// ⚠️ Все перечисленные свойства считаются ОБЯЗАТЕЛЬНЫМИ. Так их понимает грамматика llama.cpp:
// в наших схемах (см. shared/genSpec.ts) `required` не пишется нигде, и при этом поле не может не
// прийти. Валидатор обязан требовать того же — иначе облачный ответ с пропущенным полем прошёл бы
// там, где локальный был физически невозможен, и разница между провайдерами утекла бы в вёрстку.
//
// Значимых импортов нет — модуль под проверкой (scripts/ai-schema-check.mjs), она гоняется голым
// node (см. правило про shared/ в CLAUDE.md).

/** Схема как мы её пишем: подмножество JSON Schema, которое понимает грамматика. */
export type JsonSchema = Record<string, unknown>;

/** Во что переводим. Совпадает с SchemaMode из aiProviders, но описывает ДИАЛЕКТ, а не механизм. */
export type SchemaDialect = 'openai' | 'gemini' | 'anthropic';

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function props(schema: Record<string, unknown>): Record<string, unknown> | null {
  const p = schema['properties'];
  return isObj(p) ? p : null;
}

/**
 * Тип, выведенный из схемы. ⚠️ `enum` у нас пишется БЕЗ `type` (см. GEN_KIND_SCHEMA), а строгие
 * режимы OpenAI и Gemini без типа схему не примут — поэтому выводим его из самих значений.
 */
function inferredType(schema: Record<string, unknown>): string | null {
  const t = schema['type'];
  if (typeof t === 'string') return t;
  const e = schema['enum'];
  if (Array.isArray(e) && e.length > 0) {
    if (e.every((v) => typeof v === 'string')) return 'string';
    if (e.every((v) => typeof v === 'number')) return 'number';
  }
  return null;
}

// Границы, которые строгие режимы не принимают. Их снимает диалект и восстанавливает валидатор.
const BOUNDS = ['maxLength', 'minLength', 'maxItems', 'minItems', 'pattern'] as const;

/**
 * Наша схема → то, что примет провайдер.
 *
 * Общее для всех трёх диалектов: проставить `type` там, где он выводится из enum, и объявить все
 * свойства обязательными. Различия: OpenAI в strict-режиме требует `additionalProperties: false` и
 * отвергает неизвестные ключевые слова; Gemini держит OpenAPI-подмножество и `additionalProperties`
 * не знает; Anthropic принимает обычную JSON Schema целиком.
 */
export function toDialect(schema: JsonSchema, dialect: SchemaDialect): JsonSchema {
  const out: Record<string, unknown> = {};
  const type = inferredType(schema);

  for (const [key, value] of Object.entries(schema)) {
    if (key === 'properties' || key === 'items') continue;
    // Границы длины и размера переживают только Anthropic; у Gemini оставляем размеры массива —
    // они в OpenAPI-подмножестве есть и реально влияют на ответ.
    if ((BOUNDS as readonly string[]).includes(key)) {
      if (dialect === 'anthropic') out[key] = value;
      else if (dialect === 'gemini' && (key === 'minItems' || key === 'maxItems')) out[key] = value;
      continue;
    }
    out[key] = value;
  }

  if (type !== null) out['type'] = type;

  const p = props(schema);
  if (p) {
    const converted: Record<string, unknown> = {};
    for (const [name, sub] of Object.entries(p)) {
      converted[name] = isObj(sub) ? toDialect(sub, dialect) : sub;
    }
    out['properties'] = converted;
    // Все свойства обязательны — см. ⚠️ в шапке файла.
    out['required'] = Object.keys(converted);
    if (dialect === 'openai' || dialect === 'anthropic') out['additionalProperties'] = false;
    if (out['type'] === undefined) out['type'] = 'object';
  }

  const items = schema['items'];
  if (isObj(items)) out['items'] = toDialect(items, dialect);

  return out;
}

/**
 * Схема словами — для подключений, которые структурного режима не умеют вовсе (`SchemaMode: none`).
 *
 * ⚠️ Это САМЫЙ СЛАБЫЙ из четырёх путей, и притворяться иначе не надо: здесь нет никакой гарантии,
 * только просьба. Держит его validateAgainst() с одним ремонтным повтором — то есть честный отказ
 * вместо тихой чепухи в интерфейсе.
 */
export function describeSchema(schema: JsonSchema, indent = 0): string {
  const pad = '  '.repeat(indent);
  const type = inferredType(schema);
  const e = schema['enum'];
  if (Array.isArray(e)) return `одно из: ${e.map((v) => JSON.stringify(v)).join(', ')}`;

  const p = props(schema);
  if (p) {
    const lines = Object.entries(p).map(([name, sub]) => {
      const desc = isObj(sub) ? describeSchema(sub, indent + 1) : 'значение';
      return `${pad}  "${name}": ${desc}`;
    });
    return `объект со всеми полями:\n${lines.join('\n')}`;
  }

  if (type === 'array') {
    const items = schema['items'];
    const inner = isObj(items) ? describeSchema(items, indent + 1) : 'значение';
    const min = schema['minItems'];
    const max = schema['maxItems'];
    const count = typeof min === 'number' && typeof max === 'number' ? ` (${min}–${max} шт.)` : '';
    return `массив${count}, элемент — ${inner}`;
  }

  const maxLen = schema['maxLength'];
  const limit = typeof maxLen === 'number' ? ` не длиннее ${maxLen} символов` : '';
  return `${type ?? 'значение'}${limit}`;
}

/**
 * Ответ провайдера против ИСХОДНОЙ схемы — со всеми границами, которые диалект выбросил.
 *
 * Возвращает список претензий на русском: он идёт не только в лог, но и в ремонтный повтор
 * (electron/ai/structured.ts), то есть модель читает его как инструкцию, что именно исправить.
 */
export function validateAgainst(schema: JsonSchema, value: unknown, path = ''): string[] {
  const errors: string[] = [];
  const where = path || 'ответ';
  const type = inferredType(schema);

  const e = schema['enum'];
  if (Array.isArray(e)) {
    if (!e.includes(value as never)) {
      errors.push(`${where}: ожидалось одно из ${e.map((v) => JSON.stringify(v)).join(', ')}, пришло ${JSON.stringify(value)}`);
    }
    return errors;
  }

  const p = props(schema);
  if (p || type === 'object') {
    if (!isObj(value)) {
      errors.push(`${where}: ожидался объект, пришло ${JSON.stringify(value)}`);
      return errors;
    }
    for (const [name, sub] of Object.entries(p ?? {})) {
      if (!(name in value)) {
        errors.push(`${where}: нет обязательного поля "${name}"`);
        continue;
      }
      if (isObj(sub)) errors.push(...validateAgainst(sub, value[name], path ? `${path}.${name}` : name));
    }
    return errors;
  }

  if (type === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${where}: ожидался массив, пришло ${JSON.stringify(value)}`);
      return errors;
    }
    const min = schema['minItems'];
    const max = schema['maxItems'];
    if (typeof min === 'number' && value.length < min) errors.push(`${where}: элементов ${value.length}, нужно не меньше ${min}`);
    if (typeof max === 'number' && value.length > max) errors.push(`${where}: элементов ${value.length}, нужно не больше ${max}`);
    const items = schema['items'];
    if (isObj(items)) {
      for (let i = 0; i < value.length; i++) errors.push(...validateAgainst(items, value[i], `${where}[${i}]`));
    }
    return errors;
  }

  if (type === 'string') {
    if (typeof value !== 'string') {
      errors.push(`${where}: ожидалась строка, пришло ${JSON.stringify(value)}`);
      return errors;
    }
    const maxLen = schema['maxLength'];
    const minLen = schema['minLength'];
    if (typeof maxLen === 'number' && value.length > maxLen) errors.push(`${where}: длина ${value.length}, максимум ${maxLen}`);
    if (typeof minLen === 'number' && value.length < minLen) errors.push(`${where}: длина ${value.length}, минимум ${minLen}`);
    return errors;
  }

  if (type === 'number' || type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push(`${where}: ожидалось число, пришло ${JSON.stringify(value)}`);
      return errors;
    }
    if (type === 'integer' && !Number.isInteger(value)) errors.push(`${where}: ожидалось целое, пришло ${value}`);
    return errors;
  }

  if (type === 'boolean' && typeof value !== 'boolean') {
    errors.push(`${where}: ожидалось да/нет, пришло ${JSON.stringify(value)}`);
  }

  return errors;
}

/**
 * Достать объект из ответа, который МОГ прийти текстом.
 *
 * ⚠️ Нужно только для режима `none`. Забор из ``` и болтовня вокруг JSON — ровно тот класс задач,
 * который в проекте был закрыт грамматикой (см. шапку GenSpecParser.ts) и который возвращается
 * вместе с подключением без структурного режима. Поэтому разбор здесь нарочито тупой: найти
 * первую фигурную скобку и последнюю, распарсить, не угадывать намерение. Всё, что не разобралось,
 * идёт в честный отказ, а не в починку текста.
 */
export function extractJson(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const text = raw.trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last <= first) return { ok: false, error: 'в ответе нет объекта JSON' };
  try {
    return { ok: true, value: JSON.parse(text.slice(first, last + 1)) };
  } catch (e) {
    return { ok: false, error: `ответ не разбирается как JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
}
