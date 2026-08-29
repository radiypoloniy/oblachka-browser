import { runChatMessage, runTabOrganizePrompt } from './TranslationService';
import { DOC_SCHEMA, normalizeDoc } from '../shared/notebookDoc';

// Генерация материалов «Студии» блокнота по тексту выбранных источников. Модель локальная —
// её задача выдать СТРУКТУРУ/ТЕКСТ (саммари в Markdown; далее — markdown-аутлайн для майндкарты,
// JSON для инфографики и теста), «красоту» детерминированно рисует renderer.
// Одноразовый прогон (без истории чата): runChatMessage(prompt, []).

export type StudioKind = 'summary' | 'mindmap' | 'infographic' | 'quiz' | 'document';

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
      // Модель отдаёт СТРОГО JSON, картинку рисует наш собственный компонент в renderer.
      //
      // Раньше здесь просился декларативный синтаксис AntV Infographic, и вёрстка ломалась
      // об него постоянно: шаблон с фиксированной шириной карточки резал длинные значения,
      // а промптом это не лечится — можно было лишь ужимать value до четырёх символов.
      // Свой рендер снимает проблему целиком: раскладка потоковая, налезать нечему.
      return 'По приведённым ниже источникам построй инфографику — 4–6 карточек с фактами. '
        + 'Ответь СТРОГО валидным JSON без пояснений и без ограждений ```. Формат:\n'
        + '{"title":"Заголовок всей инфографики","items":[{"label":"Суть пункта",'
        + '"value":"34%","desc":"Факт одним предложением"}]}\n'
        + 'label — 2–4 слова. value — главное число пункта с единицей («34%», «10 700 шт», '
        + '«4,6 млн ₽»); если числа у пункта нет, поле value пропусти. desc — одно '
        + 'предложение до 14 слов, заполняй всегда. Пиши по-русски. Опирайся ТОЛЬКО на '
        + 'источники, ничего не выдумывай.\n\n'
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

// Сравнение нескольких источников. Модель делает ровно одну вещь, которая ей даётся, —
// ВЫПИСЫВАЕТ значения из текста по каждому товару отдельно. Ранжировать, считать максимумы
// и решать, кто лидер, её не просим: это арифметика, и на ней маленькая локальная модель
// путается (живой случай: «лидер по ёмкости» назначен дважды разным моделям). Сравнение
// делает таблица в renderer, где значения просто стоят рядом.
function buildComparisonPrompt(items: string[]): string {
  const blocks = items
    .map((t, i) => `### Источник ${i + 1}\n${t.trim().slice(0, 6000)}`)
    .join('\n\n');
  return 'Ниже описания нескольких товаров, каждый под своим заголовком. Составь таблицу '
    + 'сравнения. Ответь СТРОГО валидным JSON без пояснений и без ограждений ```. Формат:\n'
    + '{"title":"Заголовок сравнения","items":[{"name":"Краткое имя товара",'
    + '"specs":{"Параметр":"значение","Параметр 2":"значение"}}]}\n'
    + 'Один элемент items — ОДИН источник, в том же порядке. Имя товара делай коротким '
    + '(2–4 слова), без слов «купить», «доставка» и артикулов. Параметры выбери 5–8 штук и '
    + 'назови их ОДИНАКОВО у всех товаров, иначе таблица не сойдётся: например «Экран», '
    + '«Процессор», «Память», «Батарея», «Цена». Значения переписывай из источника как есть, '
    + 'с единицами измерения. Если параметра у товара нет — поставь пустую строку. Ничего не '
    + 'выдумывай и НЕ делай выводов о том, что лучше.\n\n'
    + blocks;
}

// Валидация сравнения: в renderer уезжает только чистая структура.
function normalizeComparison(raw: string): string | null {
  const s = raw.replace(/```[a-z]*\n?/gi, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(s.slice(a, b + 1)); } catch { return null; }
  const src = parsed as { title?: unknown; items?: unknown };
  if (!Array.isArray(src.items)) return null;
  const items = src.items
    .map((raw2) => {
      const o = raw2 as { name?: unknown; specs?: unknown };
      const specs: Record<string, string> = {};
      if (o.specs && typeof o.specs === 'object') {
        for (const [k, v] of Object.entries(o.specs as Record<string, unknown>)) {
          const key = String(k).trim();
          const val = v == null ? '' : String(v).trim();
          if (key) specs[key] = val;
        }
      }
      return { name: typeof o.name === 'string' ? o.name.trim() : '', specs };
    })
    .filter((i) => i.name && Object.keys(i.specs).length);
  // Сравнивать нечего, если товар остался один — пусть узел скажет об этом честно.
  return items.length >= 2
    ? JSON.stringify({ title: typeof src.title === 'string' ? src.title.trim() : '', items })
    : null;
}

// Достаёт и валидирует JSON инфографики. Тот же приём, что normalizeQuiz: в renderer
// уезжает только чистая структура, а не сырой ответ модели.
function normalizeInfographic(raw: string): string | null {
  const s = raw.replace(/```[a-z]*\n?/gi, '')
  const a = s.indexOf('{'), b = s.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  let parsed: unknown
  try { parsed = JSON.parse(s.slice(a, b + 1)) } catch { return null }
  const src = parsed as { title?: unknown; items?: unknown }
  const title = typeof src.title === 'string' ? src.title.trim() : ''
  if (!Array.isArray(src.items)) return null
  const items = src.items
    .map((raw) => {
      const o = raw as { label?: unknown; value?: unknown; desc?: unknown }
      return {
        label: typeof o.label === 'string' ? o.label.trim() : '',
        // value может прийти числом — приводим к строке, рисовать её всё равно как текст.
        value: typeof o.value === 'string' ? o.value.trim()
          : typeof o.value === 'number' ? String(o.value) : '',
        desc: typeof o.desc === 'string' ? o.desc.trim() : '',
      }
    })
    .filter((i) => i.label || i.desc)
  return items.length ? JSON.stringify({ title, items }) : null
}

// items — тексты источников ПООТДЕЛЬНОСТИ. Нужны инфографике: когда источников несколько,
// человек ждёт сравнение, а не сводку по одному из них наугад (живой случай: пять карточек
// смартфонов на входе — и инфографика про батарею одного из них).
// Документ собирается ОТДЕЛЬНЫМ путём — под грамматикой, а не свободным ответом. Ровно поэтому
// он и возможен: модель выбирает последовательность блоков из закрытого каталога и наполняет их
// текстом, а вёрстку делает renderer нашими компонентами (разбор — в shared/notebookDoc.ts).
//
// ⚠️ Бюджет считан, а не подобран на глаз: русский текст у Qwen — примерно 2,5–3 знака на токен,
// плюс четверть сверху на обвязку JSON (ключи, кавычки, экранирование). 1400 токенов, стоявшие
// здесь раньше, означали потолок примерно в 3 000 знаков — то есть заметку, а не исследование;
// документ обрывался на середине, и выглядело это как сбой генерации. 3 000 токенов дают
// 5–6 тысяч знаков, что и есть настоящий разбор по нескольким источникам.
//
// ⚠️ Плата за это — ВРЕМЯ: столько токенов под грамматикой на 4B идут минуты, а не секунды.
// Поэтому у документа есть onProgress (см. ниже): без счётчика долгий прогон неотличим от
// зависшего, и человек закрывает окно раньше, чем модель закончит.
const DOC_MAX_TOKENS = 3000;

function buildDocPrompt(context: string): string {
  const rules = [
    'По приведённым ниже источникам собери подробный документ-исследование. Ты НЕ пишешь',
    'вёрстку — ты выбираешь последовательность блоков и наполняешь их текстом.',
    '',
    '⚠️ ГЛАВНОЕ ПРАВИЛО ПОЛЕЙ: заголовок раздела кладётся в "title", а СВЯЗНЫЙ ТЕКСТ — всегда',
    'в "text". Абзац в поле "title" не будет показан. Пример двух блоков подряд:',
    '{"kind":"heading","title":"Как выглядит атака"},',
    '{"kind":"text","text":"Сценарий не требует уязвимости в коде. Достаточно страницы, которую',
    'агент прочитает по дороге к цели. В её тексте лежит фраза, обращённая не к человеку."}',
    '',
    'Начни с блока cover (title — название документа, text — одна строка подписи). Дальше',
    '4–6 разделов, и КАЖДЫЙ раздел — это heading, а сразу за ним один-два text с абзацами.',
    'Заголовок без абзаца после него — ошибка: пустой раздел никому не нужен.',
    'heading — заголовок раздела, 2–6 слов в "title"; text — абзац 3–5 предложений в "text",',
    'полными фразами, а не перечислением; quote — одна мысль в "text"; list — 3–6 коротких',
    'пунктов в "items"; metrics — 2–4 числа в "pairs" (label — что это, value — само число с',
    'единицей); table и compare — пары «параметр → значение» в "pairs"; sources — перечень',
    'источников в "pairs" (label — название, value — адрес).',
    'Заканчивай разделом с выводом (heading + text), после него — sources.',
    'Пиши по-русски, развёрнуто: это разбор темы, а не краткая заметка. Опирайся ТОЛЬКО на',
    'источники, ничего не выдумывай.',
  ].join(' ');
  return `${rules}

${context}`;
}

export async function generateStudio(
  kind: StudioKind,
  context: string,
  items?: string[],
  // Ход генерации документа: сколько знаков модель уже выдала. Тот же приём, что у сборки
  // виджетов (GenSpecParser.onProgress) — и по той же причине, см. DOC_MAX_TOKENS выше.
  onProgress?: (chars: number) => void,
): Promise<{ ok: boolean; text?: string; error?: string }> {
  if (!context || !context.trim()) return { ok: false, error: 'Не выбраны источники с текстом' };
  // ⚠️ Документ идёт мимо общего пути: ему нужна грамматика, а runChatMessage её не принимает.
  if (kind === 'document') {
    let chars = 0;
    const res = await runTabOrganizePrompt(buildDocPrompt(context), {
      maxTokens: DOC_MAX_TOKENS,
      schema: DOC_SCHEMA,
      // ⚠️ Считаем знаки СЫРОГО ответа (это JSON), а не текста документа: пересчитывать их в
      // «знаки документа» пришлось бы разбором недописанного JSON на каждом чанке. Человеку
      // нужен признак жизни, а не точная цифра, — и растущее число его даёт.
      onChunk: (t) => { chars += t.length; onProgress?.(chars); },
    });
    if (!res.ok) return { ok: false, error: res.error };
    let parsed: unknown = null;
    try { parsed = JSON.parse(res.out); } catch { parsed = null; }
    const doc = normalizeDoc(parsed);
    // ⚠️ Диагностика НЕ ради красоты лога. Разрыв между «сколько модель выдала» и «сколько
    // нарисуется» — единственный признак того, что содержимое молча теряется по дороге, и
    // именно он однажды остался незамеченным: человек видел 6 000 знаков в счётчике и семь
    // пустых разделов в документе (см. normalizeDoc). Снаружи это неотличимо от «модель
    // поленилась», изнутри — видно сразу.
    const inBlocks = Array.isArray((parsed as { blocks?: unknown } | null)?.blocks)
      ? ((parsed as { blocks: unknown[] }).blocks).length : 0;
    console.log(
      `[Notebook] документ: поток=${chars} знаков, ответ=${res.out.length}, `
      + `блоков в ответе=${inBlocks}, нарисуем=${doc?.blocks.length ?? 0}, stop=${res.stopReason}`,
    );
    return doc
      ? { ok: true, text: JSON.stringify(doc) }
      : { ok: false, error: 'Не удалось собрать документ — попробуйте ещё раз' };
  }
  const comparison = kind === 'infographic' && !!items && items.length > 1;
  const prompt = comparison ? buildComparisonPrompt(items!) : buildPrompt(kind, context);
  if (prompt === null) return { ok: false, error: 'Этот тип пока не поддерживается' };
  const outcome = await runChatMessage(prompt, []);
  if (!outcome.ok) return { ok: false, error: String(outcome.error) };
  if (kind === 'quiz') {
    const json = normalizeQuiz(outcome.out);
    return json ? { ok: true, text: json } : { ok: false, error: 'Не удалось разобрать тест — попробуйте ещё раз' };
  }
  if (kind === 'infographic') {
    const json = comparison ? normalizeComparison(outcome.out) : normalizeInfographic(outcome.out);
    return json ? { ok: true, text: json } : { ok: false, error: 'Не удалось разобрать инфографику — попробуйте ещё раз' };
  }
  return { ok: true, text: outcome.out };
}
