// Папка для только что сохранённой закладки (AI-IDEAS.md №2) — модель ВЫБИРАЕТ одну из уже
// существующих папок, а не придумывает новую.
//
// Зачем вообще: разбирать закладки по папкам «потом» означает никогда, и в корне копится куча.
// Раскладку этой кучи задним числом делает BookmarkOrganizer.ts; здесь другой момент — папка
// предлагается сразу, пока человек ещё смотрит на меню закладки.
//
// ⚠️ Модель не пишет текст, а называет НОМЕР из списка, который собрали мы, — тот же приём, что
// в TabSearch.ts и SmartFind.ts. Придуманное название означало бы новую папку, то есть действие
// в чужой раскладке; выбор из готового такого исхода не имеет в принципе.
//
// ⚠️ Гейт isModelWarm() обязателен: холодная 9B — это ~30 с (замерено), а человек нажал звезду и
// ждёт меню. На холодной модели меню ведёт себя ровно как раньше, без единой задержки.
import { runTabOrganizePrompt, isModelWarm } from './TranslationService';

// Выше этого числа промпт перестаёт быть коротким. У кого папок больше — тот уже разложил
// закладки и в подсказке не нуждается.
const MAX_FOLDERS = 40;
// ⚠️ Меньше двух папок не спрашиваем, и это не экономия. При одной папке вопрос вырождается в
// «подходит ли сюда?» — то самое короткое «да/нет», на котором эта модель осторожничает и почти
// всегда отвечает «нет» (замер в TabOrganizer.ts, цикл по темам). Пользы ноль, задержка есть.
const MIN_FOLDERS = 2;

const ANSWER_CUE = 'ANSWER:';

export interface FolderChoice {
  id: number;
  /** Путь от корня («Работа / Налоги») — двух папок «Разное» в разных родителях иначе не различить. */
  path: string;
}

// ⚠️ Инструкция ПО-АНГЛИЙСКИ при русском содержимом — правило проекта, выведенное замерами
// (см. TabSearch.ts): русские формулировки заставляют модель переписывать список вместо ответа.
function buildPrompt(title: string, host: string, folders: FolderChoice[]): string {
  const lines = folders.map((f, i) => `${i + 1}. ${f.path}`);
  return (
    `Existing bookmark folders:\n${lines.join('\n')}\n\n` +
    `The user just bookmarked this page:\n${title} — ${host}\n\n` +
    `Which folder does this page belong to? Decide by MEANING, not by matching words: ` +
    `an article about penalties belongs to a work folder even if neither word appears in its name.\n` +
    `Reply with a single line: "${ANSWER_CUE} <number>". ` +
    `If no folder fits, reply "${ANSWER_CUE} none". Nothing else.`
  );
}

/**
 * Разбор ответа. Отдельной функцией, потому что вся хрупкость тут: маленькая модель охотно
 * переписывает список папок обратно, и «любые числа в ответе» вытащили бы номер из её же эха.
 * Берём только строку после метки — как в TabSearch.parseAnswer.
 */
function parseAnswer(out: string, count: number): number | null {
  const line = new RegExp(`${ANSWER_CUE}\\s*([^\\n]*)`, 'i').exec(out)?.[1]?.trim();
  if (!line || /^(нет|none|no)\b/i.test(line)) return null;
  // Метка есть, но после неё не номер (пересказ, название папки словами) — считаем, что ответа нет.
  const m = /^(\d+)\b/.exec(line);
  if (!m || line.length > 16) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 1 && n <= count ? n : null;
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/**
 * Предлагает папку для закладки. Возвращает id папки либо null — «не знаю», «модель холодная» и
 * «папок мало» здесь один и тот же исход: меню просто открывается без пункта-подсказки.
 *
 * Ничего не перекладывает: перенос делает человек нажатием на предложенный пункт.
 */
export async function suggestFolderForBookmark(
  title: string,
  url: string,
  folders: FolderChoice[],
): Promise<number | null> {
  if (!isModelWarm()) return null;
  const list = folders.slice(0, MAX_FOLDERS);
  if (list.length < MIN_FOLDERS) return null;
  const name = title.trim() || url;
  if (!name) return null;

  const started = Date.now();
  // Полоса ПОЛЬЗОВАТЕЛЬСКАЯ, а не фоновая: человек нажал звезду и ждёт меню прямо сейчас
  // (в отличие от подсказок при наборе, которых он не заказывал).
  const res = await runTabOrganizePrompt(buildPrompt(name, hostOf(url), list), { role: 'organize' });
  if (!res.ok) {
    console.warn('[bookmark-folder] модель не ответила:', res.error);
    return null;
  }
  const n = parseAnswer(res.out.trim(), list.length);
  const picked = n ? list[n - 1]! : null;
  // Сырой ответ и время — в лог. Время здесь не любопытство: этой паузой оплачивается задержка
  // открытия меню, и без неё нельзя судить, терпима ли она.
  console.log(
    `[bookmark-folder] ${list.length} папок → ${JSON.stringify(picked?.path ?? null)}, ` +
    `${Date.now() - started} мс, ответ модели: ${JSON.stringify(res.out.trim().slice(0, 120))}`,
  );
  return picked?.id ?? null;
}
