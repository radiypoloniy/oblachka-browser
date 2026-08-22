// Свой виджет как ДАННЫЕ, а не как код.
//
// ⚠️ Здесь сменилась концепция, и это главное, что нужно знать про файл. Раньше модель писала
// HTML и скрипт, а хост пытался их обезвредить и починить. Локальная 4B этого не умеет: на
// «змейку» она выдавала 250 пустых <div class="cell">, на «кубик» — карточку со словом, на
// «цитату» — одно слово. Провал был не в промпте, а в задаче: модель просили ИЗОБРЕСТИ
// ИНТЕРФЕЙС И НАПИСАТЬ КОД — самое трудное, что ей можно поручить, и ровно то, чего человек
// не просил. Ему нужен виджет, а не код.
//
// Теперь модель делает то, что маленькая модель делает хорошо: понимает фразу, выбирает ТИП из
// закрытого каталога и заполняет ПОЛЯ. Рисует хост — руками, в дизайн-системе, как «Погоду».
// Это то же правило, по которому в проекте сделана «Студия» блокнота (markmap + свои карточки)
// и по которому оттуда убрали @antv/infographic.
//
// ⚠️ Ответ модели ограничен ГРАММАТИКОЙ (node-llama-cpp createGrammarForJsonSchema): ограничение
// применяется на каждом токене, поэтому невалидный ответ не «редкий», а недостижимый. Именно это
// снимает главную слабость моделей 3–4B — они плывут в структуре, а не в понимании.
//
// Значимых импортов нет — проверка scripts/gen-spec-check.mjs гоняет модуль голым node.

export const GEN_SPEC_VERSION = 1;

/** Закрытый каталог. Каждый тип нарисован руками и работает всегда. */
export const GEN_KINDS = [
  'list',      // один элемент из списка, клик меняет: слово/перевод, цитата/автор, факт
  'dice',      // жребий: грани придумывает модель («что на ужин»), бросок с анимацией
  'counter',   // счётчик с шагом и единицей, состояние на диске
  'checklist', // галочки: привычки, сборы
  'timer',     // обратный отсчёт
  'goal',      // цель и прогресс: «120 из 300 страниц»
  'countdown', // сколько дней до даты
  'note',      // крупный текст-памятка
  'feed',      // список: из браузера или по ссылке человека (RSS/Atom)
  'stat',      // одно большое число: из браузера или по ссылке человека (JSON)
  'zones',     // часы в других поясах — считается локально, без сети
] as const;

export type GenKind = (typeof GEN_KINDS)[number];

/**
 * Откуда плитка берёт настоящие данные.
 *
 * ⚠️ Это ответ на главную претензию 22.08: модель не знает про браузер НИЧЕГО и на просьбу
 * «список последних посещённых сайтов» честно выдумывала («Счастье — внутри вас»). Выдумать
 * историю нельзя — её можно только взять. Поэтому модель здесь выбирает ИСТОЧНИК из закрытого
 * списка, а данные подставляет хост в момент показа. Заодно они всегда свежие.
 */
export const GEN_SOURCES = ['history', 'topsites', 'tabs', 'downloads', 'blocked', 'web'] as const;
export type GenSource = (typeof GEN_SOURCES)[number];

export function isGenSource(v: unknown): v is GenSource {
  return typeof v === 'string' && (GEN_SOURCES as readonly string[]).includes(v);
}

/** Что источник умеет отдавать: ленту, число или и то и другое. */
const SOURCE_SHAPE: Record<GenSource, { feed: boolean; stat: boolean }> = {
  history:   { feed: true,  stat: false },
  topsites:  { feed: true,  stat: false },
  tabs:      { feed: true,  stat: true },
  downloads: { feed: true,  stat: true },
  blocked:   { feed: false, stat: true },
  // Ссылку даёт человек, поэтому 'web' умеет обе формы: лента из фида и число из JSON.
  web:       { feed: true,  stat: true },
};

export function genSourceLabel(src: GenSource): string {
  switch (src) {
    case 'history': return 'Последние сайты';
    case 'topsites': return 'Частые сайты';
    case 'tabs': return 'Открытые вкладки';
    case 'downloads': return 'Загрузки';
    case 'blocked': return 'Срезано трекеров';
    case 'web': return 'По вашей ссылке';
  }
}

export interface GenItem {
  /** Что показывается крупно. */
  main: string;
  /** Тихая строка под ним: перевод, автор, пояснение. */
  sub?: string;
}

export interface GenSpec {
  v: number;
  kind: GenKind;
  /** Подпись плитки — та же роль, что CAPTION у готовых виджетов. */
  title: string;
  /** list · dice · checklist */
  items?: GenItem[];
  /** counter · goal: что считаем («стакан», «страниц»). */
  unit?: string;
  /** counter: на сколько меняет одна кнопка. */
  step?: number;
  /** counter · goal: с чего начинаем. */
  start?: number;
  /** goal: сколько всего. */
  target?: number;
  /** timer: длительность в секундах. */
  seconds?: number;
  /** countdown: дата в формате YYYY-MM-DD. */
  date?: string;
  /** note: сам текст. */
  text?: string;
  /** feed · stat: откуда берутся настоящие данные. */
  source?: GenSource;
  /** feed: сколько строк показывать. */
  rows?: number;
  /** feed · stat при source==='web': адрес, который дал ЧЕЛОВЕК. Модель адресов не выдумывает. */
  url?: string;
  /** stat при source==='web': путь к значению в JSON, выбранный по настоящему образцу ответа. */
  path?: string;
  /** dice: бросок ЧИСЛА, а не строки. from < to. */
  from?: number;
  to?: number;
}

export const GEN_TITLE_MAX = 24;
export const GEN_ITEM_MAX = 90;
export const GEN_SUB_MAX = 60;
export const GEN_ITEMS_MAX = 24;
export const GEN_TEXT_MAX = 220;

/** Сколько элементов списка осмысленно для каждого типа. Ниже — виджет не собирается. */
export const GEN_ITEMS_MIN: Partial<Record<GenKind, number>> = {
  list: 4,
  dice: 2,
  checklist: 2,
};

// ── Схемы для грамматики ─────────────────────────────────────────────────────
// ⚠️ Два прогона, а не один: сначала ТИП, потом ДАННЫЕ под этот тип. Одно решение на прогон —
// то же правило, по которому в проекте разведены прогоны перевода и разбора (см. CLAUDE.md про
// «плавающий» ответ). Плюс схема данных выходит маленькой, и модели негде запутаться.

export const GEN_KIND_SCHEMA = {
  type: 'object',
  properties: {
    kind: { enum: [...GEN_KINDS] },
    title: { type: 'string', maxLength: GEN_TITLE_MAX },
  },
} as const;

/**
 * Что вытащить из JSON по ссылке человека. Отдельная схема, не привязанная к типу: этот прогон
 * случается только когда ссылка уже скачана и модель видит НАСТОЯЩИЙ образец ответа.
 */
export const GEN_WEB_VALUE_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string', maxLength: 120 },
    unit: { type: 'string', maxLength: 16 },
    title: { type: 'string', maxLength: GEN_TITLE_MAX },
  },
} as const;

/** Схема данных под выбранный тип. Лишних полей в ней нет — грамматика их просто не допустит. */
export function genDataSchema(kind: GenKind): Record<string, unknown> {
  const item = {
    type: 'object',
    properties: {
      main: { type: 'string', maxLength: GEN_ITEM_MAX },
      sub: { type: 'string', maxLength: GEN_SUB_MAX },
    },
  };
  switch (kind) {
    case 'list':
      return { type: 'object', properties: { items: { type: 'array', items: item, minItems: 6, maxItems: 16 } } };
    case 'dice':
      // ⚠️ Две формы жребия и ЯВНЫЙ переключатель между ними.
      //
      // Сначала форм не было вовсе: «кубик со случайным числом» модель заполняла словами
      // («Карты», «Шашки», «Бросай!»), потому что в схеме были только строки. Появился числовой
      // диапазон — и сломалась монетка: заполнив и числа, и грани, модель получала числа,
      // потому что приоритет был зашит в код. Оба раза причина одна — РЕШЕНИЕ ПРИНИМАЛ НЕ ТОТ:
      // выбор между «числом» и «словами» знает только тот, кто прочитал фразу.
      return {
        type: 'object',
        properties: {
          mode: { enum: ['numbers', 'faces'] },
          items: { type: 'array', items: item, maxItems: 12 },
          from: { type: 'integer' },
          to: { type: 'integer' },
        },
      };
    case 'checklist':
      return { type: 'object', properties: { items: { type: 'array', items: item, minItems: 3, maxItems: 8 } } };
    case 'counter':
      return {
        type: 'object',
        properties: {
          unit: { type: 'string', maxLength: 16 },
          step: { type: 'integer' },
          start: { type: 'integer' },
        },
      };
    case 'goal':
      return {
        type: 'object',
        properties: {
          unit: { type: 'string', maxLength: 16 },
          target: { type: 'integer' },
          start: { type: 'integer' },
        },
      };
    case 'timer':
      return { type: 'object', properties: { seconds: { type: 'integer' } } };
    case 'countdown':
      return { type: 'object', properties: { date: { type: 'string', format: 'date' } } };
    case 'note':
      return { type: 'object', properties: { text: { type: 'string', maxLength: GEN_TEXT_MAX } } };
    case 'feed':
      // ⚠️ 'web' из перечисления УБРАН намеренно: этот источник выбирает не модель, а человек —
      // тем, что дал ссылку. Предложи мы его модели, она начала бы выдумывать адреса.
      return {
        type: 'object',
        properties: {
          source: { enum: GEN_SOURCES.filter((x) => SOURCE_SHAPE[x].feed && x !== 'web') },
          rows: { type: 'integer' },
        },
      };
    case 'stat':
      return {
        type: 'object',
        properties: { source: { enum: GEN_SOURCES.filter((x) => SOURCE_SHAPE[x].stat && x !== 'web') } },
      };
    case 'zones':
      return {
        type: 'object',
        properties: { items: { type: 'array', items: item, minItems: 1, maxItems: 4 } },
      };
  }
}

// ── Приведение к порядку ─────────────────────────────────────────────────────
// ⚠️ Грамматика гарантирует ФОРМУ, но не смысл: шаг 0, цель 0, дата в прошлом и пустые строки
// она пропустит. Поэтому спека, пришедшая от модели, всегда проходит здесь.

export function isGenKind(v: unknown): v is GenKind {
  return typeof v === 'string' && (GEN_KINDS as readonly string[]).includes(v);
}

function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v.replace(/\s+/g, ' ').replace(/^["'«»\s]+|["'«»\s]+$/g, '').slice(0, max).trim();
}

function cleanItems(v: unknown): GenItem[] {
  if (!Array.isArray(v)) return [];
  const out: GenItem[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    const main = cleanText(o.main, GEN_ITEM_MAX);
    if (main.length < 1) continue;
    const key = main.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const sub = cleanText(o.sub, GEN_SUB_MAX);
    out.push(sub ? { main, sub } : { main });
    if (out.length >= GEN_ITEMS_MAX) break;
  }
  return out;
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? Math.round(v) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/** Дата в будущем. ⚠️ Прошедшую дату не «чиним» молча — такой виджет бессмыслен, см. validate. */
export function isFutureDate(date: string, now = Date.now()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const t = Date.parse(`${date}T00:00:00`);
  if (!Number.isFinite(t)) return false;
  return t > now - 86_400_000;
}

export function daysUntil(date: string, now = Date.now()): number {
  const t = Date.parse(`${date}T00:00:00`);
  if (!Number.isFinite(t)) return 0;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  return Math.round((t - startOfToday.getTime()) / 86_400_000);
}

/**
 * Спека, годная к показу, — или null.
 *
 * ⚠️ null здесь означает «виджет не собрался», и это ЧЕСТНЫЙ исход, который человек увидит
 * словами. Прежний код в такой ситуации ставил на стол пустую плитку, и отличить её от
 * поломки всей функции было нельзя — с этого и начался разбор 22.08.
 */
export function validateGenSpec(raw: unknown, now = Date.now()): GenSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!isGenKind(o.kind)) return null;
  const kind = o.kind;
  const title = cleanText(o.title, GEN_TITLE_MAX);
  const spec: GenSpec = { v: GEN_SPEC_VERSION, kind, title: title || defaultTitle(kind) };

  if (kind === 'dice') {
    const from = typeof o.from === 'number' ? Math.round(o.from) : Number.NaN;
    const to = typeof o.to === 'number' ? Math.round(o.to) : Number.NaN;
    const numeric = Number.isFinite(from) && Number.isFinite(to) && to > from && to - from <= 10_000;
    const items = cleanItems(o.items);
    // ⚠️ Слушаемся ЯВНОГО выбора модели, а не зашитого приоритета. Запасной путь есть у обеих
    // веток: выбрала числа, но диапазона нет — берём грани, и наоборот. Иначе одна пропущенная
    // мелочь превращала бы весь виджет в отказ.
    const wantsNumbers = o.mode === 'numbers' ? true : o.mode === 'faces' ? false : items.length < 2;
    if (wantsNumbers && numeric) {
      spec.from = from;
      spec.to = to;
      return spec;
    }
    if (items.length >= 2) {
      spec.items = items;
      return spec;
    }
    if (numeric) {
      spec.from = from;
      spec.to = to;
      return spec;
    }
    return null;
  }
  if (kind === 'list' || kind === 'checklist') {
    const items = cleanItems(o.items);
    if (items.length < (GEN_ITEMS_MIN[kind] ?? 2)) return null;
    spec.items = items;
    return spec;
  }
  if (kind === 'feed' || kind === 'stat') {
    if (!isGenSource(o.source)) return null;
    // ⚠️ Источник обязан УМЕТЬ нужную форму: «срезано трекеров» — это число, лентой оно не бывает.
    if (!SOURCE_SHAPE[o.source][kind === 'feed' ? 'feed' : 'stat']) return null;
    spec.source = o.source;
    if (o.source === 'web') {
      // ⚠️ Адрес обязан быть годным ЗДЕСЬ, а не только в момент запроса: спека уходит на диск,
      // и виджет с http-ссылкой или адресом роутера не должен вообще существовать.
      const url = typeof o.url === 'string' ? o.url.trim() : '';
      if (!isAllowedGenUrl(url)) return null;
      spec.url = url;
      if (kind === 'stat') {
        const path = typeof o.path === 'string' ? o.path.trim().slice(0, 120) : '';
        if (!path) return null; // число без пути в ответе взять неоткуда
        spec.path = path;
      }
    }
    if (kind === 'feed') spec.rows = clampInt(o.rows, 3, 12, 5);
    if (typeof o.unit === 'string') {
      const unit = cleanText(o.unit, 16);
      if (unit) spec.unit = unit;
    }
    return spec;
  }
  if (kind === 'zones') {
    // ⚠️ Пояса СЧИТАЮТСЯ ЛОКАЛЬНО. Живой вопрос 22.08 — «выйдет ли виджет из сайта-конвертера
    // часовых поясов»: из сайта не выйдет (там нет ни фида, ни JSON), а виджет — выйдет, потому
    // что перевод времени это не чужие данные, а вычисление. В ICU лежат все 400+ поясов.
    const items = cleanItems(o.items).filter((it) => isKnownTimeZone(it.main));
    if (items.length < 1) return null;
    spec.items = items.slice(0, 4);
    return spec;
  }
  if (kind === 'counter') {
    const unit = cleanText(o.unit, 16);
    if (unit) spec.unit = unit;
    spec.step = clampInt(o.step, 1, 1000, 1);
    spec.start = clampInt(o.start, -100_000, 100_000, 0);
    return spec;
  }
  if (kind === 'goal') {
    // ⚠️ Сначала СУДИМ, потом зажимаем. Обратный порядок был ошибкой: clampInt с полом 1
    // превращал присланный ноль в единицу, и «цель без величины» проходила проверку,
    // которая ровно для этого и написана.
    const wanted = typeof o.target === 'number' ? Math.round(o.target) : Number.NaN;
    if (!Number.isFinite(wanted) || wanted < 1) return null;
    const target = Math.min(1_000_000, wanted);
    spec.target = target;
    const unit = cleanText(o.unit, 16);
    if (unit) spec.unit = unit;
    spec.start = clampInt(o.start, 0, target, 0);
    return spec;
  }
  if (kind === 'timer') {
    spec.seconds = clampInt(o.seconds, 10, 86_400, 25 * 60);
    return spec;
  }
  if (kind === 'countdown') {
    const date = typeof o.date === 'string' ? o.date.slice(0, 10) : '';
    if (!isFutureDate(date, now)) return null; // отсчёт до прошлого не бывает
    spec.date = date;
    return spec;
  }
  // note
  const text = cleanText(o.text, GEN_TEXT_MAX);
  if (text.length < 2) return null;
  spec.text = text;
  return spec;
}

/** Знает ли ICU такой пояс. ⚠️ Проверка обязательна: неизвестный id роняет Intl исключением. */
export function isKnownTimeZone(id: string): boolean {
  if (typeof id !== 'string' || !id.includes('/')) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: id });
    return true;
  } catch {
    return false;
  }
}

/**
 * Годится ли адрес.
 *
 * ⚠️ Только https и только публичный хост. http означает открытый канал, а loopback и локальная
 * сеть — доступ к тому, что человек не публиковал: роутеру, принтеру, локальным админкам.
 * Виджет, ходящий на 192.168.1.1, — это не виджет, это сканер.
 */
export function isAllowedGenUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(String(raw ?? '').trim()); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split('.').map(Number) as [number, number];
    if (a === 127 || a === 10 || a === 0 || a === 169) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
  }
  if (host.includes(':')) return false; // голый IPv6 — тот же случай, что и приватный IPv4
  return true;
}

export function defaultTitle(kind: GenKind): string {
  switch (kind) {
    case 'list': return 'Случайное';
    case 'dice': return 'Жребий';
    case 'counter': return 'Счётчик';
    case 'checklist': return 'Список';
    case 'timer': return 'Таймер';
    case 'goal': return 'Цель';
    case 'countdown': return 'Отсчёт';
    case 'note': return 'Заметка';
    case 'feed': return 'Лента';
    case 'stat': return 'Число';
    case 'zones': return 'Пояса';
  }
}

/** Человеческое имя типа — для окна сборки. */
export function genKindLabel(kind: GenKind): string {
  switch (kind) {
    case 'list': return 'Список';
    case 'dice': return 'Жребий';
    case 'counter': return 'Счётчик';
    case 'checklist': return 'Чек-лист';
    case 'timer': return 'Таймер';
    case 'goal': return 'Цель';
    case 'countdown': return 'Отсчёт до даты';
    case 'note': return 'Заметка';
    case 'feed': return 'Лента из браузера или по вашей ссылке';
    case 'stat': return 'Число из браузера или по вашей ссылке';
    case 'zones': return 'Время в других поясах';
  }
}

/** Что этот тип делает — строкой, которую можно показать человеку. */
export function genKindHint(kind: GenKind): string {
  switch (kind) {
    case 'list': return 'Показывает один элемент, клик меняет';
    case 'dice': return 'Бросает жребий по нажатию';
    case 'counter': return 'Считает нажатиями, помнит значение';
    case 'checklist': return 'Галочки, сбрасываются вручную';
    case 'timer': return 'Обратный отсчёт со звуком';
    case 'goal': return 'Кольцо прогресса до цели';
    case 'countdown': return 'Сколько дней осталось';
    case 'note': return 'Крупный текст на виду';
    case 'feed': return 'Настоящие данные, всегда свежие';
    case 'stat': return 'Настоящее число, всегда свежее';
    case 'zones': return 'Считается на месте, без сети';
  }
}

/**
 * Размер по умолчанию под тип — в клетках стола.
 * ⚠️ Не вкусовщина: в квадрат 2×2 цитата не влезает, а счётчику широкая плитка не нужна.
 * Выбор человека всё равно сильнее (см. GenStudio).
 */
export function genKindSize(kind: GenKind): { w: number; h: number } {
  switch (kind) {
    case 'list': return { w: 4, h: 2 };
    case 'note': return { w: 4, h: 2 };
    case 'checklist': return { w: 4, h: 4 };
    case 'feed': return { w: 4, h: 4 };
    case 'zones': return { w: 4, h: 2 };
    default: return { w: 2, h: 2 };
  }
}

// ── Состояние, которое человек накликал ──────────────────────────────────────
// Хранится отдельно от спеки: пересборка виджета не обязана обнулять счётчик.

export interface GenRuntime {
  /** counter · goal */
  value?: number;
  /** checklist: индексы отмеченных */
  done?: number[];
}

export function parseGenRuntime(raw: unknown): GenRuntime {
  if (typeof raw !== 'string' || !raw) return {};
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const out: GenRuntime = {};
    if (typeof o.value === 'number' && Number.isFinite(o.value)) out.value = Math.round(o.value);
    if (Array.isArray(o.done)) {
      out.done = o.done.filter((x): x is number => typeof x === 'number' && x >= 0 && x < GEN_ITEMS_MAX);
    }
    return out;
  } catch {
    return {};
  }
}
