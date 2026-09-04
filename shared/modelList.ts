// Список моделей, который отдаёт сам провайдер.
//
// ⚠️ Зачем вообще. Имя модели человек вбивал руками, а `sampleModel` в PROVIDER_PRESETS —
// только подсказка. Ошибка в имени не видна до первого настоящего запроса: адрес отвечает,
// ключ принят, а модель «не найдена» — и человек читает это как «браузер не работает».
// У OpenAI-совместимых, Anthropic и Gemini список есть у самого провайдера, то есть угадывать
// не нужно вовсе. Заодно у локального раннера это единственный честный ответ на вопрос «что у
// меня реально скачано».
//
// ⚠️ КАТАЛОГОМ МОДЕЛЕЙ это по-прежнему не является (см. шапку aiProviders.ts): внутри браузера
// никакого списка не лежит, мы только показываем то, что ответил провайдер в эту минуту.
//
// ⚠️ Разбор ТЕРПИМЫЙ везде. За «совместимым» адресом стоит что угодно — прокси, старая сборка
// vLLM, чей-то шлюз, — и половина из них отвечает похожим, но не тем. Кривая запись выбрасывается
// поштучно; уронить весь список из-за одной означало бы вернуть человека к ручному вводу ровно
// там, где список нужнее всего.
//
// Значимых импортов нет — модуль под проверкой (scripts/model-list-check.mjs), а она гоняется
// голым node (см. правило про shared/ в CLAUDE.md).

import type { ProviderKind } from './aiProviders';

/** Сколько имён берём из ответа. Защита от чужого сервера, а не продуктовое ограничение. */
const MAX_MODELS = 1000;
/** Длиннее этого — не имя модели, а мусор в поле. Самое длинное живое имя около 60 знаков. */
const MAX_NAME = 200;

/** Адрес без хвостовой косой: `https://host/v1/` и `https://host/v1` — один и тот же адрес. */
export function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * Куда идти за списком.
 *
 * ⚠️ У трёх форм запроса база кончается по-разному, и это не мелочь: у OpenAI-совместимого адрес
 * УЖЕ содержит `/v1`, у Gemini — `/v1beta`, а у Anthropic базой считается голый хост. Слепое
 * `${base}/v1/models` дало бы `/v1/v1/models` там, где человек дописал версию сам, — а он её
 * дописывает, потому что видел её в документации провайдера.
 */
export function modelsUrl(baseUrl: string, kind: ProviderKind): string | null {
  const base = normalizeBase(baseUrl);
  if (base === '' || kind === 'local') return null;
  if (kind === 'anthropic') return /\/v\d+[a-z]*$/i.test(base) ? `${base}/models` : `${base}/v1/models`;
  return `${base}/models`;
}

/**
 * Имена моделей из ответа провайдера.
 *
 * ⚠️ Формы ДВЕ, а не три: `data[].id` отвечают и OpenAI-совместимые, и Anthropic; своя только у
 * Gemini — `models[].name` с приставкой `models/`. Поэтому и разбираем по форме ответа, а не по
 * тому, к кому мы собирались идти: за «совместимым» адресом человек заводит и Gemini через
 * прокси, и наоборот.
 *
 * ⚠️ У Gemini выбрасываем всё, что не умеет `generateContent`. Иначе в списке рядом с рабочими
 * моделями стоят эмбеддинги и `aqa`, которые на первом же запросе ответят отказом, — то есть
 * выпадашка предлагает заведомо нерабочий выбор, а это хуже ручного ввода.
 */
export function parseModelList(json: unknown, kind: ProviderKind): string[] {
  const out: string[] = [];
  for (const item of arrayAt(json, kind === 'gemini' ? 'models' : 'data')) {
    const name = modelName(item);
    if (name === null) continue;
    out.push(name);
  }
  // Дубликаты приходят от шлюзов, склеивающих несколько апстримов в один список.
  return [...new Set(out)].sort().slice(0, MAX_MODELS);
}

function modelName(item: unknown): string | null {
  if (typeof item !== 'object' || item === null) return null;
  const o = item as Record<string, unknown>;
  const raw = typeof o['id'] === 'string' ? o['id'] : typeof o['name'] === 'string' ? o['name'] : null;
  if (raw === null) return null;
  // Gemini называет модель полным путём ресурса: «models/gemini-2.5-flash».
  const name = raw.trim().replace(/^models\//, '');
  if (name === '' || name.length > MAX_NAME) return null;
  if (!supportsGeneration(o)) return null;
  return name;
}

/**
 * ⚠️ Отсутствие поля — НЕ отказ. Его нет ни у кого, кроме Gemini, и трактовать пустоту как «не
 * умеет» значило бы вернуть пустой список у всех остальных.
 */
function supportsGeneration(o: Record<string, unknown>): boolean {
  const methods = o['supportedGenerationMethods'];
  if (!Array.isArray(methods)) return true;
  return methods.includes('generateContent');
}

/**
 * Похоже ли это на ответ со списком моделей вообще.
 *
 * ⚠️ Нужно отдельно от разбора, потому что ПУСТОЙ список — законный ответ: Ollama сразу после
 * установки отвечает `{"object":"list","data":null}`, и это не поломка, а «моделей ещё нет».
 * Отличить такой ответ от чужой службы, которая на любой путь отдаёт 200 и своё содержимое,
 * можно только по форме: у списка есть поле `data` или `models` — пусть даже пустое.
 */
export function looksLikeModelList(json: unknown): boolean {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return false;
  const o = json as Record<string, unknown>;
  return 'data' in o || 'models' in o;
}

function arrayAt(json: unknown, key: string): readonly unknown[] {
  if (typeof json !== 'object' || json === null) return [];
  const v = (json as Record<string, unknown>)[key];
  return Array.isArray(v) ? v : [];
}

/**
 * Что показать под полем, пока человек печатает.
 *
 * ⚠️ Совпадение с НАЧАЛА идёт первым, и это не украшение. У OpenRouter в списке три сотни имён
 * вида `openai/gpt-5`, `deepseek/deepseek-chat`; запрос «gpt» подстрокой находит и `openai/gpt-5`,
 * и десяток чужих, где gpt стоит в середине. Без приоритета начала человек не находит глазами
 * ровно то, что набрал.
 */
export function filterModels(models: readonly string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...models];
  const starts: string[] = [];
  const inside: string[] = [];
  for (const m of models) {
    const low = m.toLowerCase();
    // Совпадением с начала считаем и начало имени после слэша: `openai/gpt-5` на запрос «gpt».
    if (low.startsWith(q) || low.slice(low.indexOf('/') + 1).startsWith(q)) starts.push(m);
    else if (low.includes(q)) inside.push(m);
  }
  return [...starts, ...inside];
}
