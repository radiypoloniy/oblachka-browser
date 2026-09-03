// ── Граф-воркспейс: доменная модель ───────────────────────────────────────────
// Отдельный модуль, а не разбухший shared/ipc.ts — тот же приём, что shared/bangs.ts
// и shared/frecency.ts: типы и чистая логика живут здесь, каналы и форма window.oblako
// остаются в ipc.ts.
//
// Смысл графа: маленькая локальная модель не умеет планировать на длинном горизонте
// (эмбеддинги в проекте уже выпилены как тупик, normalizeQuiz существует потому, что
// Qwen возвращает битый JSON). Поэтому план не выдумывает модель — план рисует
// пользователь связями между узлами, а Qwen делает ОДИН узкий шаг на узел.
import type { AiFileMeta } from './aiAttachments'


export type PortType = 'text' | 'textList'

export type GraphNodeKind =
  | 'source.url'      // URL → читаемый текст страницы (NotebookExtract)
  | 'source.note'     // просто текст, введённый руками
  // Локальный документ: txt/md/csv/json, docx и pdf (см. electron/FileExtract.ts).
  | 'source.file'
  // Картинка на холсте: визуальный реф или результат генерации, вернувшийся в граф. Это
  // НОСИТЕЛЬ, а не содержимое: описать изображение моделью мы не можем — node-llama-cpp
  // мультимодальность не выставляет (см. «Дорожная карта» в CLAUDE.md). Наружу узел отдаёт
  // текстовую ссылку на файл, чтобы сборка знала, какую картинку прикладывать.
  | 'source.image'
  | 'qwen.transform'  // инструкция + входы → ответ локальной модели
  // Текст, который человек правит ПОСРЕДИ цепочки. Заметка для этого не годится: у неё нет
  // входа, она живёт только в начале графа. Без черновика шаг «корректировка и редактура»
  // выпадает из графа наружу — ответ модели копируют в документ, правят и несут обратно,
  // и связь с тем, что ниже, теряется. Правки человека прогон НЕ затирает.
  | 'draft.text'
  // Сборка готового документа из нескольких узлов по шаблону. Модели здесь НЕТ вовсе:
  // подстановка детерминированная, один и тот же граф даёт один и тот же документ. Это
  // принципиально — итог рассылки не должен переписываться сам от прогона к прогону.
  | 'compose.doc'
  // Промпт для генератора картинок. Отдельный тип, а не qwen.transform с текстом руками:
  // качество здесь делает подробная зашитая инструкция, см. shared/imagePresets.ts.
  | 'image.prompt'
  // Диалог с локальной моделью прямо в графе. ОТДЕЛЬНЫЙ тип, а не режим qwen.transform:
  // у того детерминированность несущая (кэш по отпечатку входов, на нём стоят шаблоны),
  // а диалог по природе другой — те же входы дают другой ответ, потому что копится
  // переписка. Наружу узел отдаёт последний ответ модели.
  | 'qwen.chat'
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
  // картинку детерминированно рисует renderer (markmap / своя вёрстка / QuizView).
  | 'artifact.summary'
  | 'artifact.mindmap'
  | 'artifact.infographic'
  | 'artifact.quiz'
  | 'output.text'     // терминал: показать и дать скопировать
  // Подпись на холсте: ни входов, ни выходов, движок его не считает. Нужен, чтобы
  // помечать участки — например, откуда пришла пачка ссылок.
  | 'sticker'

export interface PortSpec {
  id: string
  label: string
  type: PortType
}

export interface NodeKindSpec {
  label: string
  hint: string
  // ⚠️ Значка здесь НЕТ намеренно. Он lucide-компонент, то есть renderer-only, а этот модуль
  // читает и main (GraphEngine). Роль, цвет и значок узла живут одной картой в
  // src/components/graph/nodeVisual.tsx.
  inputs: PortSpec[]
  outputs: PortSpec[]
}

// Единственный источник правды о портах: renderer рисует по нему ручки, движок по нему же
// проверяет связи. Разъехаться они не могут — описание одно.
export const NODE_KINDS: Record<GraphNodeKind, NodeKindSpec> = {
  'source.url': {
    label: 'Страница',
    hint: 'Загружает URL в фоне и достаёт читаемый текст',
    inputs: [],
    outputs: [{ id: 'text', label: 'текст', type: 'text' }],
  },
  'source.note': {
    label: 'Заметка',
    hint: 'Произвольный текст, который вы вводите сами',
    inputs: [],
    outputs: [{ id: 'text', label: 'текст', type: 'text' }],
  },
  'source.file': {
    label: 'Файл',
    hint: 'Документ с диска: Word, PDF, текст, таблица CSV',
    inputs: [],
    outputs: [{ id: 'text', label: 'текст', type: 'text' }],
  },
  'source.image': {
    label: 'Картинка',
    hint: 'Изображение с диска: реф или готовый результат генерации',
    inputs: [],
    outputs: [{ id: 'text', label: 'ссылка', type: 'text' }],
  },
  'qwen.transform': {
    label: 'Qwen',
    hint: 'Выполняет вашу инструкцию над тем, что пришло на вход',
    inputs: [{ id: 'context', label: 'вход', type: 'textList' }],
    outputs: [{ id: 'text', label: 'ответ', type: 'text' }],
  },
  'draft.text': {
    label: 'Черновик',
    hint: 'Текст, который вы правите руками посреди цепочки',
    inputs: [{ id: 'context', label: 'вход', type: 'textList' }],
    outputs: [{ id: 'text', label: 'текст', type: 'text' }],
  },
  'compose.doc': {
    label: 'Сборка',
    hint: 'Собирает готовый документ из входов по вашему шаблону, без модели',
    inputs: [{ id: 'context', label: 'блоки', type: 'textList' }],
    outputs: [{ id: 'text', label: 'документ', type: 'text' }],
  },
  'image.prompt': {
    label: 'Промпт картинки',
    hint: 'Собирает готовый промпт для Midjourney/DALL·E по выбранному стилю',
    inputs: [{ id: 'context', label: 'материал', type: 'textList' }],
    outputs: [{ id: 'text', label: 'промпт', type: 'text' }],
  },
  'qwen.chat': {
    label: 'Диалог',
    hint: 'Переписка с локальной моделью; материал со входа она видит',
    inputs: [{ id: 'context', label: 'материал', type: 'textList' }],
    outputs: [{ id: 'text', label: 'последний ответ', type: 'text' }],
  },
  'webapp.chat': {
    label: 'Веб-чат',
    hint: 'Чужой AI-сайт в панели: граф готовит промпт, отправляете вы',
    inputs: [{ id: 'context', label: 'вход', type: 'textList' }],
    outputs: [{ id: 'text', label: 'ответ', type: 'text' }],
  },
  'search.web': {
    label: 'Веб-поиск',
    hint: 'Ищет в интернете через SearXNG и отдаёт найденные сниппеты',
    inputs: [{ id: 'context', label: 'запрос', type: 'textList' }],
    outputs: [{ id: 'text', label: 'находки', type: 'text' }],
  },
  'factcheck.gemini': {
    label: 'Фактчек',
    hint: 'Проверяет утверждения через Gemini с поиском Google (облако, нужен ключ)',
    inputs: [{ id: 'context', label: 'вход', type: 'textList' }],
    outputs: [{ id: 'text', label: 'разбор', type: 'text' }],
  },
  'artifact.summary': {
    label: 'Саммари',
    hint: 'Краткая структурированная выжимка по входу',
    inputs: [{ id: 'context', label: 'вход', type: 'textList' }],
    outputs: [{ id: 'text', label: 'текст', type: 'text' }],
  },
  'artifact.mindmap': {
    label: 'Майндкарта',
    hint: 'Иерархия понятий по входу, рисуется как дерево',
    inputs: [{ id: 'context', label: 'вход', type: 'textList' }],
    outputs: [{ id: 'text', label: 'аутлайн', type: 'text' }],
  },
  'artifact.infographic': {
    label: 'Инфографика',
    hint: 'Визуальная сводка по входу',
    inputs: [{ id: 'context', label: 'вход', type: 'textList' }],
    outputs: [{ id: 'text', label: 'спека', type: 'text' }],
  },
  'artifact.quiz': {
    label: 'Тест',
    hint: 'Вопросы с вариантами ответа по входу',
    inputs: [{ id: 'context', label: 'вход', type: 'textList' }],
    outputs: [{ id: 'text', label: 'JSON', type: 'text' }],
  },
  'sticker': {
    label: 'Заметка на холсте',
    hint: 'Подпись к участку графа — ничего не считает',
    inputs: [],
    outputs: [],
  },
  'output.text': {
    label: 'Результат',
    hint: 'Показывает итог и даёт его скопировать',
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
  preset?: string       // image.prompt — id пресета стиля (встроенного или своего)
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

// Прошлый результат узла. Нужен, чтобы сравнивать «до и после правки промпта» — подбор
// формулировок это основная работа с графом, а без истории каждый прогон затирал предыдущий.
export interface GraphNodeVersion {
  at: number
  output: string
  outputTitle: string | null
}

// Реплика в диалоге узла. Хранится отдельно от результата: результат — это ПОСЛЕДНИЙ ответ
// (он течёт дальше по графу), а переписка нужна модели как контекст и человеку как история.
export interface GraphChatMessage {
  at: number
  role: 'user' | 'assistant'
  text: string
  /** Вложения ответа: описания файлов, байты лежат у main (electron/ai/FileStore.ts). */
  files?: AiFileMeta[]
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
