// Вложения в ответе модели: что приехало картинкой и что из текста ответа стоит предложить файлом.
//
// ⚠️ ЧЕСТНАЯ ГРАНИЦА ВОЗМОЖНОГО, и она уже; чем кажется. Чат-API не отдаёт ни .docx, ни .pdf, ни
// .xlsx — их не умеет ни один из четырёх наших видов подключения. Наружу от модели приходит ровно
// две вещи: КАРТИНКА байтами (Gemini кладёт её в inlineData, OpenAI-совместимые шлюзы — в
// message.images) и ТЕКСТ. Поэтому «документ, сгенерированный моделью» — это всегда текстовый
// фрагмент в ответе: таблица csv, json, разметка, svg, код. Единственное, чего ему не хватает,
// чтобы стать файлом, — имени и расширения; их и выдаёт этот модуль.
//
// ⚠️ Модуль под проверкой (scripts/ai-attachments-check.mjs) и потому БЕЗ значимых импортов:
// проверка гоняется голым node, а он требует расширения в пути, которого tsc с эмитом не примет.

/** Описание файла для интерфейса. Байтов здесь нет — они лежат на диске у main. */
export interface AiFileMeta {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: 'image' | 'file';
}

/**
 * Разбор data-URL.
 *
 * ⚠️ Строгий разбор, а не «отрезать до запятой». Сюда приезжает строка от чужого шлюза, и в ней
 * встречается и `;charset`, и обычный (не base64) URL-кодированный текст. Второе мы не берём
 * вовсе: картинка приходит base64 у всех, а гадать по проценту-кодированию — способ записать на
 * диск мусор под видом png.
 */
export function parseDataUrl(url: string): { mime: string; base64: string } | null {
  const m = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+)((?:;[a-z0-9.+=-]+)*);base64,([\s\S]*)$/i.exec(url.trim());
  if (!m) return null;
  const base64 = m[3].replace(/\s+/g, '');
  if (base64 === '') return null;
  return { mime: m[1].toLowerCase(), base64 };
}

/** Сколько байт стоит за base64 — без раскодирования: длина минус хвостовые «=». */
export function base64Size(base64: string): number {
  const clean = base64.replace(/\s+/g, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

// ⚠️ Таблица закрытая и намеренно короткая: сюда попадает то, что модели реально отдают. Открытый
// разбор «mime → расширение по последнему сегменту» дал бы файлы вроде «ответ.svg+xml».
const MIME_EXT: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
  'application/json': 'json',
  'text/csv': 'csv',
  'text/markdown': 'md',
  'text/html': 'html',
  'text/plain': 'txt',
};

export function extForMime(mime: string): string {
  return MIME_EXT[mime.toLowerCase().split(';')[0].trim()] ?? 'bin';
}

export function isImageMime(mime: string): boolean {
  return mime.toLowerCase().startsWith('image/');
}

/**
 * Имя картинки из ответа.
 *
 * ⚠️ Порядковый номер, а не время и не хэш. Человек видит имя в диалоге сохранения и выбирает по
 * нему; «Изображение 2.png» он соотнесёт с картинкой на экране, «img_1756903221.png» — нет.
 */
export function attachmentName(mime: string, index: number): string {
  const ext = extForMime(mime);
  return isImageMime(mime) ? `Изображение ${index + 1}.${ext}` : `Файл ${index + 1}.${ext}`;
}

// ── Текстовые фрагменты, которые стоит предложить файлом ──────────────────────

/** Язык фенса → как назвать и с каким расширением сохранить. */
const LANG: Readonly<Record<string, { ext: string; label: string }>> = {
  csv: { ext: 'csv', label: 'Таблица' },
  tsv: { ext: 'tsv', label: 'Таблица' },
  json: { ext: 'json', label: 'JSON' },
  yaml: { ext: 'yaml', label: 'YAML' },
  yml: { ext: 'yaml', label: 'YAML' },
  xml: { ext: 'xml', label: 'XML' },
  svg: { ext: 'svg', label: 'Рисунок' },
  html: { ext: 'html', label: 'Страница' },
  markdown: { ext: 'md', label: 'Документ' },
  md: { ext: 'md', label: 'Документ' },
  sql: { ext: 'sql', label: 'Запрос' },
  python: { ext: 'py', label: 'Код' },
  py: { ext: 'py', label: 'Код' },
  javascript: { ext: 'js', label: 'Код' },
  js: { ext: 'js', label: 'Код' },
  typescript: { ext: 'ts', label: 'Код' },
  ts: { ext: 'ts', label: 'Код' },
  bash: { ext: 'sh', label: 'Скрипт' },
  sh: { ext: 'sh', label: 'Скрипт' },
  css: { ext: 'css', label: 'Стили' },
  text: { ext: 'txt', label: 'Текст' },
  txt: { ext: 'txt', label: 'Текст' },
};

/**
 * Стоит ли предлагать сохранение этого фрагмента файлом.
 *
 * ⚠️ ПОРОГ ОБЯЗАТЕЛЕН. Модель постоянно берёт в фенс одну строку — имя команды, значение поля,
 * идентификатор. Кнопка «сохранить» у такого фрагмента — шум: сохранять там нечего, а нажать по
 * ошибке легко. Порог по СТРОКАМ и по длине сразу: однострочный csv на четыреста символов — это
 * данные, а восемь строк по слову — уже документ.
 */
export function savable(lang: string | null, text: string): boolean {
  if (lang !== null && LANG[lang.toLowerCase()] === undefined) return false;
  const body = text.trim();
  if (body === '') return false;
  return body.length >= 200 || body.split('\n').length >= 5;
}

/** Как назвать сохраняемый фрагмент. Индекс — порядковый номер фенса в ответе. */
export function blockFileName(lang: string | null, index: number): string {
  const known = lang === null ? undefined : LANG[lang.toLowerCase()];
  const ext = known?.ext ?? 'txt';
  const label = known?.label ?? 'Фрагмент';
  return `${label} ${index + 1}.${ext}`;
}
