import { runChatMessage } from './TranslationService';

// Генерация материалов «Студии» блокнота по тексту выбранных источников. Модель локальная —
// её задача выдать СТРУКТУРУ/ТЕКСТ (саммари в Markdown; далее — markdown-аутлайн для майндкарты,
// спек для инфографики, JSON для теста), «красоту» рисуют детерминированные либы в renderer.
// Одноразовый прогон (без истории чата): runChatMessage(prompt, []).

export type StudioKind = 'summary' | 'mindmap' | 'infographic' | 'quiz';

// Промпт на тип. null — тип ещё не реализован (появится своим заходом).
function buildPrompt(kind: StudioKind, context: string): string | null {
  switch (kind) {
    case 'summary':
      return 'По приведённым ниже источникам сделай краткое структурированное саммари на русском в '
        + 'формате Markdown: короткий заголовок (##), затем 5–8 ключевых пунктов маркированным списком, '
        + 'при необходимости — короткий вывод. Опирайся ТОЛЬКО на источники, ничего не выдумывай.\n\n'
        + context;
    case 'mindmap':
      // Модель выдаёт markdown-аутлайн (заголовки + вложенные списки), майндкарту из него
      // рисует markmap в renderer. Просим строго иерархию без прозы, чтобы дерево было чистым.
      return 'По приведённым ниже источникам построй иерархический план для майндкарты в формате '
        + 'Markdown. Ровно один заголовок первого уровня «# …» — это корень (тема). Ниже — ветви '
        + 'заголовками «## …», подветви — «### …» и/или вложенными маркированными списками. Пиши '
        + 'коротко (2–5 слов на узел), без абзацев и пояснений. Опирайся ТОЛЬКО на источники.\n\n'
        + context;
    case 'infographic':
      // Модель выдаёт декларативный синтаксис AntV Infographic (title + items), рендерит его
      // движок @antv/infographic в renderer. Шаблон фиксируем (list-column) и даём точный скелет —
      // синтаксис отказоустойчив, но так модель почти не отклоняется.
      return 'По приведённым ниже источникам построй инфографику в синтаксисе AntV Infographic. '
        + 'Выведи РОВНО такой текст, без пояснений и без ограждений ```:\n\n'
        + 'infographic list-column\n'
        + 'data\n'
        + '  title Короткий заголовок\n'
        + '  items\n'
        + '    - label Пункт (2–4 слова)\n'
        + '      desc Пояснение (до 12 слов)\n'
        + '    - label Второй пункт\n'
        + '      desc Пояснение\n\n'
        + 'Сделай 4–6 пунктов. Пиши по-русски. Опирайся ТОЛЬКО на источники, ничего не выдумывай.\n\n'
        + context;
    case 'quiz':
      // Модель выдаёт СТРОГО JSON, интерактивный тест из него рисует renderer. JSON парсим и
      // валидируем на нашей стороне (normalizeQuiz) — в renderer уходит только чистая структура.
      return 'По приведённым ниже источникам составь тест из 4–5 вопросов с вариантами ответа. '
        + 'Ответь СТРОГО валидным JSON без пояснений и без ограждений ```. Формат:\n'
        + '{"questions":[{"q":"текст вопроса","options":["вариант A","вариант B","вариант C","вариант D"],"answer":0}]}\n'
        + 'Поле answer — индекс правильного варианта (0-based, от 0 до 3). По каждому вопросу ровно '
        + '4 варианта. Пиши по-русски. Опирайся ТОЛЬКО на источники, ничего не выдумывай.\n\n'
        + context;
    default:
      return null;
  }
}

// Достаёт и валидирует JSON теста из ответа модели. Возвращает нормализованную структуру строкой
// (renderer её парсит), либо null — тогда генерацию считаем неудачной и предлагаем повтор.
function normalizeQuiz(raw: string): string | null {
  const s = raw.replace(/```[a-z]*\n?/gi, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(s.slice(a, b + 1)); } catch { return null; }
  const qs = (parsed as { questions?: unknown }).questions;
  if (!Array.isArray(qs)) return null;
  const questions = qs
    .map((q) => {
      const o = q as { q?: unknown; options?: unknown; answer?: unknown };
      const text = typeof o.q === 'string' ? o.q.trim() : '';
      const options = Array.isArray(o.options) ? o.options.filter((x): x is string => typeof x === 'string').map((x) => x.trim()) : [];
      let answer = typeof o.answer === 'number' ? Math.floor(o.answer) : 0;
      if (answer < 0 || answer >= options.length) answer = 0; // страхуемся от битого индекса
      return { q: text, options, answer };
    })
    .filter((q) => q.q && q.options.length >= 2);
  return questions.length ? JSON.stringify({ questions }) : null;
}

export async function generateStudio(kind: StudioKind, context: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  if (!context || !context.trim()) return { ok: false, error: 'Не выбраны источники с текстом' };
  const prompt = buildPrompt(kind, context);
  if (prompt === null) return { ok: false, error: 'Этот тип пока не поддерживается' };
  const outcome = await runChatMessage(prompt, []);
  if (!outcome.ok) return { ok: false, error: String(outcome.error) };
  if (kind === 'quiz') {
    const json = normalizeQuiz(outcome.out);
    return json ? { ok: true, text: json } : { ok: false, error: 'Не удалось разобрать тест — попробуйте ещё раз' };
  }
  return { ok: true, text: outcome.out };
}
