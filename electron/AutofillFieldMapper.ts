// Распознавание полей формы ЛОКАЛЬНОЙ МОДЕЛЬЮ — второй эшелон после эвристики
// (см. detectFieldKey в preload-content.ts).
//
// Зачем модель там, где есть регулярки: подписи полей бесконечно разнообразны («Куда доставить»,
// «Ваш контакт для связи», «Населённый пункт»), и каждая новая форма — это ещё один шаблон в
// список. Модель отвечает на вопрос «что это за поле» один раз, а дальше ответ живёт в кэше.
//
// ⚠️ Кэш — ПО ПОЛЮ, а не по форме. Отпечаток формы протух бы от любой перевёрстки, а подпись
// «Индекс» на сайте остаётся «Индексом» и на другой странице, и после редизайна. Поэтому ключ —
// хэш от (подпись|name|placeholder|тип), а значение — категория. Цена модели платится один раз
// на поле за всё время.
//
// ⚠️ Модель НЕ переопределяет эвристику: сюда приходят только те поля, для которых детект вернул
// «не знаю». Уверенный ответ по autocomplete-токену всегда сильнее догадки.
import { app } from 'electron';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AutofillFieldKey } from '../shared/ipc';
import { runTabOrganizePrompt, isModelWarm } from './TranslationService';

/** Описание поля, каким его видит страница. Ничего, кроме подписей, наружу не уходит. */
export interface FormFieldDescriptor {
  /** Индекс в присланном массиве — по нему страница разложит ответ обратно по полям. */
  i: number;
  label: string;
  name: string;
  placeholder: string;
  type: string;
}

// Категории, которые модель имеет право назвать. Всё остальное — «не знаю».
// ⚠️ ccExp/cc-csc здесь нет намеренно: срок одной строкой мы не заполняем, а CVC не храним вовсе.
const ALLOWED: ReadonlySet<string> = new Set<AutofillFieldKey>([
  'fullName', 'givenName', 'familyName', 'email', 'phone',
  'street', 'addressLine2', 'city', 'region', 'postalCode', 'country', 'organization',
  'ccName', 'ccNumber', 'ccExpMonth', 'ccExpYear',
]);

const MAX_FIELDS = 12;      // больше — это уже не форма адреса, а анкета; промпт должен быть коротким
const MAX_ORIGINS = 200;    // потолок файла кэша: он вспомогательный, а не архив
const MAX_PER_ORIGIN = 40;

type OriginCache = Record<string, AutofillFieldKey | ''>; // '' — модель сказала «не знаю»
let cache: Record<string, OriginCache> | null = null;
let busy = false;

function cacheFile(): string {
  return path.join(app.getPath('userData'), 'autofill-field-map.json');
}

function load(): Record<string, OriginCache> {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(cacheFile(), 'utf8');
    const parsed = JSON.parse(raw) as Record<string, OriginCache>;
    cache = (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    cache = {}; // файла нет или он битый — кэш не данные, начинаем заново
  }
  return cache;
}

// Атомарная запись tmp+rename — как у settings.json/downloads.json: половина файла на диске
// хуже, чем его отсутствие.
function save(): void {
  if (!cache) return;
  try {
    const origins = Object.keys(cache);
    if (origins.length > MAX_ORIGINS) {
      for (const o of origins.slice(0, origins.length - MAX_ORIGINS)) delete cache[o];
    }
    const file = cacheFile();
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache), 'utf8');
    fs.renameSync(tmp, file);
  } catch { /* нет доступа к диску — переживём, кэш останется в памяти */ }
}

/** Отпечаток поля: подпись + служебные имена + тип. Не адрес страницы и не её содержимое. */
function fieldHash(f: FormFieldDescriptor): string {
  const norm = (s: string): string => (s || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60);
  return createHash('sha1')
    .update([norm(f.label), norm(f.name), norm(f.placeholder), norm(f.type)].join('|'))
    .digest('hex')
    .slice(0, 16);
}

function buildPrompt(fields: FormFieldDescriptor[]): string {
  const lines = fields.map((f) => {
    const parts = [
      f.label && `label="${f.label.slice(0, 60)}"`,
      f.name && `name="${f.name.slice(0, 40)}"`,
      f.placeholder && `placeholder="${f.placeholder.slice(0, 40)}"`,
      `type=${f.type}`,
    ].filter(Boolean);
    return `${f.i + 1}. ${parts.join(' ')}`;
  });
  // Инструкция по-английски при русском содержимом — то же решение и та же причина, что в
  // TabSearch.ts: русские инструкции эта модель исполняет заметно хуже.
  return (
    `Fields of a web checkout/registration form (labels may be in Russian):\n${lines.join('\n')}\n\n` +
    `For each field, say which personal data it asks for. Allowed values:\n` +
    `${[...ALLOWED].join(', ')}\n` +
    `Use "-" if the field asks for something else (comment, promo code, login, password, search).\n\n` +
    `Reply with one line per field, exactly "N: value". Nothing else.`
  );
}

/**
 * Синонимы имён категорий.
 *
 * ⚠️ Не «на всякий случай», а по факту замера: модель отвечает именами из HTML-спеки
 * (`postal-code`, `street-address`, `address-level2`) — она их знает лучше, чем наши внутренние
 * ключи. Первый прогон из-за этого потерял «Почтовый код» и «Куда доставить», хотя ответ модели
 * был верным по сути. Спорить с ней бессмысленно — проще понимать оба языка.
 */
const SYNONYMS: Record<string, AutofillFieldKey> = {
  name: 'fullName', fullname: 'fullName',
  givenname: 'givenName', firstname: 'givenName',
  familyname: 'familyName', lastname: 'familyName', surname: 'familyName',
  tel: 'phone', telephone: 'phone', mobile: 'phone', phonenumber: 'phone',
  streetaddress: 'street', addressline1: 'street', address: 'street',
  addressline2: 'addressLine2', apartment: 'addressLine2',
  addresslevel2: 'city', town: 'city',
  addresslevel1: 'region', state: 'region', province: 'region',
  postalcode: 'postalCode', zip: 'postalCode', zipcode: 'postalCode', postcode: 'postalCode',
  countryname: 'country',
  company: 'organization',
  ccname: 'ccName', cardholder: 'ccName',
  ccnumber: 'ccNumber', cardnumber: 'ccNumber',
  ccexpmonth: 'ccExpMonth', ccexpyear: 'ccExpYear',
};

/** Разбор построчного ответа. Всё, что не опознано, отбрасывается молча. */
function parseAnswer(out: string, fields: FormFieldDescriptor[]): Record<number, AutofillFieldKey> {
  const byNumber = new Map<number, string>();
  for (const line of out.split('\n')) {
    // ⚠️ Цифры в значении обязательны: имена категорий кончаются на них — addressLine2,
    // address-line1, address-level2. Без \d здесь строка «3: addressLine2» не совпадала целиком,
    // и верный ответ модели молча выбрасывался (поймано на живом прогоне: модель узнала поле,
    // а разбор его потерял).
    const m = /^\s*(\d+)\s*[:.)-]\s*([A-Za-z][A-Za-z0-9_-]*)\s*$/.exec(line.trim());
    if (m) byNumber.set(Number(m[1]), m[2]!);
  }
  const result: Record<number, AutofillFieldKey> = {};
  for (const f of fields) {
    const raw = byNumber.get(f.i + 1);
    if (!raw || raw === '-') continue;
    // Приводим к общему виду: без дефисов/подчёркиваний и регистра — тогда «postal-code»,
    // «postal_code» и «postalCode» это одно и то же слово.
    const flat = raw.toLowerCase().replace(/[-_]/g, '');
    const direct = [...ALLOWED].find((k) => k.toLowerCase() === flat);
    const key = direct ?? SYNONYMS[flat];
    if (key) result[f.i] = key as AutofillFieldKey;
  }
  return result;
}

/**
 * Определить категории неопознанных полей. Возвращает карту «индекс поля → категория» —
 * только для тех, в которых есть уверенность (из кэша или от модели).
 *
 * ⚠️ Модель зовётся только на ТЁПЛУЮ (см. isModelWarm) и по одному запросу за раз: человек
 * просто открыл страницу с формой, он не заказывал тридцатисекундную загрузку 9B. Пока модель
 * холодная, работает один кэш — то есть сайты, уже разобранные раньше, продолжают заполняться.
 */
export async function mapFormFields(
  origin: string,
  fields: FormFieldDescriptor[],
): Promise<Record<number, AutofillFieldKey>> {
  if (!origin || !Array.isArray(fields) || fields.length === 0) return {};
  const limited = fields.slice(0, MAX_FIELDS);
  const store = load();
  const originCache: OriginCache = store[origin] ?? {};

  const result: Record<number, AutofillFieldKey> = {};
  const unknown: FormFieldDescriptor[] = [];
  for (const f of limited) {
    const cached = originCache[fieldHash(f)];
    if (cached === undefined) unknown.push(f);
    else if (cached) result[f.i] = cached;   // '' — «модель уже смотрела и не узнала», не спрашиваем снова
  }
  if (unknown.length === 0) return result;
  if (busy || !isModelWarm()) return result; // отдаём то, что знаем из кэша

  busy = true;
  try {
    // ⚠️ Фоновая полоса: человек просто открыл страницу с формой (см. QwenQueue.ts).
    const res = await runTabOrganizePrompt(buildPrompt(unknown), { background: true });
    if (!res.ok) {
      console.warn('[autofill-map] модель не ответила:', res.error);
      return result;
    }
    const guessed = parseAnswer(res.out, unknown);
    // В кэш пишем и отрицательный ответ: иначе на каждой перезагрузке страницы мы бы заново
    // спрашивали модель про поле «Комментарий к заказу».
    for (const f of unknown) {
      originCache[fieldHash(f)] = guessed[f.i] ?? '';
      if (guessed[f.i]) result[f.i] = guessed[f.i]!;
    }
    const keys = Object.keys(originCache);
    if (keys.length > MAX_PER_ORIGIN) {
      for (const k of keys.slice(0, keys.length - MAX_PER_ORIGIN)) delete originCache[k];
    }
    store[origin] = originCache;
    save();
    // Сырой ответ в логе — это категории полей, а не то, что человек ввёл (значения сюда не
    // приходят вовсе). Без него не отличить «модель не узнала» от «мы не так разобрали».
    console.log(`[autofill-map] ${origin}: спросили про ${unknown.length} пол(я), узнали ${Object.keys(guessed).length}; ответ: ${JSON.stringify(res.out.slice(0, 200))}`);
    return result;
  } catch (e) {
    console.warn('[autofill-map] ошибка:', e);
    return result;
  } finally {
    busy = false;
  }
}
