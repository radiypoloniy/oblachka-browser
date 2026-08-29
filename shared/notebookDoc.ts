// Документ «Студии» блокнота: закрытый каталог блоков, схема под грамматику и проверка ответа.
//
// ⚠️ МОДЕЛЬ НЕ ПИШЕТ HTML, и заводить такой путь нельзя. В проекте это пробовали дважды и оба
// раза выбросили: генерация виджетов (4B выдавала на «змейку» 250 пустых <div> без единого
// скрипта — разбор в shared/genSpec.ts) и @antv/infographic в этой же Студии («промптом это не
// лечилось»). Правило с тех пор одно: модель отдаёт СТРУКТУРУ И ТЕКСТ, рисует детерминированный
// код в renderer. «Красиво» здесь берётся не из того, что модель хорошо сверстала, а из того,
// что верстали мы.
//
// ⚠️ Каталог ЗАКРЫТ и мал намеренно. Просить модель «придумать блок» — это снова просить её
// изобретать интерфейс, то есть самое трудное, что ей можно поручить, и ровно то, чего человек
// не просил: ему нужен документ, а не вёрстка.

/** Типы блоков. Порядок — предлагаемый порядок в документе, но модель вправе его менять. */
export const DOC_BLOCKS = [
  'cover',      // обложка: заголовок документа и подпись
  'heading',    // подзаголовок раздела
  'text',       // абзац
  'quote',      // врезка — одна мысль, которую стоит запомнить
  'list',       // маркированный список
  'metrics',    // 2–4 числа с подписями
  'table',      // таблица «параметр → значение»
  'compare',    // две колонки: чем одно отличается от другого
  'sources',    // перечень источников, на которых стоит документ
] as const;

export type DocBlockKind = typeof DOC_BLOCKS[number];

/**
 * Потолок числа блоков в документе.
 *
 * ⚠️ Было 12 — и это молча ограничивало Студию заметкой на страницу. Настоящее
 * исследование по нескольким источникам — это 6 разделов, таблица, числа, врезки и выводы,
 * то есть 18–24 блока; на потолке в 12 модель обрывала документ ровно там, где начиналось
 * самое ценное. Замер на макете: док на 5 400 знаков занял 19 блоков.
 *
 * ⚠️ Потолок нужен всё равно: без него модель уходит в перечисление, а грамматика её
 * не остановит — она следит за формой, а не за длиной.
 */
export const DOC_MAX_BLOCKS = 24;

/** Длиннее этого «заголовок» — на самом деле абзац (см. normalizeDoc). */
export const HEADING_MAX_CHARS = 120;

export interface DocBlock {
  kind: DocBlockKind;
  /** Заголовок блока: название документа у cover, заголовок раздела у heading, подпись у прочих. */
  title?: string;
  /** Основной текст: абзац, цитата, подпись обложки. */
  text?: string;
  /** Пункты списка. */
  items?: string[];
  /** Пары «подпись → значение»: metrics, table, sources (подпись — название, значение — адрес). */
  pairs?: { label: string; value: string }[];
  /** Две колонки сравнения: имена сторон. */
  sides?: [string, string];
}

export interface DocSpec {
  title: string;
  blocks: DocBlock[];
}

/**
 * Схема под грамматику node-llama-cpp (createGrammarForJsonSchema).
 *
 * ⚠️ Ограничение действует на КАЖДОМ токене, поэтому невалидный документ не «редкий», а
 * недостижимый: разбирать текст, чинить забор из ``` и угадывать намерение здесь не нужно.
 * Ровно это и оказалось решающим в виджетах: модели 3–4B плывут в структуре, а не в понимании.
 */
export const DOC_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    blocks: {
      type: 'array',
      minItems: 4,
      maxItems: DOC_MAX_BLOCKS,
      items: {
        type: 'object',
        properties: {
          kind: { enum: [...DOC_BLOCKS] },
          title: { type: 'string' },
          text: { type: 'string' },
          items: { type: 'array', items: { type: 'string' }, maxItems: 8 },
          pairs: {
            type: 'array',
            maxItems: 6,
            items: {
              type: 'object',
              properties: { label: { type: 'string' }, value: { type: 'string' } },
            },
          },
        },
      },
    },
  },
} as const;

const isKind = (v: unknown): v is DocBlockKind =>
  typeof v === 'string' && (DOC_BLOCKS as readonly string[]).includes(v);

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function strList(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(str).filter((x) => x.length > 0).slice(0, max);
}

function pairList(v: unknown, max: number): { label: string; value: string }[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((p) => ({ label: str((p as { label?: unknown })?.label), value: str((p as { value?: unknown })?.value) }))
    .filter((p) => p.label.length > 0 || p.value.length > 0)
    .slice(0, max);
}

/**
 * Приводит ответ модели к тому, что можно нарисовать. null — рисовать нечего.
 *
 * ⚠️ Блок, у которого нет СОБСТВЕННОГО содержимого, выбрасывается, а не рисуется пустым.
 * Грамматика гарантирует форму, но не наполнение: модель вправе прислать `{"kind":"list"}` без
 * единого пункта, и пустая рамка в документе выглядит поломкой, а не задумкой.
 */
export function normalizeDoc(raw: unknown): DocSpec | null {
  const obj = raw as { title?: unknown; blocks?: unknown } | null;
  if (!obj || typeof obj !== 'object') return null;

  const blocksRaw = Array.isArray(obj.blocks) ? obj.blocks : [];
  const blocks: DocBlock[] = [];

  for (const b of blocksRaw.slice(0, DOC_MAX_BLOCKS)) {
    const src = b as Record<string, unknown>;
    if (!isKind(src.kind)) continue;
    const block: DocBlock = { kind: src.kind };
    const title = str(src.title);
    const text = str(src.text);
    const items = strList(src.items, 8);
    const pairs = pairList(src.pairs, 6);
    if (title) block.title = title;
    if (text) block.text = text;
    if (items.length) block.items = items;
    if (pairs.length) block.pairs = pairs;

    // ⚠️ СНАЧАЛА ПОДБИРАЕМ СОДЕРЖИМОЕ ИЗ СОСЕДНЕГО ПОЛЯ, и только потом решаем, пусто ли.
    //
    // Живой случай (29.08.2026): модель выдала 6 000 знаков, а в документе оказались одни
    // заголовки — семь подряд, между ними пустота. Причина не в модели: в схеме и title, и
    // text необязательны у ЛЮБОГО блока, грамматика различить их не может, и модель, только
    // что написав "title" у heading, продолжала класть в "title" и абзацы. Всё это молча
    // выбрасывалось как «пустой блок».
    //
    // Вывод сильнее случая: раз грамматика не различает поля, различать обязаны мы — и
    // ошибаться в сторону СОХРАНЕНИЯ текста. Блок, у которого есть хоть что-то, рисуется;
    // выбрасываем только по-настоящему пустой. Потерять абзац хуже, чем нарисовать его
    // абзацем там, где модель считала его заголовком.
    if (block.kind === 'text' || block.kind === 'quote') {
      if (!block.text && block.title) { block.text = block.title; delete block.title; }
    } else if (block.kind === 'cover' || block.kind === 'heading') {
      if (!block.title && block.text) { block.title = block.text; delete block.text; }
    }

    // Чем блок наполнен — зависит от типа. Пустой по своему типу блок не рисуем.
    const filled =
      block.kind === 'cover'    ? !!block.title
      : block.kind === 'heading' ? !!block.title
      : block.kind === 'text'    ? !!block.text
      : block.kind === 'quote'   ? !!block.text
      : block.kind === 'list'    ? !!block.items
      : !!block.pairs;
    if (filled) blocks.push(block);
  }

  if (blocks.length === 0) return null;

  // ⚠️ Обратный перекос того же случая: модель кладёт в heading целый абзац. Заголовок в
  // 300 знаков ломает вёрстку любого шаблона и оглавление заодно, поэтому длинный heading
  // считаем абзацем. Порог грубый намеренно — настоящий заголовок раздела в него не упирается.
  for (const b of blocks) {
    if (b.kind === 'heading' && b.title && b.title.length > HEADING_MAX_CHARS) {
      b.text = b.title;
      delete b.title;
      (b as { kind: DocBlockKind }).kind = 'text';
    }
  }

  // Заголовок документа: своё поле, иначе — заголовок обложки. Без него документ безымянный,
  // а его ещё выгружать файлом.
  const cover = blocks.find((b) => b.kind === 'cover');
  const title = str(obj.title) || cover?.title || 'Документ';
  return { title, blocks };
}
