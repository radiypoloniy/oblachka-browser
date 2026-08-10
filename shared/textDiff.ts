// Сравнение текста страницы с её же прошлым снимком (AI-IDEAS.md №7).
//
// ⚠️ Живёт ОТДЕЛЬНО и БЕЗ единого импорта — тем же приёмом, что shared/fileNameSafety.ts и
// shared/addressParts.ts. Здесь вся суть фичи: diff кодом получается всегда, но выглядит как
// «-1290 +1490» на фоне двухсот изменившихся счётчиков, дат и рекламных блоков. Ценность — в
// ОТСЕВЕ, а он весь тут, и проверять его надо прогоном, а не чтением (npm run text-diff-check).
//
// Модель в этом файле не участвует вовсе: она получает уже отфильтрованные куски и только
// называет изменение одной фразой.

/** Строки короче этого — навигация, кнопки, подписи полей: меняются от перевёрстки, а не по делу. */
const MIN_LINE_CHARS = 25;
/** Сколько кусков отдаём наружу. Это вход для короткого промпта, а не отчёт. */
const MAX_PIECES = 6;
/**
 * ⚠️ Если изменилась БОЛЬШАЯ ЧАСТЬ страницы — это не «что изменилось», а другая страница:
 * лента новостей, выдача поиска, главная. Сказать про такую «изменились заголовки» бесполезно,
 * а выглядеть будет как ложная тревога на каждом визите.
 */
const MAX_CHANGED_SHARE = 0.6;

/**
 * Строки-шум: меняются сами по себе и ничего не значат для человека.
 *
 * ⚠️ Границы русских слов — ТОЛЬКО через lookaround, никаких `\b`. В JS `\w` это [A-Za-z0-9_],
 * русская буква для регулярки «не буква», поэтому между пробелом и «ч» границы нет и `/\bчас/`
 * не совпадает НИКОГДА. Это правило уже записано в CLAUDE.md (детект полей формы, «Имя»/«край») —
 * и я наступил на него снова: без прогона фильтр «2 часа назад» молча пропускал весь шум времени.
 */
const NOISE_PATTERNS: RegExp[] = [
  // Относительное время: «2 часа назад», «минуту назад», «сегодня в 14:05».
  /(?<![а-яё])(секунд|минут|час|дн|недел|месяц|год)[а-яё]*\s+назад(?![а-яё])/i,
  /(?<![а-яё])(сегодня|вчера|только что)(?![а-яё])/i,
  /\b\d+\s*(minutes?|hours?|days?)\s+ago\b/i,
  // Счётчики: просмотры, комментарии, отзывы, лайки, «в наличии 7 шт».
  /\d[\d\s.,]*\s*(просмотр|коммент|отзыв|ответ|подписчик|участник|голос|оцен|лайк)[а-яё]*/i,
  /\b(views?|comments?|replies|followers?)\b/i,
  // Даты и время сами по себе.
  /^\W*\d{1,2}[.\-/]\d{1,2}([.\-/]\d{2,4})?\W*$/,
  /^\W*\d{1,2}:\d{2}(:\d{2})?\W*$/,
  // Технический мусор: токены, идентификаторы сессий, длинные строки без пробелов.
  /^[A-Za-z0-9_\-+/=]{24,}$/,
  // Куки-баннеры и прочая обвязка, которая то появляется, то нет.
  /\bcookie\b/i,
  /(?<![а-яё])(куки|персональных данных|пользовательское соглашение)(?![а-яё])/i,
];

function isNoise(line: string): boolean {
  return NOISE_PATTERNS.some((re) => re.test(line));
}

/** Разбивка на сравнимые куски. Абзац — единица смысла; предложения дробить не нужно. */
function toLines(text: string): string[] {
  return text
    .split(/\r?\n+/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length >= MIN_LINE_CHARS && !isNoise(l));
}

/**
 * ⚠️ Изменённую строку надо УЗНАТЬ в новой версии, а не показать как «одна исчезла, другая
 * появилась»: почти всё осмысленное на живых страницах — это правка внутри той же фразы
 * («Цена: 1290 ₽» → «Цена: 1490 ₽», «доставка завтра» → «доставка послезавтра»).
 *
 * ⚠️ Сначала так и было сделано — по строке с замаскированными цифрами, — и прогон показал, чего
 * это не ловит: в живой фразе вместе с числом меняется и слово («завтра, 14 августа» →
 * «послезавтра, 16 августа»), маска цифр там не совпадает, и пара разваливалась на две строки.
 * Поэтому близость считается по ОБЩИМ СЛОВАМ: она переживает и правку числа, и правку слова.
 */
const PAIR_SIMILARITY = 0.5;

function wordsOf(line: string): Set<string> {
  return new Set(line.toLowerCase().split(/[^а-яёa-z0-9]+/).filter(Boolean));
}

function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let common = 0;
  for (const w of a) if (b.has(w)) common++;
  return common / (a.size + b.size - common);
}

export interface PageChange {
  /** Что было. Пусто — этого куска раньше не было вовсе. */
  before: string;
  /** Что стало. Пусто — кусок исчез. */
  after: string;
}

export interface PageDiff {
  changed: boolean;
  /** Отобранные куски для показа и для промпта. */
  pieces: PageChange[];
}

/**
 * Сравнивает прошлый снимок с текущим текстом.
 *
 * `changed: false` — «ничего существенного»: и когда страница совпала, и когда изменился только
 * шум, и когда изменилось СЛИШКОМ много (см. MAX_CHANGED_SHARE). Молчание тут честнее догадки.
 */
export function diffPageText(before: string, after: string): PageDiff {
  const oldLines = toLines(before);
  const newLines = toLines(after);
  if (oldLines.length === 0 || newLines.length === 0) return { changed: false, pieces: [] };

  // Одинаковые строки гасим сразу — остаётся только то, что реально разошлось.
  const oldRest = new Map<string, string[]>();
  for (const line of oldLines) {
    const arr = oldRest.get(line) ?? [];
    arr.push(line);
    oldRest.set(line, arr);
  }
  const addedLines: string[] = [];
  for (const line of newLines) {
    const arr = oldRest.get(line);
    if (arr && arr.length > 0) { arr.pop(); continue; }
    addedLines.push(line);
  }
  const removedLines: string[] = [];
  for (const arr of oldRest.values()) removedLines.push(...arr);

  const changedShare = (addedLines.length + removedLines.length) / (oldLines.length + newLines.length);
  if (changedShare === 0) return { changed: false, pieces: [] };
  if (changedShare > MAX_CHANGED_SHARE) return { changed: false, pieces: [] };

  // Пары «та же фраза, стало иначе» — самое ценное, что тут есть, поэтому идут первыми.
  // Каждая исчезнувшая строка может стать парой только одной новой: иначе один абзац объяснял бы
  // сразу несколько изменений и в предпросмотре троился.
  const removedWords = removedLines.map((line) => ({ line, words: wordsOf(line), taken: false }));
  const pieces: PageChange[] = [];
  const plainAdded: string[] = [];
  for (const line of addedLines) {
    const words = wordsOf(line);
    let best: (typeof removedWords)[number] | null = null;
    let bestScore = PAIR_SIMILARITY;
    for (const cand of removedWords) {
      if (cand.taken) continue;
      const score = similarity(words, cand.words);
      if (score > bestScore) { bestScore = score; best = cand; }
    }
    if (best) { best.taken = true; pieces.push({ before: best.line, after: line }); }
    else plainAdded.push(line);
  }
  for (const line of plainAdded) pieces.push({ before: '', after: line });
  for (const cand of removedWords) {
    if (!cand.taken) pieces.push({ before: cand.line, after: '' });
  }

  return { changed: pieces.length > 0, pieces: pieces.slice(0, MAX_PIECES) };
}
