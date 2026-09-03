import { runTabOrganizePrompt } from './TranslationService';
import { GEN_TOKEN_VARS, GEN_MAX_CHARS, GEN_FACTS } from '../shared/genWidget';
import {
  GEN_FREE_MAX_CHARS, freeAnswerTruncated, freeStopWasLimit, freeWidgetUsable, stripCodeFence,
} from '../shared/genFree';
import { CELL_REF } from '../shared/tileBudget';

// Ярус 2 генератора: модель пишет РАЗМЕТКУ виджета.
//
// ⚠️ Разбор «почему отброшенный путь вернулся» — в шапке shared/genFree.ts. Здесь важно
// следствие: этот файл существует ОТДЕЛЬНО от GenSpecParser.ts, а не веткой внутри него. У них
// разная физика. Тот работает ПОД ГРАММАТИКОЙ и потому не знает класса задач «починить ответ»:
// невалидный JSON недостижим. Здесь ответ — свободный текст, и весь этот класс задач возвращается
// целиком: фенсы, отказы словами, обрывы по лимиту токенов. Смешав их в одном файле, мы бы
// потеряли главное свойство первого — что там чинить нечего.
//
// ⚠️ ДАННЫЕ МОДЕЛИ НЕ ДОВЕРЕНЫ. Свобода даётся на рисование; всё, что модель может узнать о
// браузере, — три счётчика из GEN_FACTS, и те приезжают от хоста в песочницу через postMessage.
// Находка 22.08 в силе: модель про браузер не знает ничего и историю посещений выдумывает.

/** Один прогон, ответ — разметка. Лимит с запасом к GEN_FREE_MAX_CHARS: токен ≈ 3–4 знака. */
const FREE_MAX_TOKENS = 3400;

/**
 * Зазор сетки стола (GRID_GAP в src/newtab/desktop.ts).
 *
 * ⚠️ Копия числа, а не импорт, и это осознанно: `src/` — renderer, main-процессу его модули
 * недоступны. Число нужно ради ОДНОЙ фразы промпта про размер плитки, и разъехавшись на пару
 * пикселей, оно не сломает ничего — в отличие от геометрии, которую держит shared/layout.ts.
 */
const GEN_GRID_GAP = 14;

export interface FreeOutcome {
  ok: boolean;
  html?: string;
  error?: string;
}

/**
 * Собрать виджет свободной разметкой.
 *
 * ⚠️ Роль передаётся `widgets`, и маршрут её уже проверен вызывающим: сюда попадают только тогда,
 * когда роль отдана облаку. Дублировать проверку здесь значило бы завести второе место, решающее
 * тот же вопрос.
 */
export async function buildFreeWidget(
  phrase: string,
  size: { w: number; h: number },
  onChars?: (n: number) => void,
): Promise<FreeOutcome> {
  let chars = 0;
  const res = await runTabOrganizePrompt(buildFreePrompt(phrase, size), {
    role: 'widgets',
    maxTokens: FREE_MAX_TOKENS,
    onChunk: (t) => { chars += t.length; onChars?.(chars); },
  });
  if (!res.ok) return { ok: false, error: res.error };

  const html = stripCodeFence(res.out).slice(0, GEN_MAX_CHARS);
  // ⚠️ Обрыв на лимите токенов — ОТДЕЛЬНЫЙ исход, и слова у него свои: человеку тут помогает
  // повтор, а не «опишите проще». Проверяется раньше годности: оборванный ответ её проходит.
  if (freeStopWasLimit(res.stopReason) || freeAnswerTruncated(html)) {
    return { ok: false, error: 'Ответ модели оборвался на середине. Попробуйте ещё раз или попросите виджет проще.' };
  }
  // ⚠️ Отказ здесь ОБЯЗАН быть словами, а не пустой плиткой на столе. Ровно этим и была
  // болезнь старого пути: сборка «удавалась», а виджет выходил пустым.
  if (!freeWidgetUsable(html)) {
    return { ok: false, error: 'Модель вернула не разметку. Попробуйте описать виджет проще.' };
  }
  return { ok: true, html };
}

/**
 * Промпт яруса 2.
 *
 * ⚠️ СТИЛЬ ЗАДАЁТСЯ ТОКЕНАМИ, а не правилами дизайн-системы в тексте. Пересказать модели цветовой
 * закон нельзя — его можно только выдать переменными: она пишет `var(--accent)`, а какой это цвет,
 * решает палитра человека, и смена темы работает сама. Это надёжнее любой инструкции.
 *
 * ⚠️ Про запреты песочницы сказано ПРЯМО, хотя их и так держит CSP. Модель, не знающая, что сети
 * нет, потратит ответ на fetch и вернёт виджет, который молча не работает: запрет сработает, а
 * человек увидит пустоту.
 *
 * ⚠️ Размер плитки — НАСТОЯЩИЙ выбор человека, а не круглое число в тексте. Виджет на 2×2 и на
 * 4×2 — это разная вёрстка, а не та же самая в другой рамке: модель, думающая про квадрат,
 * оставит половину широкой плитки пустой.
 */
function buildFreePrompt(phrase: string, size: { w: number; h: number }): string {
  const vars = GEN_TOKEN_VARS.join(', ');
  const facts = GEN_FACTS.map((f) => `  api.facts.${f.id} — ${f.label}`).join('\n');
  const px = (cells: number): number => Math.round(cells * CELL_REF + (cells - 1) * GEN_GRID_GAP);
  return (
    `Write ONE small self-contained widget for a browser home screen.\n` +
    `The user described it in Russian: "${phrase}"\n\n` +

    `OUTPUT: raw HTML only. No markdown fences, no explanations, no <html>/<head>/<body>.\n` +
    `Put CSS in a <style> tag and JS in a <script> tag, both inline. Under ${GEN_FREE_MAX_CHARS} characters.\n\n` +

    `THE TILE IS SMALL — about ${px(size.w)} by ${px(size.h)} CSS pixels`
    + `${size.w > size.h ? ', wide: lay the content out in a row, not a column' : ''}.\n` +
    `Body is already flex column with 16px padding.\n` +
    `Do not add your own outer frame, background or border: the tile draws them.\n\n` +

    `COLOURS AND TYPE: use ONLY these CSS variables, never literal colours or fonts:\n  ${vars}\n` +
    `They carry the user's palette and follow the light/dark theme automatically.\n\n` +

    `MARKUP CONVENTIONS the host styles for you:\n` +
    `  <p data-caption> — the small uppercase title of the tile\n` +
    `  <div data-display> — the one big value (number, word, time)\n` +
    `  <p data-meaning> — the quiet line under it\n\n` +

    `SANDBOX — these DO NOT WORK, do not try:\n` +
    `  no network at all (no fetch, no XHR, no external scripts, fonts or images)\n` +
    `  no <img> (hidden by the host), no localStorage, no cookies\n` +
    `  draw with CSS or inline <svg> instead\n\n` +

    `HOST BRIDGE, available as window.api:\n` +
    `  api.now — current timestamp, refreshed every 250ms\n` +
    `  window.addEventListener('oblako-tick', ...) — fires with it\n` +
    `  api.storage.get() → Promise of the saved value; api.storage.set(value) — persists across restarts\n` +
    `${facts}\n` +
    `  window.addEventListener('oblako-facts', ...) — fires when facts arrive\n\n` +

    `FACTS ARE THE ONLY THING YOU KNOW ABOUT THE BROWSER. You cannot read history, tabs or bookmarks.\n` +
    `Never invent such data: if the request needs it and it is not in the list above, build the closest\n` +
    `thing you honestly can and say so in the caption.\n\n` +

    `Write the widget now.`
  );
}
