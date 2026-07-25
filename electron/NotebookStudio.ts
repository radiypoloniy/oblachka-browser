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
    default:
      return null; // quiz — заход 5b
  }
}

export async function generateStudio(kind: StudioKind, context: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  if (!context || !context.trim()) return { ok: false, error: 'Не выбраны источники с текстом' };
  const prompt = buildPrompt(kind, context);
  if (prompt === null) return { ok: false, error: 'Этот тип пока не поддерживается' };
  const outcome = await runChatMessage(prompt, []);
  return outcome.ok ? { ok: true, text: outcome.out } : { ok: false, error: String(outcome.error) };
}
