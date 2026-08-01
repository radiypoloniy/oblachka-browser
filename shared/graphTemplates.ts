import type { GraphNodeConfig, GraphNodeKind } from './graph'

// ── Готовые схемы графов ─────────────────────────────────────────────────────
//
// Зачем: пустой холст с дюжиной кнопок не подсказывает, что из них собирают. Шаблон
// показывает рабочую связку целиком — человек правит её под себя вместо того, чтобы
// выводить конструкцию с нуля. Это же и документация по продукту: видно, какие узлы
// вообще имеет смысл соединять.
//
// Шаблон — чистые данные, без побочных эффектов. Идентификаторы узлов внутри шаблона
// локальные и при создании воркспейса заменяются на свежие uuid (см. GraphCanvas),
// иначе два графа из одного шаблона делили бы ключи узлов.

export interface TemplateNode {
  id: string
  kind: GraphNodeKind
  x: number
  y: number
  title: string
  config: GraphNodeConfig
}

export interface TemplateEdge {
  from: string
  to: string
}

export interface GraphTemplate {
  id: string
  emoji: string
  label: string
  // Одна строка о том, что схема делает — её видно в списке выбора.
  summary: string
  nodes: TemplateNode[]
  edges: TemplateEdge[]
}

// Колонки по горизонтали: источники → обработка → результат. Раскладку задаём руками,
// потому что автолейаута в проекте пока нет, а криво разбросанные узлы отпугивают сильнее
// пустого холста.
const COL = [40, 420, 800, 1180]

export const GRAPH_TEMPLATES: GraphTemplate[] = [
  {
    id: 'article',
    emoji: '📰',
    label: 'Разобрать статью',
    summary: 'Страница → краткая выжимка и майндкарта по ней',
    nodes: [
      { id: 'src', kind: 'source.url', x: COL[0]!, y: 160, title: 'Статья', config: { url: '' } },
      { id: 'sum', kind: 'artifact.summary', x: COL[1]!, y: 20, title: 'Выжимка', config: {} },
      { id: 'map', kind: 'artifact.mindmap', x: COL[1]!, y: 420, title: 'Майндкарта', config: {} },
    ],
    edges: [{ from: 'src', to: 'sum' }, { from: 'src', to: 'map' }],
  },
  {
    id: 'compare',
    emoji: '⚖️',
    label: 'Сравнить два варианта',
    summary: 'Две страницы → сравнение по пунктам и вывод',
    nodes: [
      { id: 'a', kind: 'source.url', x: COL[0]!, y: 40, title: 'Вариант А', config: { url: '' } },
      { id: 'b', kind: 'source.url', x: COL[0]!, y: 360, title: 'Вариант Б', config: { url: '' } },
      {
        id: 'cmp', kind: 'qwen.transform', x: COL[1]!, y: 180, title: 'Сравнение',
        config: {
          instruction: 'Сравни два варианта из материала. Сделай таблицу по ключевым '
            + 'характеристикам, затем отдельно — плюсы и минусы каждого, затем вывод: '
            + 'кому какой подойдёт. Опирайся только на материал, не выдумывай характеристик.',
        },
      },
      { id: 'out', kind: 'output.text', x: COL[2]!, y: 180, title: 'Итог', config: {} },
    ],
    edges: [{ from: 'a', to: 'cmp' }, { from: 'b', to: 'cmp' }, { from: 'cmp', to: 'out' }],
  },
  {
    id: 'illustrate',
    emoji: '🎨',
    label: 'Картинка к материалу',
    summary: 'Текст → промпт в нужном стиле → чат для генерации',
    nodes: [
      { id: 'src', kind: 'source.note', x: COL[0]!, y: 120, title: 'О чём картинка', config: { text: '' } },
      {
        id: 'img', kind: 'image.prompt', x: COL[1]!, y: 80, title: 'Промпт картинки',
        config: { preset: 'cinematic', instruction: '' },
      },
      {
        id: 'chat', kind: 'webapp.chat', x: COL[2]!, y: 120, title: 'ChatGPT',
        config: { url: 'https://chatgpt.com/', instruction: '' },
      },
    ],
    edges: [{ from: 'src', to: 'img' }, { from: 'img', to: 'chat' }],
  },
  {
    id: 'verify',
    emoji: '🕵️',
    label: 'Проверить утверждение',
    summary: 'Тезис → поиск в интернете → фактчек → разбор',
    nodes: [
      { id: 'claim', kind: 'source.note', x: COL[0]!, y: 160, title: 'Что проверяем', config: { text: '' } },
      { id: 'find', kind: 'search.web', x: COL[1]!, y: 160, title: 'Что пишут', config: { text: '' } },
      { id: 'check', kind: 'factcheck.gemini', x: COL[2]!, y: 160, title: 'Фактчек', config: {} },
      { id: 'out', kind: 'output.text', x: COL[3]!, y: 160, title: 'Разбор', config: {} },
    ],
    edges: [
      { from: 'claim', to: 'find' }, { from: 'find', to: 'check' }, { from: 'check', to: 'out' },
    ],
  },
  {
    id: 'study',
    emoji: '📚',
    label: 'Разобраться в документе',
    summary: 'Файл с диска → выжимка, схема и тест на понимание',
    nodes: [
      { id: 'doc', kind: 'source.file', x: COL[0]!, y: 260, title: 'Документ', config: {} },
      { id: 'sum', kind: 'artifact.summary', x: COL[1]!, y: 0, title: 'Выжимка', config: {} },
      { id: 'map', kind: 'artifact.mindmap', x: COL[1]!, y: 380, title: 'Схема', config: {} },
      { id: 'quiz', kind: 'artifact.quiz', x: COL[2]!, y: 180, title: 'Проверь себя', config: {} },
    ],
    edges: [
      { from: 'doc', to: 'sum' }, { from: 'doc', to: 'map' }, { from: 'doc', to: 'quiz' },
    ],
  },
  {
    id: 'two-ai',
    emoji: '💬',
    label: 'Спросить два ИИ',
    summary: 'Один вопрос в ChatGPT и Gemini, ответы рядом',
    nodes: [
      { id: 'q', kind: 'source.note', x: COL[0]!, y: 200, title: 'Вопрос', config: { text: '' } },
      {
        id: 'gpt', kind: 'webapp.chat', x: COL[1]!, y: 20, title: 'ChatGPT',
        config: { url: 'https://chatgpt.com/', instruction: '' },
      },
      {
        id: 'gem', kind: 'webapp.chat', x: COL[1]!, y: 380, title: 'Gemini',
        config: { url: 'https://gemini.google.com/app', instruction: '' },
      },
      {
        id: 'sum', kind: 'qwen.transform', x: COL[2]!, y: 200, title: 'В чём расходятся',
        config: {
          instruction: 'Тебе даны ответы двух разных ИИ на один вопрос. Скажи, в чём они '
            + 'согласны, в чём расходятся и какой ответ полнее. Не пересказывай их целиком.',
        },
      },
    ],
    edges: [
      { from: 'q', to: 'gpt' }, { from: 'q', to: 'gem' },
      { from: 'gpt', to: 'sum' }, { from: 'gem', to: 'sum' },
    ],
  },
  {
    id: 'newsletter',
    emoji: '📬',
    label: 'Собрать рассылку',
    summary: 'Материал → текст от ChatGPT → ваша вычитка → готовое письмо',
    // Схема собрана по живому процессу: сырьё в чат, обработка у ChatGPT, правка руками,
    // сборка письма. Шапка и подвал вынесены отдельными узлами не для красоты — это
    // постоянная часть, которую в чате перепечатывают каждый выпуск заново. Здесь она
    // остаётся на холсте, и следующий выпуск — это заменить материал и прогнать снова.
    nodes: [
      {
        id: 'mat', kind: 'source.note', x: COL[0]!, y: 40, title: 'Материал выпуска',
        config: { text: '' },
      },
      {
        id: 'top', kind: 'source.note', x: COL[0]!, y: 380, title: 'Шапка',
        config: { text: 'Привет! Это наша ежемесячная рассылка.' },
      },
      {
        id: 'bottom', kind: 'source.note', x: COL[0]!, y: 620, title: 'Подвал',
        config: { text: 'Если больше не хотите получать письма — отпишитесь по ссылке ниже.' },
      },
      {
        id: 'gpt', kind: 'webapp.chat', x: COL[1]!, y: 40, title: 'ChatGPT',
        config: {
          url: 'https://chatgpt.com/',
          instruction: 'Напиши текст email-рассылки по материалу ниже. Тон дружелюбный и '
            + 'деловой, без канцелярита и без превосходных степеней. Структура: заголовок, '
            + 'вступление на два-три предложения, затем блоки новостей с подзаголовками, в '
            + 'конце один призыв к действию. Не добавляй фактов, которых нет в материале.',
        },
      },
      {
        id: 'draft', kind: 'draft.text', x: COL[2]!, y: 40, title: 'Черновик',
        config: { text: '' },
      },
      // Промпт картинки идёт ОТ ЧЕРНОВИКА, а не от ответа модели: иллюстрация должна
      // соответствовать финальному тексту, а не варианту, который потом переписали.
      {
        id: 'img', kind: 'image.prompt', x: COL[2]!, y: 480, title: 'Промпт картинки',
        config: {},
      },
      {
        id: 'doc', kind: 'compose.doc', x: COL[3]!, y: 180, title: 'Письмо',
        config: {
          text: '{Шапка}\n\n{Черновик}\n\n---\n\n{Подвал}',
        },
      },
    ],
    edges: [
      { from: 'mat', to: 'gpt' }, { from: 'gpt', to: 'draft' },
      { from: 'draft', to: 'img' },
      { from: 'top', to: 'doc' }, { from: 'draft', to: 'doc' }, { from: 'bottom', to: 'doc' },
    ],
  },
  {
    id: 'discord-dm',
    emoji: '🎮',
    label: 'Discord-рассылка по клиентам',
    summary: 'Игра и сегмент → два сообщения от ChatGPT → ваша вычитка → связка для отправки',
    // Двухшаговая продажа: хук ждёт ответа клиента, закрытие уходит только после него.
    // Поэтому сообщения лежат ОТДЕЛЬНЫМИ узлами, а не одним текстом: у каждого своя кнопка
    // «копировать», и в Discord уходит ровно то, что нужно, без выделения куска мышью.
    nodes: [
      {
        id: 'game', kind: 'source.note', x: COL[0]!, y: 60, title: 'Игра и ситуация',
        config: {
          text: 'Игра: \nЧто происходит в игре сейчас (конец сезона, новый патч, ивент): \n'
            + 'Что продаём и на каких условиях: ',
        },
      },
      {
        id: 'seg', kind: 'source.note', x: COL[0]!, y: 400, title: 'Сегмент',
        config: {
          text: 'Грейд: G0–G3 (экономят, бегут от гринда) или G4–G5 (статус, экономия времени).\n'
            + 'Жанр: соревновательный (эло, соло-очередь, ранги) или лутер/ARPG (дроп, RNG, фарм).',
        },
      },
      {
        id: 'gpt', kind: 'webapp.chat', x: COL[1]!, y: 140, title: 'ChatGPT',
        config: {
          url: 'https://chatgpt.com/',
          // Промпт пользователя целиком. Дописана только последняя строка про маркировку
          // частей — без неё три куска ответа приходится растаскивать по черновикам на глаз.
          instruction: '# SYSTEM PROMPT: AI Copywriter & Sales Assistant (Gaming Boosting)\n\n'
            + '## PROFILE & TONE\n'
            + '- Name: Tori (A female gamer and professional Discord Sales Manager writing to '
            + 'other gamers).\n'
            + '- Voice: Casual, highly empathetic, witty, and authentic. Sounds like a real '
            + 'gamer friend who knows the grind, NOT a corporate sales bot or generic marketing '
            + 'tool.\n'
            + '- Style: Uses natural styling for a human look, functional emojis (✨, 🚀, 📉, 💀), '
            + 'bold key terms, and short, lethal lines. Avoids boring bulleted lists, formal '
            + 'greetings, and corporate jargon.\n\n'
            + '## CORE SALES METHODOLOGY (2-Step High-Conversion Engine)\n'
            + '1. The Hook (Message 1): An ultra-short, intriguing 1-2 sentence ping designed '
            + 'solely to break the ice and force a reply. Focuses on an undeniable in-game pain '
            + 'point (RNG, toxic matchmaking, bad teammates, time wasting).\n'
            + '2. The Close (Message 2): Sent only after the client replies. Drops a fast, '
            + 'high-value solution featuring psychological levers (FOMO, strict deadlines, flat '
            + 'discounts, or free express upgrades) with a direct, friction-free call to action.\n\n'
            + '## GRADES & SEGMENTATION LOGIC\n'
            + '- Low-to-Mid Spenders (G0–G3): Motivated by saving money and escaping frustrating '
            + 'grinds. Needs high irony, zero-pressure hooks, and sweet value bundles.\n'
            + '- VIPs / Whales (G4–G5): Motivated by exclusivity, status, and time-saving. '
            + 'Focuses on premium rosters, private lobbies, and elite performance. No cheap '
            + 'discount-talk.\n'
            + '- Genre Logic: Splits strategies by Competitive/Ranked games (focus on Elo, solo '
            + 'queue, ranks) and Looter/Extraction/ARPG games (focus on drop rates, RNG, '
            + 'material farming, season-end deadlines).\n\n'
            + '## YOUR TASK\n'
            + 'Act as Tori. When the user provides a game name, a current in-game situation '
            + '(e.g., end of season, new patch, specific event), or a target audience, generate:\n'
            + '1. A hyper-creative, ultra-short, and hook-heavy Message 1.\n'
            + '2. A fast, punchy, value-packed Message 2 optimized for mobile/Discord '
            + 'scannability.\n'
            + '3. An eye-catching, high-clickrate Image Concept (memes, split-screens, '
            + 'high-contrast flex cards) that perfectly aligns with the messaging.\n\n'
            + 'Always prioritize brevity over long blocks of text. Keep it sharp, keeping the '
            + 'text readable in under 5 seconds.\n\n'
            + 'Label the three parts exactly as MESSAGE 1, MESSAGE 2 and IMAGE CONCEPT, each on '
            + 'its own line, so they can be copied separately.',
        },
      },
      {
        id: 'hook', kind: 'draft.text', x: COL[2]!, y: 0, title: 'Хук',
        config: { text: '' },
      },
      {
        id: 'close', kind: 'draft.text', x: COL[2]!, y: 420, title: 'Закрытие',
        config: { text: '' },
      },
      {
        id: 'concept', kind: 'draft.text', x: COL[2]!, y: 840, title: 'Концепт картинки',
        config: { text: '' },
      },
      // ChatGPT описывает картинку словами, а этот узел превращает описание в подробный
      // промпт для генератора — ровно то, ради чего он и заведён (см. shared/imagePresets.ts).
      {
        id: 'img', kind: 'image.prompt', x: COL[3]!, y: 840, title: 'Промпт картинки',
        config: {},
      },
      {
        id: 'doc', kind: 'compose.doc', x: COL[3]!, y: 200, title: 'Связка для отправки',
        config: {
          text: '🎯 СООБЩЕНИЕ 1 — хук\n\n{Хук}\n\n───────────────\n\n'
            + '🔥 СООБЩЕНИЕ 2 — отправлять только после ответа клиента\n\n{Закрытие}\n\n'
            + '───────────────\n\n🖼 ПРОМПТ ДЛЯ ГЕНЕРАТОРА КАРТИНКИ\n\n{Промпт картинки}',
        },
      },
    ],
    edges: [
      { from: 'game', to: 'gpt' }, { from: 'seg', to: 'gpt' },
      // Все три черновика питаются от одного ответа: кнопка «Взять со входа» кладёт в каждый
      // полный текст, лишнее человек удаляет. Это быстрее, чем выделять куски мышью.
      { from: 'gpt', to: 'hook' }, { from: 'gpt', to: 'close' }, { from: 'gpt', to: 'concept' },
      { from: 'concept', to: 'img' },
      { from: 'hook', to: 'doc' }, { from: 'close', to: 'doc' }, { from: 'img', to: 'doc' },
    ],
  },
]
