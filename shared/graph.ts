// ── Граф-воркспейс: доменная модель ───────────────────────────────────────────
// Отдельный модуль, а не разбухший shared/ipc.ts — тот же приём, что shared/bangs.ts
// и shared/frecency.ts: типы и чистая логика живут здесь, каналы и форма window.oblako
// остаются в ipc.ts.
//
// Смысл графа: маленькая локальная модель не умеет планировать на длинном горизонте
// (эмбеддинги в проекте уже выпилены как тупик, normalizeQuiz существует потому, что
// Qwen возвращает битый JSON). Поэтому план не выдумывает модель — план рисует
// пользователь связями между узлами, а Qwen делает ОДИН узкий шаг на узел.

export type PortType = 'text' | 'textList'

export type GraphNodeKind =
  | 'source.url'      // URL → читаемый текст страницы (NotebookExtract)
  | 'source.note'     // просто текст, введённый руками
  // Локальный документ: txt/md/csv/json, docx и pdf (см. electron/FileExtract.ts).
  | 'source.file'
  | 'qwen.transform'  // инструкция + входы → ответ локальной модели
  // Чужой AI-сайт (ChatGPT и т.п.) в панели 1:1. Обмен ТОЛЬКО через руку человека:
  // граф готовит промпт, кнопка кладёт его в поле, отправляет пользователь, кнопка
  // забирает ответ. Автоматической отправки нет по замыслу — см. electron/graphWebApps.ts.
  | 'webapp.chat'
  // Веб-поиск через SearXNG (эндпоинт и токен — в настройках AI).
  | 'search.web'
  // Фактчек через Gemini с грунтингом в Google Search. Единственная не-локальная модель
  // в проекте; без ключа узел честно говорит, что ключа нет.
  | 'factcheck.gemini'
  // Артефакты «Студии» — тот же generateStudio, что у блокнота: модель отдаёт структуру,
  // картинку детерминированно рисует renderer (markmap / @antv/infographic / QuizView).
  | 'artifact.summary'
  | 'artifact.mindmap'
  | 'artifact.infographic'
  | 'artifact.quiz'
  | 'output.text'     // терминал: показать и дать скопировать

export interface PortSpec {
  id: string
  label: string
  type: PortType
}

export interface NodeKindSpec {
  label: string
  hint: string
  // Эмодзи вместо иконки — тон холста намеренно дружелюбный, а не «инженерная панель».
  // Живёт здесь, а не в компоненте: значок один и тот же в кнопке панели и в шапке
  // карточки, и разъехаться они не должны.
  emoji: string
  inputs: PortSpec[]
  outputs: PortSpec[]
}

// Единственный источник правды о портах: renderer рисует по нему ручки, движок по нему же
// проверяет связи. Разъехаться они не могут — описание одно.
export const NODE_KINDS: Record<GraphNodeKind, NodeKindSpec> = {
  'source.url': {
    label: 'Страница',
    hint: 'Загружает URL в фоне и достаёт читаемый текст',
    emoji: '🌐',
    inputs: [],
    outputs: [{ id: 'text', label: 'текст', type: 'text' }],
  },
  'source.note': {
    label: 'Заметка',
    hint: 'Произвольный текст, который вы вводите сами',
    emoji: '📝',
    inputs: [],
    outputs: [{ id: 'text', label: 'текст', type: 'text' }],
  },
  'source.file': {
    label: 'Файл',
    hint: 'Документ с диска: Word, PDF, текст, таблица CSV',
    emoji: '📎',
    inputs: [],
    outputs: [{ id: 'text', label: 'текст', type: 'text' }],
  },
  'qwen.transform': {
    label: 'Qwen',
    hint: 'Выполняет вашу инструкцию над тем, что пришло на вход',
    emoji: '🧠',
    inputs: [{ id: 'context', label: 'вход', type: 'textList' }],
    outputs: [{ id: 'text', label: 'ответ', type: 'text' }],
  },
  'webapp.chat': {
    label: 'Веб-чат',
    hint: 'Чужой AI-сайт в панели: граф готовит промпт, отправляете вы',
    emoji: '💬',
    inputs: [{ id: 'context', label: 'вход', type: 'textList' }],
    outputs: [{ id: 'text', label: 'ответ', type: 'text' }],
  },
  'search.web': {
    label: 'Веб-поиск',
    hint: 'Ищет в интернете через SearXNG и отдаёт найденные сниппеты',
    emoji: '🔍',
    inputs: [{ id: 'context', label: 'запрос', type: 'textList' }],
    outputs: [{ id: 'text', label: 'находки', type: 'text' }],
  },
  'factcheck.gemini': {
    label: 'Фактчек',
    hint: 'Проверяет утверждения через Gemini с поиском Google (облако, нужен ключ)',
    emoji: '🕵️',
    inputs: [{ id: 'context', label: 'вход', type: 'textList' }],
    outputs: [{ id: 'text', label: 'разбор', type: 'text' }],
  },
  'artifact.summary': {
    label: 'Саммари',
    hint: 'Краткая структурированная выжимка по входу',
    emoji: '📋',
    inputs: [{ id: 'context', label: 'вход', type: 'textList' }],
    outputs: [{ id: 'text', label: 'текст', type: 'text' }],
  },
  'artifact.mindmap': {
    label: 'Майндкарта',
    hint: 'Иерархия понятий по входу, рисуется как дерево',
    emoji: '🗺️',
    inputs: [{ id: 'context', label: 'вход', type: 'textList' }],
    outputs: [{ id: 'text', label: 'аутлайн', type: 'text' }],
  },
  'artifact.infographic': {
    label: 'Инфографика',
    hint: 'Визуальная сводка по входу',
    emoji: '📊',
    inputs: [{ id: 'context', label: 'вход', type: 'textList' }],
    outputs: [{ id: 'text', label: 'спека', type: 'text' }],
  },
  'artifact.quiz': {
    label: 'Тест',
    hint: 'Вопросы с вариантами ответа по входу',
    emoji: '❓',
    inputs: [{ id: 'context', label: 'вход', type: 'textList' }],
    outputs: [{ id: 'text', label: 'JSON', type: 'text' }],
  },
  'output.text': {
    label: 'Результат',
    hint: 'Показывает итог и даёт его скопировать',
    emoji: '📤',
    inputs: [{ id: 'context', label: 'вход', type: 'textList' }],
    outputs: [],
  },
}

// Артефакты отдают наружу свою сырую структуру (аутлайн, спеку, JSON) — её осмысленно
// подать дальше в Qwen («сделай тест сложнее»), поэтому выход есть у всех четырёх.
export function isArtifactKind(kind: GraphNodeKind): boolean {
  return kind.startsWith('artifact.')
}

export const GRAPH_NODE_KINDS = Object.keys(NODE_KINDS) as GraphNodeKind[]

// Конфиг узла — плоская запись, разбирается по kind. Плоско и без union намеренно: конфиг
// ездит в SQLite как JSON и правится в форме узла, а строгий union заставлял бы приводить
// типы на каждом чтении из БД без реальной пользы.
export interface GraphNodeConfig {
  url?: string          // source.url, webapp.chat (адрес сайта)
  path?: string         // source.file — абсолютный путь к документу на диске
  text?: string         // source.note
  instruction?: string  // qwen.transform, webapp.chat (что дописать перед материалом)
}

// Статус — РАНТАЙМ, в базу не пишется. Что переживает перезапуск — output/inputHash/error
// (см. GraphStore): по ним renderer сам решает, узел готов или устарел.
// 'awaiting' — узел не может посчитаться сам и ждёт действия человека (узел-веб-приложение:
// вставить промпт, отправить, забрать ответ). Отличать его от 'running' обязательно: иначе
// прогон выглядел бы зависшим, хотя ждёт не машину, а пользователя.
export type GraphNodeStatus = 'idle' | 'stale' | 'queued' | 'running' | 'awaiting' | 'done' | 'error'

export interface GraphNode {
  id: string
  kind: GraphNodeKind
  x: number
  y: number
  // Размер карточки, если человек её растягивал. null — по содержимому.
  // Живёт ОТДЕЛЬНО от config намеренно: config участвует в отпечатке входов, и подтянутый
  // уголок узла заставлял бы пересчитывать его заново — раскладка не влияет на смысл.
  w: number | null
  h: number | null
  title: string
  config: GraphNodeConfig
  // Отпечаток входов последнего успешного прогона. Совпал с текущим — пересчитывать нечего,
  // не совпал — узел и всё, что ниже по течению, устарело.
  inputHash: string | null
  output: string | null
  outputTitle: string | null
  error: string | null
}

export interface GraphEdge {
  id: string
  fromNode: string
  fromPort: string
  toNode: string
  toPort: string
}

export interface GraphMeta {
  id: number
  title: string
  createdAt: number
  updatedAt: number
}

export interface GraphDoc {
  meta: GraphMeta
  nodes: GraphNode[]
  edges: GraphEdge[]
}

// Структура без результатов — ровно то, что renderer имеет право перезаписывать. Результаты
// пишет только движок, иначе автосохранение холста затирало бы свежий выхлоп узла.
export interface GraphStructureNode {
  id: string
  kind: GraphNodeKind
  x: number
  y: number
  w: number | null
  h: number | null
  title: string
  config: GraphNodeConfig
}

export interface GraphStructure {
  nodes: GraphStructureNode[]
  edges: GraphEdge[]
}

// Событие прогона (main → renderer). chunk приходит потоком во время работы Qwen-узла,
// остальные поля — на смене статуса.
export interface GraphProgress {
  graphId: number
  nodeId: string
  status: GraphNodeStatus
  chunk?: string
  output?: string
  outputTitle?: string
  error?: string
}

// ── Чистая логика, общая для main и renderer ─────────────────────────────────

// Топологический порядок. Возвращает null, если в графе есть цикл — движок на этом
// останавливается и говорит человеку, а не крутится вечно.
export function topoOrder(nodes: GraphNode[], edges: GraphEdge[]): string[] | null {
  const incoming = new Map<string, number>()
  const outgoing = new Map<string, string[]>()
  for (const n of nodes) {
    incoming.set(n.id, 0)
    outgoing.set(n.id, [])
  }
  for (const e of edges) {
    if (!incoming.has(e.toNode) || !incoming.has(e.fromNode)) continue // связь на удалённый узел
    incoming.set(e.toNode, (incoming.get(e.toNode) ?? 0) + 1)
    outgoing.get(e.fromNode)!.push(e.toNode)
  }
  const queue = [...incoming.entries()].filter(([, d]) => d === 0).map(([id]) => id)
  const order: string[] = []
  while (queue.length) {
    const id = queue.shift()!
    order.push(id)
    for (const next of outgoing.get(id) ?? []) {
      const left = (incoming.get(next) ?? 0) - 1
      incoming.set(next, left)
      if (left === 0) queue.push(next)
    }
  }
  return order.length === nodes.length ? order : null
}

// Все узлы, до которых доходит поток от заданных (включая их самих). Нужен, чтобы прогон
// одного узла тянул за собой зависимые, а правка — помечала их устаревшими.
export function downstreamOf(startIds: string[], edges: GraphEdge[]): Set<string> {
  const out = new Set(startIds)
  let grew = true
  while (grew) {
    grew = false
    for (const e of edges) {
      if (out.has(e.fromNode) && !out.has(e.toNode)) {
        out.add(e.toNode)
        grew = true
      }
    }
  }
  return out
}

// Узлы, от которых зависит заданный (его питание вверх по течению), включая его самого.
export function upstreamOf(targetId: string, edges: GraphEdge[]): Set<string> {
  const out = new Set([targetId])
  let grew = true
  while (grew) {
    grew = false
    for (const e of edges) {
      if (out.has(e.toNode) && !out.has(e.fromNode)) {
        out.add(e.fromNode)
        grew = true
      }
    }
  }
  return out
}

// Можно ли соединить порты. Разрешаем text → textList (список из одного) и text → text;
// проверка живёт здесь, чтобы холст и движок судили одинаково.
export function canConnect(fromType: PortType, toType: PortType): boolean {
  if (toType === 'textList') return fromType === 'text' || fromType === 'textList'
  return fromType === toType
}
