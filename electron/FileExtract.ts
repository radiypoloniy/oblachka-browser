import fs from 'node:fs/promises';
import path from 'node:path';

// Извлечение текста из локальных документов для узла-файла граф-воркспейса.
// Живёт в main: чтение диска и разбор форматов renderer'у не положены.

// Тот же порядок величины, что у NotebookExtract: на грунтинг всё равно режется сильнее,
// но гигантский документ не должен съедать память при чтении.
const MAX_TEXT_CHARS = 200_000;
// Отдельная страховка на размер самого файла: разбор 500-мегабайтного PDF повесит main.
const MAX_FILE_BYTES = 64 * 1024 * 1024;

export const SUPPORTED_FILE_EXTENSIONS = ['txt', 'md', 'markdown', 'csv', 'json', 'log', 'docx', 'pdf'];

export interface FileExtractResult {
  ok: boolean;
  title?: string;
  text?: string;
  error?: string;
}

// pdfjs-dist v6 поставляется ТОЛЬКО как ESM (.mjs), а electron/ компилируется в CommonJS,
// где TypeScript превращает import() в require() — тот .mjs не возьмёт. Прячем динамический
// импорт за Function, чтобы компилятор его не трогал и он дожил до рантайма настоящим import().
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const importEsm = new Function('spec', 'return import(spec)') as (spec: string) => Promise<any>;

async function extractPdf(data: Buffer): Promise<string> {
  const pdfjs = await importEsm('pdfjs-dist/legacy/build/pdf.mjs');
  // Путь к штатным шрифтам pdfjs. Без него разбор ругается и на части документов теряет
  // текст: метрики стандартных шрифтов нужны, даже когда мы ничего не рисуем. Резолвим
  // от package.json — сам пакет ESM-only, и require.resolve на его точку входа не сработал бы.
  const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
  // Путь именно с ПРЯМЫМИ слешами и слешем на конце: pdfjs склеивает его с именем шрифта,
  // на обратные слеши Windows ругается «Invalid factory url», а file://-URL в Node читать
  // не умеет (его фабрика шрифтов ходит на диск обычным fs).
  const fontsUrl = `${path.join(pdfjsRoot, 'standard_fonts').replace(/\\/g, '/')}/`;

  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    standardFontDataUrl: fontsUrl,
    // Рисовать ничего не собираемся — только читать текст.
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: false,
  });

  const parts: string[] = [];
  try {
    const doc = await task.promise;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      // items несут позиции; для подачи в модель достаточно склеить строки по порядку.
      const line = content.items
        .map((it: { str?: string }) => (typeof it.str === 'string' ? it.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (line) parts.push(line);
      if (parts.join('\n\n').length > MAX_TEXT_CHARS) break;
    }
  } finally {
    // ⚠️ destroy() висит на ЗАДАЧЕ загрузки, а не на документе (pdfjs v6). Без неё в main
    // остаются жить внутренние воркеры разбора.
    await task.destroy();
  }
  return parts.join('\n\n');
}

async function extractDocx(filePath: string): Promise<string> {
  // mammoth — CommonJS, грузится обычным require. Даём именно raw-текст: разметка Word
  // (стили, таблицы) для подачи в модель только шум.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mammoth = require('mammoth') as typeof import('mammoth');
  const res = await mammoth.extractRawText({ path: filePath });
  return res.value;
}

export async function extractFileText(filePath: string): Promise<FileExtractResult> {
  if (!filePath) return { ok: false, error: 'Файл не выбран' };
  const title = path.basename(filePath);
  const ext = path.extname(filePath).replace('.', '').toLowerCase();

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return { ok: false, error: 'Это не файл' };
    if (stat.size > MAX_FILE_BYTES) return { ok: false, error: 'Файл слишком большой' };

    let text: string;
    if (ext === 'pdf') {
      text = await extractPdf(await fs.readFile(filePath));
    } else if (ext === 'docx') {
      text = await extractDocx(filePath);
    } else if (SUPPORTED_FILE_EXTENSIONS.includes(ext)) {
      text = await fs.readFile(filePath, 'utf8');
    } else {
      // Читаем как текст и проверяем на бинарь: расширений на свете больше, чем в списке,
      // и .yml/.ts/.srt тоже осмысленно затащить в граф.
      const raw = await fs.readFile(filePath, 'utf8');
      // Нулевой байт — надёжный признак бинарника: в тексте его не бывает.
      if (raw.includes('\u0000')) return { ok: false, error: `Формат .${ext} не поддерживается` };
      text = raw;
    }

    const trimmed = text.trim();
    if (!trimmed) return { ok: false, error: 'В файле не нашлось текста (возможно, это скан)' };
    return { ok: true, title, text: trimmed.slice(0, MAX_TEXT_CHARS) };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { ok: false, error: 'Файл не найден — возможно, его переместили' };
    return { ok: false, error: `Не удалось прочитать: ${(e as Error).message}` };
  }
}
