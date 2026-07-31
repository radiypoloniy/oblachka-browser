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
]
